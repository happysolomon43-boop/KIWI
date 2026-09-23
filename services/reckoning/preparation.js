'use strict';

const crypto = require('node:crypto');
const { SESSION_PHASES, QUESTION_ROLES, RISK_LEVELS } = require('./constants');
const { createReckoningConfig } = require('./config');
const { createQuestionBank } = require('./question-bank');
const { createScheduler } = require('./scheduler');
const { createReckoningStore } = require('./store');
const { ReckoningContractError } = require('./errors');

const ANSWER_KEYS = Object.freeze(['A', 'B', 'C', 'D']);

function mapLimit(items, limit, worker) {
  const source = [...items];
  const width = Math.max(1, Math.min(Number(limit) || 1, source.length || 1));
  let cursor = 0;
  const results = new Array(source.length);

  return Promise.all(
    Array.from({ length: width }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= source.length) return;
        results[index] = await worker(source[index], index);
      }
    })
  ).then(() => results);
}

function attachEvidenceIds(plan, randomUUID = crypto.randomUUID) {
  const byCard = new Map();
  const materialize = (item) => {
    const key = String(item.sourceCardId);
    if (!byCard.has(key)) {
      byCard.set(key, Object.freeze({ ...item, id: randomUUID() }));
    }
    return byCard.get(key);
  };

  const critical = (plan.critical || []).map(materialize);
  const high = (plan.high || []).map(materialize);
  const supporting = (plan.supporting || []).map(materialize);
  const controls = (plan.controls || []).map(materialize);
  const evidence = [...critical, ...high, ...supporting];

  return Object.freeze({
    ...plan,
    critical: Object.freeze(critical),
    high: Object.freeze(high),
    supporting: Object.freeze(supporting),
    controls: Object.freeze(controls),
    evidence: Object.freeze(evidence),
  });
}

function validateGeneratedFamily(generated = [], plan = {}) {
  const byEvidence = new Map();
  for (const item of generated) {
    const evidenceId = item.blueprint?.evidenceId;
    if (!evidenceId) throw new ReckoningContractError('Generated question is missing evidenceId.');
    if (!byEvidence.has(evidenceId)) byEvidence.set(evidenceId, new Set());
    byEvidence.get(evidenceId).add(item.blueprint.role);
  }

  const requireRoles = (items, roles) => {
    for (const evidence of items || []) {
      const present = byEvidence.get(evidence.id) || new Set();
      for (const role of roles) {
        if (!present.has(role)) {
          throw new ReckoningContractError(
            `Question bank missing ${role} for ${evidence.conceptKey || evidence.id}.`
          );
        }
      }
    }
  };

  requireRoles(plan.critical, [
    QUESTION_ROLES.DIAGNOSTIC,
    QUESTION_ROLES.CHALLENGE,
    QUESTION_ROLES.CONFIRMATION,
  ]);
  requireRoles(plan.high, [QUESTION_ROLES.DIAGNOSTIC, QUESTION_ROLES.CHALLENGE]);
  requireRoles(plan.supporting, [QUESTION_ROLES.DIAGNOSTIC, QUESTION_ROLES.CHALLENGE]);
  requireRoles(plan.controls, [QUESTION_ROLES.CONTROL, QUESTION_ROLES.CHALLENGE]);

  const primaryCount = generated.filter((item) =>
    [QUESTION_ROLES.DIAGNOSTIC, QUESTION_ROLES.CONTROL].includes(item.blueprint.role)
  ).length;
  if (primaryCount < Math.min(1, Number(plan.counts?.evidence || 0) + Number(plan.counts?.controls || 0))) {
    throw new ReckoningContractError('Question bank contains no usable primary questions.');
  }
}

function generatedToQuestionRow({
  generated,
  userId,
  examSessionId,
  questionNumber,
  randomUUID = crypto.randomUUID,
}) {
  const blueprint = generated.blueprint;
  const question = generated.question;
  const correctIndex = Number(question.correctIndex);
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
    throw new ReckoningContractError('Generated question has no valid correctIndex.');
  }

  return Object.freeze({
    id: randomUUID(),
    user_id: userId,
    exam_session_id: examSessionId,
    card_id: blueprint.sourceCardId || null,
    question_number: questionNumber,
    cognitive_level: blueprint.cognitiveLevel || null,
    difficulty:
      blueprint.riskLevel === RISK_LEVELS.CRITICAL ? 'hard' :
      blueprint.riskLevel === RISK_LEVELS.HIGH ? 'medium' : 'standard',
    question_type: 'mcq',
    stem: question.stem,
    option_a: question.options[0],
    option_b: question.options[1],
    option_c: question.options[2],
    option_d: question.options[3],
    correct_answer: ANSWER_KEYS[correctIndex],
    explanation: question.explanation || '',
    reckoning_evidence_id: blueprint.evidenceId,
    reckoning_role: blueprint.role,
    variant_index: Number(blueprint.variantIndex) || 0,
    reckoning_blueprint: blueprint,
    is_unlocked: false,
    unlocked_at: null,
    response_time_ms: null,
    evidence_effect: null,
  });
}

