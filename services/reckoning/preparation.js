'use strict';

const crypto = require('node:crypto');
const { EVIDENCE_STATUSES } = require('./constants');
const { createReckoningConfig } = require('./config');
const { createPlanner } = require('./planner');
const { createQuestionBank } = require('./question-bank');
const { createScheduler } = require('./scheduler');
const { ReckoningContractError } = require('./errors');
const { isAIAvailabilityError } = require('../ai/errors');

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

function resolveFamilyConcurrency(snapshot, config) {
  const maxConcurrency = Math.max(
    1,
    Number(config?.preparation?.familyConcurrency) || 1
  );
  if (!snapshot || typeof snapshot !== 'object') return maxConcurrency;

  const level = String(snapshot.congestionLevel || 'NORMAL').toUpperCase();
  if (level === 'SEVERE') {
    return Math.min(
      maxConcurrency,
      Math.max(1, Number(config?.preparation?.severeFamilyConcurrency) || 1)
    );
  }
  if (level === 'HIGH') {
    return Math.min(
      maxConcurrency,
      Math.max(1, Number(config?.preparation?.highFamilyConcurrency) || 1)
    );
  }
  if (level === 'ELEVATED') {
    return Math.min(
      maxConcurrency,
      Math.max(1, Number(config?.preparation?.elevatedFamilyConcurrency) || 2)
    );
  }

  if ((Number(snapshot.queued) || 0) > 0) return 1;

  const effective = Math.max(
    1,
    Number(snapshot.effectiveConcurrency) || maxConcurrency
  );
  const active = Math.max(0, Number(snapshot.active) || 0);
  const immediatelyAvailable = Math.max(1, effective - active);
  return Math.max(1, Math.min(maxConcurrency, immediatelyAvailable));
}

async function mapWithAdaptiveConcurrency(items, {
  config,
  getConcurrencyState = null,
  shouldStop = null,
} = {}, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  let active = 0;

  if (!items.length) return results;

  return new Promise((resolve, reject) => {
    let settled = false;

    function finishIfDone() {
      if (settled) return true;
      if (
        active === 0 &&
        (
          cursor >= items.length ||
          (typeof shouldStop === 'function' && shouldStop())
        )
      ) {
        settled = true;
        resolve(results);
        return true;
      }
      return false;
    }

    function schedule() {
      if (settled || finishIfDone()) return;

      const snapshot =
        typeof getConcurrencyState === 'function'
          ? getConcurrencyState()
          : null;
      const limit = resolveFamilyConcurrency(snapshot, config);

      while (
        !settled &&
        cursor < items.length &&
        active < limit &&
        !(typeof shouldStop === 'function' && shouldStop())
      ) {
        const index = cursor++;
        active += 1;

        Promise.resolve(mapper(items[index], index))
          .then((value) => {
            results[index] = value;
          })
          .catch((error) => {
            if (settled) return;
            settled = true;
            reject(error);
          })
          .finally(() => {
            active = Math.max(0, active - 1);
            if (!settled) schedule();
          });
      }

      finishIfDone();
    }

    schedule();
  });
}

function familyMetadata(blueprints = []) {
  const familyOrder = [];
  const familyIndexById = new Map();
  const itemIndexByBlueprint = new Map();
  const itemCounterByFamily = new Map();

  for (const blueprint of blueprints) {
    const evidenceId = String(blueprint.evidenceId || '');
    if (!familyIndexById.has(evidenceId)) {
      familyIndexById.set(evidenceId, familyOrder.length);
      familyOrder.push(evidenceId);
      itemCounterByFamily.set(evidenceId, 0);
    }
    const itemIndex = itemCounterByFamily.get(evidenceId) || 0;
    itemIndexByBlueprint.set(String(blueprint.id), itemIndex);
    itemCounterByFamily.set(evidenceId, itemIndex + 1);
  }

  return {
    familyOrder: Object.freeze(familyOrder),
    familyIndexById,
    itemIndexByBlueprint,
  };
}

function persistedQuestion(item) {
  if (!item) return null;
  return (
    item.generatedQuestion ||
    item.generated_question ||
    item.question ||
    null
  );
}

function persistedBlueprintId(item) {
  return String(item?.blueprintId || item?.blueprint_id || '');
}

function persistedStatus(item) {
  return String(item?.status || '').toUpperCase();
}

