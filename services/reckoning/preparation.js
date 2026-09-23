'use strict';

const crypto = require('node:crypto');
const { EVIDENCE_STATUSES } = require('./constants');
const { createReckoningConfig } = require('./config');
const { createPlanner } = require('./planner');
const { createQuestionBank } = require('./question-bank');
const { createScheduler } = require('./scheduler');
const { ReckoningContractError } = require('./errors');

const ANSWER_KEYS = Object.freeze(['A', 'B', 'C', 'D']);

function familyCost(level) {
  return level === 'CRITICAL' ? 3 : 2;
}

function withEvidenceId(item, randomUUID) {
  return Object.freeze({
    ...item,
    id: item.id || randomUUID(),
    evidenceStatus: EVIDENCE_STATUSES.UNTESTED,
  });
}

function fitPlanToBank(plan, {
  maxBankQuestions = 30,
  minEvidenceUnits = 5,
  randomUUID = crypto.randomUUID,
} = {}) {
  const selected = {
    critical: [],
    high: [],
    supporting: [],
    controls: [],
  };
  let remaining = Math.max(1, Number(maxBankQuestions) || 30);

  // Reserve one healthy control when possible. Breadth is part of the diagnostic,
  // not optional decoration; however Critical weaknesses always have priority.
  const reserveControl =
    (plan.controls || []).length > 0 && remaining >= 7
      ? withEvidenceId(plan.controls[0], randomUUID)
      : null;
  if (reserveControl) remaining -= familyCost('SUPPORTING');

  for (const item of plan.critical || []) {
    const cost = familyCost('CRITICAL');
    if (remaining < cost) break;
    selected.critical.push(withEvidenceId(item, randomUUID));
    remaining -= cost;
  }
  for (const item of plan.high || []) {
    const cost = familyCost('HIGH');
    if (remaining < cost) break;
    selected.high.push(withEvidenceId(item, randomUUID));
    remaining -= cost;
  }
  for (const item of plan.supporting || []) {
    const cost = familyCost('SUPPORTING');
    if (remaining < cost) break;
    selected.supporting.push(withEvidenceId(item, randomUUID));
    remaining -= cost;
  }

  if (reserveControl) selected.controls.push(reserveControl);

  // If the risk-heavy plan was tiny, use remaining healthy controls/supporting
  // evidence until the configured minimum evidence breadth is reached.
  const usedIds = new Set(
    [...selected.critical, ...selected.high, ...selected.supporting, ...selected.controls]
      .map((item) => String(item.sourceCardId))
  );
  const totalSelected = () =>
    selected.critical.length +
    selected.high.length +
    selected.supporting.length +
    selected.controls.length;

  const healthyBackfill = [
    ...(plan.supporting || []),
    ...(plan.controls || []),
  ];
  for (const item of healthyBackfill) {
    if (totalSelected() >= minEvidenceUnits) break;
    if (usedIds.has(String(item.sourceCardId))) continue;
    if (remaining < 2) break;
    const withId = withEvidenceId(item, randomUUID);
    selected.supporting.push(withId);
    usedIds.add(String(item.sourceCardId));
    remaining -= 2;
  }

  const evidence = Object.freeze([
    ...selected.critical,
    ...selected.high,
    ...selected.supporting,
    ...selected.controls,
  ]);

  if (evidence.length === 0) {
    throw new ReckoningContractError(
      'Reckoning V2 could not select any evidence units for this subject.'
    );
  }

  return Object.freeze({
    ...plan,
    mode: 'LIVE',
    critical: Object.freeze(selected.critical),
    high: Object.freeze(selected.high),
    supporting: Object.freeze(selected.supporting),
    controls: Object.freeze(selected.controls),
    evidence,
    counts: Object.freeze({
      ...(plan.counts || {}),
      critical: selected.critical.length,
      high: selected.high.length,
      supporting: selected.supporting.length,
      controls: selected.controls.length,
      evidence: evidence.length,
    }),
  });
}

