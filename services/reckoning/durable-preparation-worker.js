'use strict';

const crypto = require('node:crypto');
const { createScheduler } = require('./scheduler');
const {
  toQuestionRecord,
  familyMetadata,
  createPreparationClaimLostError,
} = require('./preparation');
const { ReckoningContractError } = require('./errors');
const {
  AI_ERROR_CODES,
  isAIAvailabilityError,
} = require('../ai/errors');

const WORK_STATES = Object.freeze({
  NEEDS_GENERATION: 'NEEDS_GENERATION',
  GENERATING: 'GENERATING',
  NEEDS_AUDIT: 'NEEDS_AUDIT',
  AUDITING: 'AUDITING',
  RETRY_WAIT: 'RETRY_WAIT',
  READY: 'READY',
  TERMINAL_ERROR: 'TERMINAL_ERROR',
});

function rowBlueprintId(row) {
  return String(row?.blueprint_id || row?.blueprintId || '');
}

function rowStatus(row) {
  return String(row?.status || '').toUpperCase();
}

function rowWorkState(row) {
  if (rowStatus(row) === 'READY') return WORK_STATES.READY;
  if (row?.work_state) return String(row.work_state).toUpperCase();
  if (row?.candidate_question || row?.candidateQuestion) {
    return WORK_STATES.NEEDS_AUDIT;
  }
  return WORK_STATES.NEEDS_GENERATION;
}

function rowCandidate(row) {
  return row?.candidate_question || row?.candidateQuestion || null;
}

function rowQuestion(row) {
  return row?.generated_question || row?.generatedQuestion || null;
}

function rowRetryPhase(row) {
  const explicit = String(row?.retry_phase || row?.retryPhase || '').toUpperCase();
  if (explicit === 'AUDIT' || explicit === 'GENERATE') return explicit;
  return rowCandidate(row) ? 'AUDIT' : 'GENERATE';
}

