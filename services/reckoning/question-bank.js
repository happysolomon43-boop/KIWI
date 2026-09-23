'use strict';

const { QUESTION_ROLES, RISK_LEVELS } = require('./constants');
const { createReckoningConfig } = require('./config');
const { createQuestionValidator } = require('./validator');
const { ReckoningContractError } = require('./errors');

function blueprintId(evidence, role, variantIndex) {
  return `${evidence.conceptKey || evidence.sourceCardId}:${role}:${variantIndex}`;
}

function roleBlueprint(evidence, role, variantIndex, config) {
  const cognitiveLevel = {
    DIAGNOSTIC: 'APPLICATION_OR_RETRIEVAL',
    CONTROL: 'TRANSFER_CHECK',
    CHALLENGE: 'CORRECTIVE_APPLICATION',
    CONFIRMATION: 'INDEPENDENT_RETRIEVAL',
  }[role];

  return Object.freeze({
    id: blueprintId(evidence, role, variantIndex),
    blueprintVersion: config.blueprintVersion,
    evidenceId: evidence.id || null,
    sourceCardId: evidence.sourceCardId,
    conceptKey: evidence.conceptKey,
    role,
    variantIndex,
    riskLevel: evidence.riskLevel,
    cognitiveLevel,
    sourceSnapshot: evidence.sourceSnapshot,
    sourceHash: evidence.sourceHash,
    constraints: Object.freeze({
      groundedOnly: true,
      optionCount: 4,
      singleBestAnswer: true,
      avoidDirectCopy: true,
      changeScenario: role === QUESTION_ROLES.CHALLENGE || role === QUESTION_ROLES.CONFIRMATION,
      independentRetrieval: role === QUESTION_ROLES.CONFIRMATION,
    }),
  });
}

function buildPrompt(blueprint, retryFeedback = null) {
  return [
    'You are writing exactly one KIWI Reckoning multiple-choice question.',
    'KIWI has already decided what to test. Do not change the assessment target.',
    `Role: ${blueprint.role}`,
    `Cognitive level: ${blueprint.cognitiveLevel}`,
    `Risk level: ${blueprint.riskLevel}`,
    'Use only the supplied source material.',
    'Return JSON only with keys: stem, options, correctAnswer, explanation.',
    'options must be an array of exactly four distinct strings.',
    'All four options must remain distinct after lowercasing, trimming whitespace, and removing punctuation.',
    'Never repeat an answer choice, paraphrase the same choice twice, or use a trivially reformatted duplicate.',
    'correctAnswer must be one of A, B, C, D.',
    'There must be exactly one defensible best answer.',
    blueprint.constraints.changeScenario
      ? 'Use a meaningfully different scenario or reasoning direction from the primary question.'
      : 'Do not simply copy the source wording.',
    blueprint.constraints.independentRetrieval
      ? 'This is a delayed confirmation: do not echo the challenge wording or explanation.'
      : '',
    retryFeedback
      ? `RETRY CORRECTION: The previous attempt failed validation (${retryFeedback}). Produce a genuinely new option set that fixes every listed issue.`
      : null,
    'SOURCE MATERIAL:',
    JSON.stringify(blueprint.sourceSnapshot || {}),
  ].filter(Boolean).join('\n');
}

function parseJsonQuestion(text) {
  const raw = String(text || '').trim();
  const unfenced = raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new ReckoningContractError('Reckoning question generation returned no JSON object.');
  }
  try {
    return JSON.parse(unfenced.slice(start, end + 1));
  } catch (error) {
    throw new ReckoningContractError(`Invalid Reckoning question JSON: ${error.message}`);
  }
}

function createQuestionBank({
  config = createReckoningConfig(),
  aiRun = null,
  validator = createQuestionValidator({ config }),
} = {}) {
  function buildBlueprints(plan = {}) {
    const blueprints = [];

    for (const evidence of plan.critical || []) {
      blueprints.push(roleBlueprint(evidence, QUESTION_ROLES.DIAGNOSTIC, 0, config));
      blueprints.push(roleBlueprint(evidence, QUESTION_ROLES.CHALLENGE, 1, config));
      blueprints.push(roleBlueprint(evidence, QUESTION_ROLES.CONFIRMATION, 2, config));
    }

    for (const evidence of plan.high || []) {
      blueprints.push(roleBlueprint(evidence, QUESTION_ROLES.DIAGNOSTIC, 0, config));
      blueprints.push(roleBlueprint(evidence, QUESTION_ROLES.CHALLENGE, 1, config));
    }

    for (const evidence of plan.supporting || []) {
      blueprints.push(roleBlueprint(evidence, QUESTION_ROLES.DIAGNOSTIC, 0, config));
      blueprints.push(roleBlueprint(evidence, QUESTION_ROLES.CHALLENGE, 1, config));
    }

    for (const evidence of plan.controls || []) {
      const controlEvidence = {
        ...evidence,
        riskLevel: RISK_LEVELS.SUPPORTING,
      };
      blueprints.push(roleBlueprint(controlEvidence, QUESTION_ROLES.CONTROL, 0, config));
      blueprints.push(roleBlueprint(controlEvidence, QUESTION_ROLES.CHALLENGE, 1, config));
    }

    return Object.freeze(blueprints);
  }

  async function generate(blueprint, {
    previousQuestion = null,
    requireSemanticReview = true,
    generationGroupId = null,
    retryFeedback = null,
    attempt = 1,
  } = {}) {
    if (typeof aiRun !== 'function') {
      throw new ReckoningContractError('Question generation requires the centralized AI runner.');
    }

    const result = await aiRun(
      'RECKONING_CBT',
      {
        content: buildPrompt(blueprint, retryFeedback),
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: Math.min(0.55, 0.35 + Math.max(0, Number(attempt) - 1) * 0.08),
        },
      },
      { generationGroupId }
    );

    const question = parseJsonQuestion(result?.text);
    const structure = validator.validateStructure(question, {
      blueprint,
      previousQuestion,
    });
    if (!structure.valid) {
      const error = new ReckoningContractError(
        `Generated Reckoning question failed structural validation: ${structure.issues.join(', ')}`
      );
      error.code = 'ERR_RECKONING_QUESTION_STRUCTURE';
      error.validationIssues = [...structure.issues];
      throw error;
    }

    let semantics = null;
    if (requireSemanticReview) {
      semantics = await validator.validateSemantics(question, {
        blueprint,
        sourceSnapshot: blueprint.sourceSnapshot,
        previousQuestion,
      });
      if (!semantics.valid) {
        const error = new ReckoningContractError(
          `Generated Reckoning question failed semantic validation: ${semantics.issues.join(', ')}`
        );
        error.code = 'ERR_RECKONING_QUESTION_SEMANTICS';
        error.validationIssues = [...semantics.issues];
        throw error;
      }
    }

    return Object.freeze({
      blueprint,
      question: structure.normalized,
      structure,
      semantics,
      ai: Object.freeze({
        modelId: result?.modelId || null,
        projectSlot: result?.projectSlot || result?.slotId || null,
        attempts: result?.attempts || null,
      }),
    });
  }

  return Object.freeze({
    name: 'reckoning-question-bank',
    version: config.blueprintVersion,
    roles: QUESTION_ROLES,
    buildBlueprints,
    buildPrompt,
    generate,
  });
}

module.exports = {
  blueprintId,
  roleBlueprint,
  buildPrompt,
  parseJsonQuestion,
  createQuestionBank,
};