function createPartialPreparationError({
  failures,
  readyCount,
  totalCount,
} = {}) {
  const first = failures?.[0]?.error || null;
  const baseMessage =
    first?.message ||
    'Reckoning question generation paused before the bank was complete.';
  const message =
    `${baseMessage} ${readyCount}/${totalCount} validated question${readyCount === 1 ? '' : 's'} ` +
    `${readyCount === 1 ? 'is' : 'are'} saved and will be reused on retry.`;
  const error = new ReckoningContractError(message);
  error.code = isAIAvailabilityError(first)
    ? (first.code || 'ERR_RECKONING_PREPARATION_AVAILABILITY')
    : 'ERR_RECKONING_PREPARATION_PARTIAL';
  error.status = first?.status || 503;
  error.retryable = first?.retryable !== false;
  error.cause = first || null;
  error.preparationProgress = Object.freeze({
    readyCount,
    totalCount,
    remainingCount: Math.max(0, totalCount - readyCount),
    failures: Object.freeze(
      (failures || []).map((failure) => Object.freeze({
        blueprintId: failure.blueprint?.id || null,
        evidenceId: failure.blueprint?.evidenceId || null,
        code: failure.error?.code || null,
        message: String(failure.error?.message || 'generation failed').slice(0, 500),
      }))
    ),
  });
  return error;
}