function toMs(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function providerRetryAfterMs(error) {
  const seen = new Set();
  let current = error;
  let depth = 0;
  const values = [];

  while (current && depth < 6 && !seen.has(current)) {
    seen.add(current);
    const direct = Number(current.retryAfterMs);
    if (Number.isFinite(direct) && direct > 0) values.push(direct);

    const blocked = current.details?.providerBlockedModels;
    if (Array.isArray(blocked)) {
      for (const entry of blocked) {
        const value = Number(entry?.retryAfterMs);
        if (Number.isFinite(value) && value > 0) values.push(value);
      }
    }

    current = current.cause;
    depth += 1;
  }

  return values.length ? Math.min(...values) : null;
}

function durableRetryDelayMs(item, error, config, random = Math.random) {
  const epoch = Math.max(0, Number(item?.retry_epoch ?? item?.retryEpoch) || 0);
  const base = Math.max(
    1000,
    Number(config?.preparation?.durableRetryBaseMs) || 5000
  );
  const max = Math.max(
    base,
    Number(config?.preparation?.durableRetryMaxMs) || 300000
  );
  const providerDelay = providerRetryAfterMs(error);

  let raw;
  if (Number.isFinite(providerDelay) && providerDelay > 0) {
    raw = Math.max(base, providerDelay + 500);
  } else if (
    error?.code === AI_ERROR_CODES.RATE_LIMIT_RPD ||
    error?.code === AI_ERROR_CODES.CAPACITY_EXHAUSTED
  ) {
    raw = Math.max(60000, base * (2 ** Math.min(epoch, 6)));
  } else {
    raw = base * (2 ** Math.min(epoch, 6));
  }

  const jitter = 0.8 + (Math.max(0, Math.min(1, Number(random()) || 0)) * 0.4);
  return Math.max(1000, Math.min(max, Math.round(raw * jitter)));
}

function itemDue(row, nowMs) {
  if (!row || rowStatus(row) === 'READY') return false;
  if (rowWorkState(row) === WORK_STATES.TERMINAL_ERROR) return false;
  const next = toMs(row.next_attempt_at || row.nextAttemptAt);
  const lease = toMs(row.lease_expires_at || row.leaseExpiresAt);
  if (next != null && next > nowMs) return false;
  if (lease != null && lease > nowMs) return false;
  return true;
}

function createTerminalPreparationError(row, readyCount, totalCount) {
  const message = String(
    row?.last_error ||
    'A Reckoning question could not satisfy its assessment contract.'
  );
  const error = new ReckoningContractError(
    `${message} ${readyCount}/${totalCount} validated questions are safely persisted.`
  );
  error.code =
    row?.last_error_code ||
    'ERR_RECKONING_PREPARATION_ITEM_TERMINAL';
  error.status = 422;
  error.retryable = false;
  error.preparationProgress = Object.freeze({
    readyCount,
    totalCount,
    remainingCount: Math.max(0, totalCount - readyCount),
    terminalBlueprintId: rowBlueprintId(row) || null,
  });
  return error;
}

function createDurablePreparationWorker({
  config,
  preparationService,
  scheduler = createScheduler({ config }),
  randomUUID = crypto.randomUUID,
  clock = () => new Date(),
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  getConcurrencyState = null,
  random = Math.random,
} = {}) {
  if (!preparationService) {
    throw new ReckoningContractError(
      'Durable Reckoning preparation requires a preparation service.'
    );
  }

  function nowMs() {
    const value = clock();
    if (value instanceof Date) return value.getTime();
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : Date.now();
  }

  function buildPreparedResult(manifest, rows, initialReadyCount = 0) {
    const blueprints = [...(manifest.blueprints || [])];
    const byBlueprint = new Map(
      rows.map((row) => [rowBlueprintId(row), row])
    );
    const questions = blueprints.map((blueprint) => {
      const row = byBlueprint.get(String(blueprint.id));
      const question = rowQuestion(row);
      if (rowStatus(row) !== 'READY' || !question) {
        throw new ReckoningContractError(
          `Durable Reckoning bank is missing READY question for blueprint ${blueprint.id}.`
        );
      }
      return Object.freeze({
        ...question,
        blueprint: question.blueprint || blueprint,
      });
    });

    const schedulerQuestions = questions.map((question) => ({
      id: question.id,
      evidenceId: question.evidenceId,
      role: question.role,
      variantIndex: question.variantIndex,
      selectedOption: null,
    }));
    const first = scheduler.chooseNext({
      evidence: manifest.plan.evidence,
      questions: schedulerQuestions,
      questionsUsed: 0,
      lastEvidenceId: null,
    });
    if (first.type !== 'QUESTION') {
      throw new ReckoningContractError(
        'Durable Reckoning could not select an initial diagnostic/control question.'
      );
    }

    return Object.freeze({
      preparationVersion: config.preparationVersion,
      manifest,
      plan: manifest.plan,
      questions: Object.freeze(questions),
      readyCount: questions.length,
      reusedCount: Math.max(0, initialReadyCount),
      firstQuestionId: first.questionId,
      firstQuestionNumber:
        questions.find((question) => question.id === first.questionId)?.questionNumber || 1,
      firstEvidenceId: first.evidenceId,
      generatedAt: new Date(nowMs()),
    });
  }

  function firstIncompleteRowsByFamily(manifest, rows) {
    const byBlueprint = new Map(
      rows.map((row) => [rowBlueprintId(row), row])
    );
    const blueprints = [...(manifest.blueprints || [])];
    const { familyOrder } = familyMetadata(blueprints);
    const grouped = new Map(familyOrder.map((id) => [String(id), []]));

    for (const blueprint of blueprints) {
      const evidenceId = String(blueprint.evidenceId || '');
      if (!grouped.has(evidenceId)) grouped.set(evidenceId, []);
      grouped.get(evidenceId).push(blueprint);
    }

    const selected = [];
    for (const evidenceId of familyOrder) {
      const family = grouped.get(String(evidenceId)) || [];
      for (const blueprint of family) {
        const row = byBlueprint.get(String(blueprint.id));
        if (rowStatus(row) === 'READY') continue;
        selected.push({ blueprint, row });
        break;
      }
    }
    return selected;
  }

  function previousReadyQuestion(manifest, rows, blueprint) {
    const blueprints = [...(manifest.blueprints || [])];
    const sameFamily = blueprints.filter(
      (candidate) => String(candidate.evidenceId) === String(blueprint.evidenceId)
    );
    const index = sameFamily.findIndex(
      (candidate) => String(candidate.id) === String(blueprint.id)
    );
    if (index <= 0) return null;

    const previousId = String(sameFamily[index - 1].id);
    const previousRow = rows.find(
      (row) => rowBlueprintId(row) === previousId
    );
    return rowStatus(previousRow) === 'READY'
      ? rowQuestion(previousRow)
      : null;
  }

  function retryOperationId(reckoningId, blueprintId, phase, epoch) {
    return [
      'reckoning',
      reckoningId,
      'item',
      blueprintId,
      String(phase || 'GENERATE').toLowerCase(),
      'epoch',
      Math.max(0, Number(epoch) || 0),
    ].join(':');
  }

  async function processClaimedItem({
    store,
    reckoningId,
    userId,
    claimId,
    manifest,
    rowsSnapshot,
    claimed,
    blueprint,
  }) {
    const leaseToken = claimed.lease_token;
    if (!leaseToken) {
      throw new ReckoningContractError(
        'Durable Reckoning work item was claimed without a lease token.'
      );
    }

    const phase = rowRetryPhase(claimed);
    const retryEpoch = Math.max(0, Number(claimed.retry_epoch) || 0);
    const operationBudgetId = retryOperationId(
      reckoningId,
      blueprint.id,
      phase,
      retryEpoch
    );
    const previousQuestion = previousReadyQuestion(
      manifest,
      rowsSnapshot,
      blueprint
    );

    try {
      if (phase === 'AUDIT' && rowCandidate(claimed)) {
        await preparationService.auditCandidate(
          blueprint,
          rowCandidate(claimed),
          {
            previousQuestion,
            generationGroupId: manifest.generationGroupId,
            operationBudgetId,
          }
        );

        const globalIndex = manifest.blueprints.findIndex(
          (entry) => String(entry.id) === String(blueprint.id)
        );
        const record = Object.freeze({
          ...toQuestionRecord(
            {
              blueprint,
              question: rowCandidate(claimed),
            },
            globalIndex + 1
          ),
          id: randomUUID(),
        });

        const saved = await store.savePreparationWorkItemReady(
          reckoningId,
          userId,
          {
            blueprint,
            question: record,
            claimId,
            leaseToken,
          }
        );
        if (!saved) throw createPreparationClaimLostError();
        return Object.freeze({ outcome: 'READY', blueprintId: blueprint.id });
      }

      const generated = await preparationService.generateCandidateWithRetry(
        blueprint,
        {
          previousQuestion,
          generationGroupId: manifest.generationGroupId,
          operationBudgetId,
        }
      );
      const saved = await store.savePreparationItemCandidate(
        reckoningId,
        userId,
        {
          blueprint,
          candidate: generated.question,
          generationAttempts: generated.generationAttempts || 1,
          claimId,
          leaseToken,
        }
      );
      if (!saved) throw createPreparationClaimLostError();
      return Object.freeze({
        outcome: 'CANDIDATE_READY',
        blueprintId: blueprint.id,
      });
    } catch (error) {
      if (error?.code === 'ERR_RECKONING_PREPARATION_CLAIM_LOST') {
        throw error;
      }

      if (isAIAvailabilityError(error)) {
        const delayMs = durableRetryDelayMs(claimed, error, config, random);
        const saved = await store.schedulePreparationItemRetry(
          reckoningId,
          userId,
          {
            blueprintId: blueprint.id,
            phase,
            error,
            nextAttemptAt: new Date(nowMs() + delayMs),
            claimId,
            leaseToken,
          }
        );
        if (!saved) throw createPreparationClaimLostError();
        return Object.freeze({
          outcome: 'RETRY_WAIT',
          blueprintId: blueprint.id,
          phase,
          delayMs,
          code: error.code || null,
        });
      }

      if (
        phase === 'AUDIT' &&
        error?.code === 'ERR_RECKONING_QUESTION_SEMANTICS'
      ) {
        const saved = await store.savePreparationItemAuditRejection(
          reckoningId,
          userId,
          {
            blueprintId: blueprint.id,
            error,
            maxRevisions:
              config.preparation.semanticRegenerationAttempts || 3,
            claimId,
            leaseToken,
          }
        );
        if (!saved) throw createPreparationClaimLostError();
        return Object.freeze({
          outcome:
            rowWorkState(saved) === WORK_STATES.TERMINAL_ERROR
              ? 'TERMINAL_ERROR'
              : 'NEEDS_REGENERATION',
          blueprintId: blueprint.id,
        });
      }

      const saved = await store.savePreparationItemTerminal(
        reckoningId,
        userId,
        {
          blueprintId: blueprint.id,
          error,
          claimId,
          leaseToken,
        }
      );
      if (!saved) throw createPreparationClaimLostError();
      return Object.freeze({
        outcome: 'TERMINAL_ERROR',
        blueprintId: blueprint.id,
        code: error?.code || null,
      });
    }
  }

  async function run({
    store,
    reckoningId,
    userId,
    claimId,
    manifest,
    shouldAbort = null,
  } = {}) {
    if (!store || !reckoningId || !userId || !claimId || !manifest) {
      throw new ReckoningContractError(
        'Durable preparation requires store, reckoningId, userId, claimId and manifest.'
      );
    }

    const blueprints = [...(manifest.blueprints || [])];
    const { familyIndexById, itemIndexByBlueprint } = familyMetadata(blueprints);
    const workItems = blueprints.map((blueprint) => ({
      blueprintId: String(blueprint.id),
      evidenceId: String(blueprint.evidenceId),
      familyIndex:
        familyIndexById.get(String(blueprint.evidenceId)) || 0,
      itemIndex: itemIndexByBlueprint.get(String(blueprint.id)) || 0,
    }));

    const ensured = await store.ensurePreparationWorkItems(
      reckoningId,
      userId,
      workItems,
      claimId
    );
    if (ensured < workItems.length) {
      const owned = await store.ownsPreparationClaim(
        reckoningId,
        userId,
        claimId
      );
      if (!owned) throw createPreparationClaimLostError();
    }

    let rows = await store.getPreparationItems(reckoningId, userId);
    const initialReadyCount = rows.filter(
      (row) => rowStatus(row) === 'READY'
    ).length;

    for (;;) {
      if (typeof shouldAbort === 'function' && shouldAbort()) {
        throw createPreparationClaimLostError();
      }

      rows = await store.getPreparationItems(reckoningId, userId);
      const readyCount = rows.filter(
        (row) => rowStatus(row) === 'READY'
      ).length;

      if (readyCount >= blueprints.length) {
        return buildPreparedResult(manifest, rows, initialReadyCount);
      }

      const terminal = rows.find(
        (row) => rowWorkState(row) === WORK_STATES.TERMINAL_ERROR
      );
      if (terminal) {
        throw createTerminalPreparationError(
          terminal,
          readyCount,
          blueprints.length
        );
      }

      const currentNow = nowMs();
      const candidates = firstIncompleteRowsByFamily(manifest, rows)
        .filter(({ row }) => row && itemDue(row, currentNow));

      if (candidates.length === 0) {
        const futureTimes = [];
        for (const row of rows) {
          if (
            rowStatus(row) === 'READY' ||
            rowWorkState(row) === WORK_STATES.TERMINAL_ERROR
          ) {
            continue;
          }
          const next = toMs(row.next_attempt_at || row.nextAttemptAt);
          const lease = toMs(row.lease_expires_at || row.leaseExpiresAt);
          if (next != null && next > currentNow) futureTimes.push(next);
          if (lease != null && lease > currentNow) futureTimes.push(lease);
        }

        const maxPoll = Math.max(
          1000,
          Number(config.preparation.durableWorkerPollMaxMs) || 20000
        );
        const earliest = futureTimes.length
          ? Math.min(...futureTimes)
          : currentNow + 1000;
        const delay = Math.max(
          250,
          Math.min(maxPoll, Math.max(250, earliest - currentNow))
        );
        await sleepImpl(delay);
        continue;
      }

      const desiredConcurrency = Math.max(
        1,
        Number(config.preparation.durableWorkerConcurrency) || 2
      );
      const routeConcurrency =
        typeof getConcurrencyState === 'function' &&
        typeof preparationService.resolveFamilyConcurrency === 'function'
          ? preparationService.resolveFamilyConcurrency(getConcurrencyState())
          : desiredConcurrency;
      const concurrency = Math.max(
        1,
        Math.min(desiredConcurrency, Number(routeConcurrency) || 1)
      );

      let cursor = 0;
      const workerCount = Math.min(concurrency, candidates.length);
      const workers = Array.from({ length: workerCount }, async () => {
        while (cursor < candidates.length) {
          const index = cursor++;
          const { blueprint } = candidates[index];
          const leaseToken = randomUUID();
          const claimed = await store.leasePreparationWorkItem(
            reckoningId,
            userId,
            blueprint.id,
            {
              claimId,
              leaseToken,
              leaseSeconds:
                config.preparation.durableItemLeaseSeconds || 240,
            }
          );
          if (!claimed) continue;

          await processClaimedItem({
            store,
            reckoningId,
            userId,
            claimId,
            manifest,
            rowsSnapshot: rows,
            claimed,
            blueprint,
          });
        }
      });

      await Promise.all(workers);
    }
  }

  return Object.freeze({
    name: 'reckoning-durable-preparation-worker',
    version: 1,
    run,
    durableRetryDelayMs: (item, error) =>
      durableRetryDelayMs(item, error, config, random),
  });
}

module.exports = {
  WORK_STATES,
  durableRetryDelayMs,
  createDurablePreparationWorker,
};