function createProductionPreparation({
  config = createReckoningConfig(),
  store = createReckoningStore(),
  questionBank = createQuestionBank({ config }),
  scheduler = createScheduler({ config }),
  randomUUID = crypto.randomUUID,
  clock = () => new Date(),
  generationConcurrency = 4,
  generationAttempts = 3,
} = {}) {
  async function generateQuestionFamily(plan, reckoningId) {
    const blueprints = questionBank.buildBlueprints(plan);
    const grouped = new Map();

    for (const blueprint of blueprints) {
      if (!grouped.has(blueprint.evidenceId)) grouped.set(blueprint.evidenceId, []);
      grouped.get(blueprint.evidenceId).push(blueprint);
    }

    const groups = [...grouped.values()];
    const nested = await mapLimit(groups, generationConcurrency, async (group) => {
      const ordered = [...group].sort((a, b) => a.variantIndex - b.variantIndex);
      const output = [];
      let previousQuestion = null;

      for (const blueprint of ordered) {
        let lastError = null;
        let generated = null;
        for (let attempt = 1; attempt <= generationAttempts; attempt += 1) {
          try {
            generated = await questionBank.generate(blueprint, {
              previousQuestion,
              requireSemanticReview: true,
              generationGroupId: reckoningId,
            });
            break;
          } catch (error) {
            lastError = error;
          }
        }
        if (!generated) {
          throw new ReckoningContractError(
            `Unable to generate a valid ${blueprint.role} after ${generationAttempts} attempts: ${lastError?.message || 'unknown error'}`
          );
        }
        output.push(generated);
        previousQuestion = generated.question;
      }
      return output;
    });

    const generated = nested.flat();
    validateGeneratedFamily(generated, plan);
    return Object.freeze(generated);
  }

  async function prepareAndStart({
    reckoning,
    userId,
    subjectId,
    plan,
    deckIds = [],
    ksBefore = null,
  } = {}) {
    if (!reckoning?.id || !userId || !subjectId || !plan) {
      throw new ReckoningContractError(
        'prepareAndStart requires reckoning, userId, subjectId and plan.'
      );
    }

    const existing = await store.getSession(reckoning.id, userId);
    if (
      existing?.engine_version === 2 &&
      ['PILOT', 'LIVE'].includes(String(existing.engine_mode || '')) &&
      existing.status === 'in_progress' &&
      existing.exam_session_id
    ) {
      return Object.freeze({
        alreadyStarted: true,
        examSessionId: existing.exam_session_id,
        reckoningId: existing.id,
      });
    }

    const claimed = await store.claimGeneration(reckoning.id, userId);
    if (!claimed) {
      const current = await store.getSession(reckoning.id, userId);
      if (current?.status === 'in_progress' && current?.exam_session_id) {
        return Object.freeze({
          alreadyStarted: true,
          examSessionId: current.exam_session_id,
          reckoningId: current.id,
        });
      }
      const error = new ReckoningContractError('Reckoning preparation is already in progress.');
      error.code = 'ERR_RECKONING_PREPARING';
      error.status = 409;
      throw error;
    }

    const livePlan = attachEvidenceIds(plan, randomUUID);
    let generated;
    try {
      generated = await generateQuestionFamily(livePlan, reckoning.id);
    } catch (error) {
      await store.markGenerationFailure(reckoning.id, error.message).catch(() => null);
      throw error;
    }

    const examSessionId = randomUUID();
    const questionRows = generated.map((item, index) =>
      generatedToQuestionRow({
        generated: item,
        userId,
        examSessionId,
        questionNumber: index + 1,
        randomUUID,
      })
    );

    const syntheticEvidence = [...livePlan.evidence, ...livePlan.controls].map((item) => ({
      id: item.id,
      risk_score: item.riskScore,
      risk_level: item.riskLevel,
      evidence_status: 'UNTESTED',
      next_eligible_question: null,
    }));
    const syntheticQuestions = questionRows.map((row) => ({ ...row }));
    const first = scheduler.chooseNext({
      evidence: syntheticEvidence,
      questions: syntheticQuestions,
      questionsUsed: 0,
      lastEvidenceId: null,
    });
    if (first.type !== 'QUESTION' || !first.questionId) {
      await store.markGenerationFailure(reckoning.id, 'No valid first question could be scheduled.')
        .catch(() => null);
      throw new ReckoningContractError('Prepared Reckoning has no schedulable first question.');
    }

    const now = clock();
    const safetyExpiresAt = new Date(
      now.getTime() + config.execution.safetyWindowMinutes * 60000
    );

    try {
      return await store.withTransaction(async (txStore) => {
        const locked = await txStore.getSession(reckoning.id, userId, { forUpdate: true });
        if (!locked) throw new ReckoningContractError('Reckoning session disappeared during preparation.');
        if (locked.status === 'in_progress' && locked.exam_session_id) {
          return Object.freeze({
            alreadyStarted: true,
            examSessionId: locked.exam_session_id,
            reckoningId: locked.id,
          });
        }
        if (!['triggered', 'deferred'].includes(String(locked.status))) {
          throw new ReckoningContractError(
            `Reckoning cannot start from status ${locked.status}.`
          );
        }
        const deferredUntil = locked.deferred_until
          ? new Date(locked.deferred_until).getTime()
          : 0;
        if (deferredUntil > now.getTime()) {
          const error = new ReckoningContractError('This Reckoning is still deferred.');
          error.code = 'RECKONING_DEFERRED';
          error.status = 409;
          throw error;
        }

        for (const evidence of [...livePlan.evidence, ...livePlan.controls]) {
          await txStore.createEvidence({
            id: evidence.id,
            reckoningId: locked.id,
            userId,
            subjectId,
            sourceCardId: evidence.sourceCardId,
            conceptKey: evidence.conceptKey,
            sourceSnapshot: evidence.sourceSnapshot,
            sourceHash: evidence.sourceHash,
            originalCardState: evidence.originalCardState,
            riskScore: evidence.riskScore,
            riskLevel: evidence.riskLevel,
            riskReasons: evidence.riskReasons,
            isBubbleCritical: evidence.isBubbleCritical,
            hasLearningDebt: evidence.hasLearningDebt,
            discoveredByControl: false,
            evidenceStatus: 'UNTESTED',
            requiredConfirmations: evidence.requiredConfirmations,
          });
        }

        await txStore.createExecutionExam({
          id: examSessionId,
          userId,
          subjectId,
          deckIds,
          questionCount: questionRows.length,
          safetyWindowSeconds: config.execution.safetyWindowMinutes * 60,
          startedAt: now,
          ksBefore,
        });

        for (const question of questionRows) {
          await txStore.createExecutionQuestion({
            ...question,
            is_unlocked: question.id === first.questionId,
            unlocked_at: question.id === first.questionId ? now : null,
          });
        }

        await txStore.saveSession(locked.id, {
          engineVersion: config.engineVersion,
          engineMode: 'LIVE',
          enginePhase: SESSION_PHASES.ACTIVE,
          questionsUsed: 0,
          softQuestionBudget: livePlan.softQuestionBudget,
          hardQuestionCap: livePlan.hardQuestionCap,
          recoveryScore: 0,
          rawAccuracy: 0,
          unresolvedCriticalCount: livePlan.critical.length,
          currentBlock: 1,
          currentQuestionId: first.questionId,
          stateVersion: (Number(locked.state_version) || 0) + 1,
          preparedAt: now,
          reviewStartedAt: now,
          safetyExpiresAt,
          generationStatus: 'ready',
          generationError: null,
          plannerVersion: config.plannerVersion,
          configVersion: config.configVersion,
        });

        await txStore.activateReckoningRow(locked.id, examSessionId);

        return Object.freeze({
          alreadyStarted: false,
          examSessionId,
          reckoningId: locked.id,
          firstQuestionId: first.questionId,
          safetyExpiresAt,
          generatedQuestions: questionRows.length,
          evidenceUnits: livePlan.evidence.length + livePlan.controls.length,
        });
      });
    } catch (error) {
      await store.markGenerationFailure(reckoning.id, error.message).catch(() => null);
      throw error;
    }
  }

  return Object.freeze({
    name: 'reckoning-production-preparation',
    attachEvidenceIds,
    generateQuestionFamily,
    prepareAndStart,
  });
}

module.exports = {
  ANSWER_KEYS,
  mapLimit,
  attachEvidenceIds,
  validateGeneratedFamily,
  generatedToQuestionRow,
  createProductionPreparation,
};