function createPreparationService({
  config = createReckoningConfig(),
  planner = createPlanner({ config }),
  questionBank = createQuestionBank({ config }),
  scheduler = createScheduler({ config }),
  randomUUID = crypto.randomUUID,
  getConcurrencyState = null,
} = {}) {
  async function generateWithRetry(blueprint, options = {}) {
    let lastError = null;
    let retryFeedback = null;
    const attempts = Math.max(
      1,
      Number(config.preparation.generationAttemptsPerItem) || 1
    );
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const generated = await questionBank.generate(blueprint, {
          ...options,
          attempt,
          retryFeedback,
        });
        return Object.freeze({
          ...generated,
          generationAttempts: attempt,
        });
      } catch (error) {
        lastError = error;
        error.generationAttempts = attempt;

        // Provider availability recovery belongs exclusively to the AI
        // orchestrator. The per-item loop is reserved for successful-provider
        // responses that fail Reckoning content validation.
        if (isAIAvailabilityError(error)) {
          throw error;
        }

        const issues = Array.isArray(error?.validationIssues)
          ? error.validationIssues.filter(Boolean)
          : [];
        retryFeedback = issues.length
          ? issues.join(', ')
          : String(error?.message || 'generation failed').slice(0, 240);
      }
    }
    throw lastError || new ReckoningContractError(
      `Question generation failed for blueprint ${blueprint.id}.`
    );
  }

  function buildManifest({
    cards = [],
    states = [],
    bubbleCardIds = [],
    metricsByCardId = {},
    context = {},
    deckIds = [],
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
      throw new ReckoningContractError(
        'Reckoning V2 produced an empty question blueprint bank.'
      );
    }
    if (blueprints.length > config.preparation.maxBankQuestions) {
      throw new ReckoningContractError(
        'Reckoning V2 question bank exceeded its configured cap.'
      );
    }

    const { familyOrder } = familyMetadata(blueprints);

    return Object.freeze({
      preparationVersion: config.preparationVersion,
      configVersion: config.configVersion,
      generationGroupId: generationGroupId || randomUUID(),
      plan,
      blueprints: Object.freeze([...blueprints]),
      familyOrder,
      deckIds: Object.freeze([...(deckIds || [])]),
      totalCount: blueprints.length,
      createdAt: now,
    });
  }

  async function prepare({
    cards = [],
    states = [],
    bubbleCardIds = [],
    metricsByCardId = {},
    context = {},
    deckIds = [],
    now = new Date(),
    generationGroupId = null,
    manifest = null,
    preparedItems = [],
    onQuestionReady = null,
    onQuestionFailure = null,
  } = {}) {
    const resolvedManifest = manifest || buildManifest({
      cards,
      states,
      bubbleCardIds,
      metricsByCardId,
      context,
      deckIds,
      now,
      generationGroupId,
    });

    const plan = resolvedManifest.plan;
    const blueprints = [...(resolvedManifest.blueprints || [])];
    const generationGroup =
      resolvedManifest.generationGroupId ||
      resolvedManifest.generation_group_id ||
      generationGroupId;

    if (!plan || !blueprints.length) {
      throw new ReckoningContractError(
        'Reckoning resumable preparation manifest is incomplete.'
      );
    }

    const { familyOrder, familyIndexById, itemIndexByBlueprint } =
      familyMetadata(blueprints);
    const blueprintIndex = new Map(
      blueprints.map((blueprint, index) => [String(blueprint.id), index])
    );

    const readyByBlueprint = new Map();
    for (const item of preparedItems || []) {
      if (persistedStatus(item) !== 'READY') continue;
      const question = persistedQuestion(item);
      const blueprintId = persistedBlueprintId(item);
      if (!question || !blueprintIndex.has(blueprintId)) continue;
      readyByBlueprint.set(blueprintId, Object.freeze({
        ...question,
        blueprint:
          question.blueprint ||
          blueprints[blueprintIndex.get(blueprintId)],
      }));
    }

    const families = new Map();
    for (const evidenceId of familyOrder) families.set(evidenceId, []);
    for (const blueprint of blueprints) {
      const evidenceId = String(blueprint.evidenceId || '');
      if (!families.has(evidenceId)) families.set(evidenceId, []);
      families.get(evidenceId).push(blueprint);
    }

    let stopNewFamilies = false;
    const failures = [];

    await mapWithAdaptiveConcurrency(
      familyOrder,
      {
        config,
        getConcurrencyState,
        shouldStop: () => stopNewFamilies,
      },
      async (evidenceId) => {
        const family = families.get(evidenceId) || [];
        let previousQuestion = null;

        for (const blueprint of family) {
          const blueprintId = String(blueprint.id);
          const existing = readyByBlueprint.get(blueprintId);
          if (existing) {
            previousQuestion = existing;
            continue;
          }

          try {
            const generated = await generateWithRetry(blueprint, {
              previousQuestion,
              requireSemanticReview: true,
              generationGroupId: generationGroup,
            });
            const globalIndex = blueprintIndex.get(blueprintId);
            const record = Object.freeze({
              ...toQuestionRecord(generated, globalIndex + 1),
              id: randomUUID(),
            });

            if (typeof onQuestionReady === 'function') {
              await onQuestionReady({
                blueprint,
                question: record,
                generationAttempts: generated.generationAttempts || 1,
                familyIndex: familyIndexById.get(String(blueprint.evidenceId)) || 0,
                itemIndex: itemIndexByBlueprint.get(blueprintId) || 0,
              });
            }

            readyByBlueprint.set(blueprintId, record);
            previousQuestion = record;
          } catch (error) {
            const failure = { blueprint, error };
            failures.push(failure);

            if (typeof onQuestionFailure === 'function') {
              await onQuestionFailure({
                blueprint,
                error,
                generationAttempts: error?.generationAttempts || 1,
                familyIndex: familyIndexById.get(String(blueprint.evidenceId)) || 0,
                itemIndex: itemIndexByBlueprint.get(blueprintId) || 0,
              }).catch(() => null);
            }

            if (isAIAvailabilityError(error)) {
              stopNewFamilies = true;
            }
            break;
          }
        }
      }
    );

    const readyCount = readyByBlueprint.size;
    if (readyCount !== blueprints.length || failures.length > 0) {
      throw createPartialPreparationError({
        failures,
        readyCount,
        totalCount: blueprints.length,
      });
    }

    const questions = blueprints.map((blueprint) => {
      const record = readyByBlueprint.get(String(blueprint.id));
      if (!record) {
        throw new ReckoningContractError(
          `Prepared Reckoning question missing for blueprint ${blueprint.id}.`
        );
      }
      return record;
    });

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
      manifest: resolvedManifest,
      plan,
      questions: Object.freeze(questions),
      readyCount,
      reusedCount: Math.max(
        0,
        (preparedItems || []).filter((item) => persistedStatus(item) === 'READY').length
      ),
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
      throw new ReckoningContractError(
        'Replacement generation requires a blueprint.'
      );
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
    buildManifest,
    prepare,
    generateReplacement,
    resolveFamilyConcurrency: (snapshot) =>
      resolveFamilyConcurrency(snapshot, config),
  });
}

module.exports = {
  familyCost,
  fitPlanToBank,
  toQuestionRecord,
  mapWithConcurrency,
  resolveFamilyConcurrency,
  mapWithAdaptiveConcurrency,
  familyMetadata,
  createPartialPreparationError,
  createPreparationService,
};