function toQuestionRecord(generated, questionNumber) {
  const { blueprint, question } = generated;
  const correctAnswer = ANSWER_KEYS[question.correctIndex];
  if (!correctAnswer) {
    throw new ReckoningContractError(
      `Prepared question ${blueprint.id} has no valid answer key.`
    );
  }
  return Object.freeze({
    id: null,
    cardId: blueprint.sourceCardId,
    questionNumber,
    cognitiveLevel: blueprint.cognitiveLevel,
    difficulty:
      blueprint.role === 'CHALLENGE' || blueprint.role === 'CONFIRMATION'
        ? 'Hard'
        : 'Medium',
    questionType: 'Reckoning',
    stem: question.stem,
    options: Object.freeze([...question.options]),
    correctAnswer,
    explanation: question.explanation || '',
    evidenceId: blueprint.evidenceId,
    role: blueprint.role,
    variantIndex: blueprint.variantIndex,
    blueprint,
  });
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(Number(limit) || 1, items.length || 1));

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function createPreparationService({
  config = createReckoningConfig(),
  planner = createPlanner({ config }),
  questionBank = createQuestionBank({ config }),
  scheduler = createScheduler({ config }),
  randomUUID = crypto.randomUUID,
} = {}) {
  async function generateWithRetry(blueprint, options = {}) {
    let lastError = null;
    const attempts = Math.max(
      1,
      Number(config.preparation.generationAttemptsPerItem) || 1
    );
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await questionBank.generate(blueprint, options);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new ReckoningContractError(
      `Question generation failed for blueprint ${blueprint.id}.`
    );
  }

  async function prepare({
    cards = [],
    states = [],
    bubbleCardIds = [],
    metricsByCardId = {},
    context = {},
    now = new Date(),
    generationGroupId = null,
  } = {}) {
    const rawPlan = planner.buildPlan({
      cards,
      states,
      bubbleCardIds,
      metricsByCardId,
      context,
      now,
    });
    const plan = fitPlanToBank(rawPlan, {
      maxBankQuestions: config.preparation.maxBankQuestions,
      minEvidenceUnits: config.planner.minEvidenceUnits,
      randomUUID,
    });

    const blueprints = questionBank.buildBlueprints(plan);
    if (!blueprints.length) {
      throw new ReckoningContractError('Reckoning V2 produced an empty question blueprint bank.');
    }
    if (blueprints.length > config.preparation.maxBankQuestions) {
      throw new ReckoningContractError('Reckoning V2 question bank exceeded its configured cap.');
    }

    const familyOrder = [];
    const families = new Map();
    for (const blueprint of blueprints) {
      if (!families.has(blueprint.evidenceId)) {
        families.set(blueprint.evidenceId, []);
        familyOrder.push(blueprint.evidenceId);
      }
      families.get(blueprint.evidenceId).push(blueprint);
    }

    const generatedFamilies = await mapWithConcurrency(
      familyOrder,
      config.preparation.familyConcurrency,
      async (evidenceId) => {
        const family = families.get(evidenceId) || [];
        const generated = [];
        let previousQuestion = null;
        for (const blueprint of family) {
          const item = await generateWithRetry(blueprint, {
            previousQuestion,
            requireSemanticReview: true,
            generationGroupId,
          });
          generated.push(item);
          previousQuestion = item.question;
        }
        return generated;
      }
    );

    const generated = generatedFamilies.flat();
    const questions = generated.map((item, index) => Object.freeze({
      ...toQuestionRecord(item, index + 1),
      id: randomUUID(),
    }));

    const schedulerQuestions = questions.map((question) => ({
      id: question.id,
      evidenceId: question.evidenceId,
      role: question.role,
      variantIndex: question.variantIndex,
      selectedOption: null,
    }));
    const first = scheduler.chooseNext({
      evidence: plan.evidence,
      questions: schedulerQuestions,
      questionsUsed: 0,
      lastEvidenceId: null,
    });
    if (first.type !== 'QUESTION') {
      throw new ReckoningContractError(
        'Reckoning V2 could not select an initial diagnostic/control question.'
      );
    }

    return Object.freeze({
      preparationVersion: config.preparationVersion,
      plan,
      questions: Object.freeze(questions),
      firstQuestionId: first.questionId,
      firstQuestionNumber:
        questions.find((question) => question.id === first.questionId)?.questionNumber || 1,
      firstEvidenceId: first.evidenceId,
      generatedAt: now,
    });
  }

  async function generateReplacement({
    blueprint,
    previousQuestion = null,
    generationGroupId = null,
  } = {}) {
    if (!blueprint) {
      throw new ReckoningContractError('Replacement generation requires a blueprint.');
    }
    const nextVariant = Math.max(0, Number(blueprint.variantIndex) || 0) + 100;
    const replacementBlueprint = Object.freeze({
      ...blueprint,
      id: `${blueprint.id || blueprint.evidenceId}:repair:${nextVariant}`,
      variantIndex: nextVariant,
    });
    const generated = await generateWithRetry(replacementBlueprint, {
      previousQuestion,
      requireSemanticReview: true,
      generationGroupId,
    });
    return toQuestionRecord(generated, null);
  }

  return Object.freeze({
    name: 'reckoning-preparation-service',
    version: config.preparationVersion,
    fitPlanToBank,
    prepare,
    generateReplacement,
  });
}

module.exports = {
  familyCost,
  fitPlanToBank,
  toQuestionRecord,
  mapWithConcurrency,
  createPreparationService,
};