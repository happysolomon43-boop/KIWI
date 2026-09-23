'use strict';

const { AI_TASKS, RETRY_POLICY_CONFIG } = require('./task-registry');
const { createModelCatalog, MODEL_STATUS } = require('./model-catalog');
const { createModelRouter } = require('./model-router');
const { createProjectPool } = require('./project-pool');
const { createGeminiTransport } = require('./gemini-transport');
const { normalizeGeminiResponse } = require('./response-normalizer');
const { createProviderHealth, MODEL_AVAILABILITY_CODES } = require('./provider-health');
const { createAITrafficController } = require('./traffic-controller');
const {
  AIError,
  AI_ERROR_CODES,
  safetyError,
} = require('./errors');

const IMMEDIATE_FAILURE_CODES = new Set([
  AI_ERROR_CODES.CONFIG,
  AI_ERROR_CODES.BAD_REQUEST,
  AI_ERROR_CODES.SAFETY,
]);

const FAST_MODEL_FALLBACK_CODES = new Set([
  AI_ERROR_CODES.PROVIDER_OVERLOADED,
  AI_ERROR_CODES.TRANSIENT,
  AI_ERROR_CODES.TIMEOUT,
  AI_ERROR_CODES.NETWORK,
  AI_ERROR_CODES.EMPTY_RESPONSE,
]);

const PROJECT_SLOT_QUOTA_CODES = new Set([
  AI_ERROR_CODES.RATE_LIMIT_RPM,
  AI_ERROR_CODES.RATE_LIMIT_TPM,
  AI_ERROR_CODES.RATE_LIMIT_RPD,
  AI_ERROR_CODES.RATE_LIMIT_UNKNOWN,
]);

const DEFAULT_RETRY_POLICY = Object.freeze({
  maxAttempts: 6,
  maxAttemptsPerModel: 2,
  maxTransientAttemptsPerModel: 1,
});

function validateFeatureGenerationConfig(generationConfig = {}) {
  if (
    Object.prototype.hasOwnProperty.call(generationConfig, 'thinkingConfig') ||
    Object.prototype.hasOwnProperty.call(generationConfig, 'thinking_level') ||
    Object.prototype.hasOwnProperty.call(generationConfig, 'thinkingLevel')
  ) {
    throw new AIError(
      'Feature code cannot set provider thinking configuration; use the AI task registry',
      {
        code: AI_ERROR_CODES.CONFIG,
        retryable: false,
        scope: 'REQUEST',
      }
    );
  }

  return { ...generationConfig };
}

function createAIOrchestrator({
  registry = AI_TASKS,
  catalog = createModelCatalog(),
  router = null,
  projectPool = null,
  quotaManager = null,
  telemetry = null,
  modelLifecycle = null,
  providerHealth = null,
  trafficController = null,
  transport = null,
  normalizer = normalizeGeminiResponse,
  logger = console,
  env = process.env,
  clock = () => Date.now(),
} = {}) {
  const resolvedRouter = router || createModelRouter({ registry, catalog });
  const resolvedProjectPool = projectPool || createProjectPool({ env });
  const resolvedTransport = transport || createGeminiTransport();

  function boundedEnvNumber(name, fallback, min, max) {
    const parsed = Number(env?.[name]);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(parsed, max));
  }

  function nowMs() {
    const value = clock();
    if (value instanceof Date) return value.getTime();
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : Date.now();
  }

  // Provider/model availability is intentionally separate from persistent
  // project+model quota state. A single 503 does not quarantine a model; the
  // circuit opens only after independent project slots corroborate the outage.
  const resolvedProviderHealth = providerHealth || createProviderHealth({
    clock,
    failureEvidenceWindowMs: boundedEnvNumber(
      'AI_PROVIDER_FAILURE_EVIDENCE_WINDOW_MS',
      30000,
      5000,
      300000
    ),
    openCooldownMs: boundedEnvNumber(
      'AI_MODEL_TRANSIENT_COOLDOWN_MS',
      20000,
      5000,
      120000
    ),
    minDistinctFailureSlots: boundedEnvNumber(
      'AI_PROVIDER_FAILURE_EVIDENCE_SLOTS',
      2,
      1,
      5
    ),
  });
  const resolvedTrafficController = trafficController || createAITrafficController({
    env,
    clock,
  });

  function retryPolicyFor(task) {
    return RETRY_POLICY_CONFIG[task?.retryPolicy] || DEFAULT_RETRY_POLICY;
  }

  // Multi-call workflows (CBT generation + completion/repair passes) should not
  // bounce back up to a stronger model after already falling back. Affinity is
  // process-local, bounded, and keyed only by an opaque generation group ID.
  const generationAffinity = new Map();
  const AFFINITY_TTL_MS = 30 * 60 * 1000;

  function affinityKey(task, generationGroupId) {
    if (!generationGroupId || !task?.affinityGroup) return null;
    return `${task.affinityGroup}::${generationGroupId}`;
  }

  function getAffinity(task, generationGroupId) {
    const key = affinityKey(task, generationGroupId);
    if (!key) return null;
    const entry = generationAffinity.get(key);
    if (!entry) return null;
    if (Date.now() - entry.updatedAt > AFFINITY_TTL_MS) {
      generationAffinity.delete(key);
      return null;
    }
    return entry.modelId;
  }

  function setAffinity(task, generationGroupId, modelId) {
    const key = affinityKey(task, generationGroupId);
    if (!key || !modelId) return;

    const current = generationAffinity.get(key);
    if (!current) {
      generationAffinity.set(key, { modelId, updatedAt: Date.now() });
      return;
    }

    if (current.modelId === modelId) {
      current.updatedAt = Date.now();
      return;
    }

    const currentModel = catalog.get(current.modelId);
    const nextModel = catalog.get(modelId);

    // Once a multi-call workflow falls back, keep that lower model as the
    // ceiling for later repair/completion calls. Parallel calls may finish out
    // of order, so a late stronger-model success must not upgrade affinity.
    if (!currentModel || !nextModel || nextModel.rank <= currentModel.rank) {
      generationAffinity.set(key, { modelId, updatedAt: Date.now() });
    }
  }

  async function sideEffect(label, fn) {
    if (typeof fn !== 'function') return null;
    try {
      return await fn();
    } catch (error) {
      if (typeof logger?.warn === 'function') {
        logger.warn(`[KIWI AI] ${label} failed`, {
          error: error?.message || String(error),
        });
      }
      return null;
    }
  }

  async function initialize() {
    const hydrated = quotaManager
      ? await sideEffect('quota hydration', () => quotaManager.hydrate())
      : 0;
    const hydratedProviderHealth = resolvedProviderHealth?.hydrate
      ? await sideEffect('provider health hydration', () => resolvedProviderHealth.hydrate())
      : 0;

    return Object.freeze({
      projectSlots: resolvedProjectPool.enabledCount(),
      hydratedProjectModelStates: Number(hydrated) || 0,
      hydratedProviderModelHealth: Number(hydratedProviderHealth) || 0,
    });
  }

  function slotsForModel(modelId, { advance = false } = {}) {
    const ordered = advance
      ? resolvedProjectPool.orderedSlots(modelId)
      : resolvedProjectPool.peekOrderedSlots(modelId);

    return quotaManager
      ? quotaManager.filterEligibleSlots(modelId, ordered)
      : ordered;
  }

  function plan(taskId, { preferredModelId = null } = {}) {
    const candidates = resolvedRouter.resolveCandidates(taskId, { preferredModelId });
    const routedCandidates = candidates.map((candidate) => {
      const providerAvailability = resolvedProviderHealth.availability(candidate.modelId);
      const eligibleSlots = providerAvailability.available
        ? slotsForModel(candidate.modelId, { advance: false })
        : [];
      return Object.freeze({
        modelId: candidate.modelId,
        class: candidate.class,
        requestedReasoning: candidate.requestedReasoning,
        resolvedReasoning: candidate.resolvedReasoning,
        timeoutMs: candidate.timeoutMs,
        qualityFloor: candidate.qualityFloor,
        temporarilyUnavailable: !providerAvailability.available,
        providerCircuitState: providerAvailability.state,
        providerRetryAfterMs: providerAvailability.retryAfterMs,
        transientCooldownUntil:
          !providerAvailability.available && providerAvailability.retryAfterMs
            ? new Date(nowMs() + providerAvailability.retryAfterMs).toISOString()
            : null,
        eligibleProjectSlots: Object.freeze(eligibleSlots.map((slot) => slot.id)),
      });
    });

    const firstRoutable = routedCandidates.find((candidate) => candidate.eligibleProjectSlots.length > 0);

    return Object.freeze({
      taskId,
      candidates: Object.freeze(routedCandidates),
      plannedPrimaryModel: firstRoutable?.modelId || routedCandidates[0]?.modelId || null,
      plannedPrimaryProjectSlot: firstRoutable?.eligibleProjectSlots?.[0] || null,
      projectSlots: Object.freeze(resolvedProjectPool.snapshot()),
    });
  }

  async function observe(taskId, {
    legacyModel = null,
    preferredModelId = null,
  } = {}) {
    const task = resolvedRouter.getTask(taskId);
    const shadowPlan = plan(taskId, { preferredModelId });

    await sideEffect('shadow telemetry', () => telemetry?.recordShadowDecision({
      taskId,
      taskClass: task.class,
      requestedReasoning: task.reasoning,
      candidateModels: shadowPlan.candidates,
      legacyModel,
      plannedProjectSlot: shadowPlan.plannedPrimaryProjectSlot,
    }));

    return shadowPlan;
  }

  async function run(taskId, request = {}, {
    preferredModelId = null,
    generationGroupId = null,
  } = {}) {
    const task = resolvedRouter.getTask(taskId);
    const affinityModelId = preferredModelId || getAffinity(task, generationGroupId);
    const routedCandidates = resolvedRouter.resolveCandidates(taskId, {
      preferredModelId: affinityModelId,
    });
    const firstAvailableCandidate = routedCandidates.find(
      (candidate) => resolvedProviderHealth.availability(candidate.modelId).available
    );
    if (
      !affinityModelId &&
      generationGroupId &&
      task.affinityGroup &&
      firstAvailableCandidate
    ) {
      setAffinity(task, generationGroupId, firstAvailableCandidate.modelId);
    }
    const featureGenerationConfig = validateFeatureGenerationConfig(
      request.generationConfig || {}
    );

    const content =
      request.content !== undefined ? request.content :
      request.contents !== undefined ? request.contents :
      request.prompt !== undefined ? request.prompt :
      '';

    if (resolvedProjectPool.enabledCount() === 0) {
      throw new AIError('No enabled Gemini project slots are configured', {
        code: AI_ERROR_CODES.CONFIG,
        retryable: false,
        scope: 'REQUEST',
      });
    }

    const plannedModels = routedCandidates.map((candidate) => candidate.modelId);
    const retryPolicy = retryPolicyFor(task);
    const requestId = telemetry
      ? await sideEffect('telemetry begin', () => telemetry.beginRequest({
          taskId,
          taskClass: task.class,
          mode: 'LIVE',
          requestedReasoning: task.reasoning,
          plannedModels,
          plannedPrimaryModel: plannedModels[0] || null,
          generationGroupId,
        }))
      : null;

    const attempts = [];
    const requestStarted = Date.now();
    let lastError = null;
    let hadEligibleRoute = false;
    const providerBlockedModels = [];
    let trafficLease = null;
    let queueWaitMs = 0;
    let admissionLimit = null;
    let congestionLevel = null;

    async function finishFailure(error, outcome = 'FAILED') {
      await sideEffect('telemetry finish failure', () => telemetry?.finishRequest(requestId, {
        taskId,
        taskClass: task.class,
        mode: 'LIVE',
        outcome,
        fallbackDepth: Math.max(0, attempts.length ? (new Set(attempts.map((a) => a.modelId)).size - 1) : 0),
        attemptCount: attempts.length,
        latencyMs: Date.now() - requestStarted,
        usage: {},
        errorCode: error?.code || AI_ERROR_CODES.UNKNOWN,
        queueWaitMs,
        admissionLimit,
        congestionLevel,
      }));
    }

    try {
      trafficLease = await resolvedTrafficController.acquire({
        taskId,
        taskClass: task.class,
        timeoutMs: task.timeoutMs,
      });
      queueWaitMs = Number(trafficLease?.queueWaitMs) || 0;
      admissionLimit = trafficLease?.admissionLimit ?? null;
      congestionLevel = trafficLease?.congestionLevel || null;
    } catch (error) {
      queueWaitMs = Number(error?.details?.queueWaitMs) || 0;
      const trafficState = resolvedTrafficController.snapshot();
      admissionLimit = trafficState.effectiveConcurrency;
      congestionLevel = trafficState.congestionLevel;
      await finishFailure(error);
      throw error;
    }

    try {
    modelLoop:
    for (let modelIndex = 0; modelIndex < routedCandidates.length; modelIndex++) {
      const candidate = routedCandidates[modelIndex];
      const slots = slotsForModel(candidate.modelId, { advance: true });
      if (slots.length > 0) hadEligibleRoute = true;
      if (slots.length === 0) continue;
      if (attempts.length >= retryPolicy.maxAttempts) break modelLoop;

      const providerLease = resolvedProviderHealth.acquire(candidate.modelId);
      if (!providerLease.available) {
        providerBlockedModels.push(Object.freeze({
          modelId: candidate.modelId,
          state: providerLease.state,
          retryAfterMs: providerLease.retryAfterMs,
        }));
        continue;
      }

      let skipRemainingSlotsForModel = false;
      let modelAttemptCount = 0;
      let modelQuotaAttemptCount = 0;
      let modelTransientAttemptCount = 0;

      for (const slot of slots) {
        if (attempts.length >= retryPolicy.maxAttempts) {
          resolvedProviderHealth.release(candidate.modelId);
          break modelLoop;
        }

        const attemptNumber = attempts.length + 1;
        const attemptStarted = Date.now();
        const generationConfig = {
          ...featureGenerationConfig,
          ...candidate.thinkingGenerationConfig,
        };

        try {
          const transportResult = await resolvedTransport.generate({
            apiKey: slot.apiKey,
            modelId: candidate.modelId,
            content,
            generationConfig,
            timeoutMs: candidate.timeoutMs,
          });

          const normalized = normalizer(transportResult.raw, {
            modelId: candidate.modelId,
            slotId: slot.id,
            latencyMs: transportResult.latencyMs,
            fallbackDepth: modelIndex,
            generationGroupId,
          });

          if (normalized.blocked) {
            throw safetyError({
              finishReason: normalized.finishReason,
              blockReason: normalized.blockReason,
            });
          }

          if (!normalized.text) {
            throw new AIError('Gemini returned no visible text', {
              code: AI_ERROR_CODES.EMPTY_RESPONSE,
              retryable: true,
              scope: 'ATTEMPT',
            });
          }

          await sideEffect('quota success', () => quotaManager?.markSuccess(
            slot.id,
            candidate.modelId
          ));
          const providerBeforeSuccess = resolvedProviderHealth.snapshot(candidate.modelId);
          resolvedProviderHealth.recordSuccess(candidate.modelId);
          resolvedTrafficController.noteSuccess();
          if (
            providerBeforeSuccess.state !== 'CLOSED' ||
            providerBeforeSuccess.distinctFailureSlots > 0 ||
            providerBeforeSuccess.lastErrorCode
          ) {
            await sideEffect('provider health recovery persistence', () =>
              resolvedProviderHealth.persist?.(candidate.modelId)
            );
          }
          await sideEffect('model lifecycle success', () => modelLifecycle?.recordSuccess(
            candidate.modelId
          ));

          await sideEffect('telemetry success attempt', () => telemetry?.recordAttempt({
            requestId,
            attemptNumber,
            modelId: candidate.modelId,
            projectSlot: slot.id,
            outcome: 'SUCCESS',
            finishReason: normalized.finishReason,
            latencyMs: transportResult.latencyMs,
            inputTokens: normalized.usage.inputTokens,
            outputTokens: normalized.usage.outputTokens,
            thoughtTokens: normalized.usage.thoughtTokens,
            totalTokens: normalized.usage.totalTokens,
            startedAt: new Date(attemptStarted),
            completedAt: new Date(),
          }));

          setAffinity(task, generationGroupId, candidate.modelId);

          await sideEffect('telemetry finish success', () => telemetry?.finishRequest(requestId, {
            taskId,
            taskClass: task.class,
            mode: 'LIVE',
            selectedModel: candidate.modelId,
            selectedProjectSlot: slot.id,
            outcome: 'SUCCESS',
            fallbackDepth: modelIndex,
            attemptCount: attemptNumber,
            latencyMs: Date.now() - requestStarted,
            usage: normalized.usage,
            finishReason: normalized.finishReason,
            queueWaitMs,
            admissionLimit,
            congestionLevel,
          }));

          return Object.freeze({
            ...normalized,
            taskId,
            class: task.class,
            requestedReasoning: candidate.requestedReasoning,
            resolvedReasoning: candidate.resolvedReasoning,
            attempts: attemptNumber,
          });
        } catch (error) {
          const aiError = error instanceof AIError
            ? error
            : new AIError(error?.message || 'Unknown AI failure', {
                code: AI_ERROR_CODES.UNKNOWN,
                retryable: false,
                scope: 'REQUEST',
                cause: error,
              });

          lastError = aiError;
          resolvedTrafficController.noteFailure(aiError, {
            modelId: candidate.modelId,
            projectSlot: slot.id,
          });
          const isProjectSlotQuotaFailure = PROJECT_SLOT_QUOTA_CODES.has(aiError.code);
          const isProviderAvailabilityFailure = MODEL_AVAILABILITY_CODES.has(aiError.code);
          if (isProjectSlotQuotaFailure) modelQuotaAttemptCount += 1;
          else modelAttemptCount += 1;

          const providerState = isProviderAvailabilityFailure
            ? resolvedProviderHealth.recordFailure(
                candidate.modelId,
                slot.id,
                aiError,
                { totalEligibleSlots: slots.length }
              )
            : null;
          if (isProviderAvailabilityFailure) {
            await sideEffect('provider health failure persistence', () =>
              resolvedProviderHealth.persist?.(candidate.modelId)
            );
          }

          attempts.push(Object.freeze({
            modelId: candidate.modelId,
            slotId: slot.id,
            code: aiError.code,
            status: aiError.status,
          }));

          await sideEffect('quota failure', () => quotaManager?.markFailure(
            slot.id,
            candidate.modelId,
            aiError
          ));

          await sideEffect('telemetry failed attempt', () => telemetry?.recordAttempt({
            requestId,
            attemptNumber,
            modelId: candidate.modelId,
            projectSlot: slot.id,
            outcome: aiError.code === AI_ERROR_CODES.SAFETY ? 'BLOCKED' : 'FAILED',
            errorCode: aiError.code,
            httpStatus: aiError.status,
            latencyMs: Date.now() - attemptStarted,
            startedAt: new Date(attemptStarted),
            completedAt: new Date(),
          }));

          if (typeof logger?.warn === 'function') {
            logger.warn('[KIWI AI] attempt failed', {
              taskId,
              modelId: candidate.modelId,
              slotId: slot.id,
              code: aiError.code,
              status: aiError.status,
              attempt: attemptNumber,
            });
          }

          const lifecycleResult = await sideEffect(
            'model lifecycle failure',
            () => modelLifecycle?.recordFailure(candidate.modelId, aiError)
          );

          // A newly auto-promoted model may reveal an incompatibility that the
          // synthetic qualification did not cover. If the lifecycle circuit
          // breaker suspends it, fall through to the previous approved model
          // instead of failing the learner's request.
          if (lifecycleResult?.suspended && aiError.code !== AI_ERROR_CODES.SAFETY) {
            skipRemainingSlotsForModel = true;
            break;
          }

          if (IMMEDIATE_FAILURE_CODES.has(aiError.code)) {
            resolvedProviderHealth.release(candidate.modelId);
            await finishFailure(
              aiError,
              aiError.code === AI_ERROR_CODES.SAFETY ? 'BLOCKED' : 'FAILED'
            );
            throw aiError;
          }

          if (aiError.code === AI_ERROR_CODES.AUTH) {
            // Authentication is key/project-wide, not model-specific.
            resolvedProjectPool.disable(slot.id, aiError.code);
            continue;
          }

          if (aiError.code === AI_ERROR_CODES.MODEL_NOT_FOUND) {
            // A model-level 404 should not burn the remaining project pool.
            if (modelLifecycle) {
              await sideEffect('model suspension', () => modelLifecycle.suspend(
                candidate.modelId,
                'provider returned MODEL_NOT_FOUND'
              ));
            } else {
              catalog.setStatus(candidate.modelId, MODEL_STATUS.SUSPENDED);
            }
            skipRemainingSlotsForModel = true;
            break;
          }

          if (
            aiError.retryable ||
            aiError.code === AI_ERROR_CODES.EMPTY_RESPONSE
          ) {
            if (isProjectSlotQuotaFailure) {
              // Quota is tied to this project+model route. Keep the same model
              // and rotate to another healthy key before degrading model quality.
              if (
                modelQuotaAttemptCount >=
                (retryPolicy.maxQuotaAttemptsPerModel || retryPolicy.maxAttemptsPerModel)
              ) {
                skipRemainingSlotsForModel = true;
                break;
              }
              continue;
            }

            if (FAST_MODEL_FALLBACK_CODES.has(aiError.code)) {
              modelTransientAttemptCount += 1;

              if (
                providerState?.state === 'OPEN' ||
                modelTransientAttemptCount >=
                  retryPolicy.maxTransientAttemptsPerModel
              ) {
                skipRemainingSlotsForModel = true;
                break;
              }
            }

            if (modelAttemptCount >= retryPolicy.maxAttemptsPerModel) {
              skipRemainingSlotsForModel = true;
              break;
            }

            continue;
          }

          resolvedProviderHealth.release(candidate.modelId);
          await finishFailure(aiError);
          throw aiError;
        }
      }

      resolvedProviderHealth.release(candidate.modelId);
      if (skipRemainingSlotsForModel) continue;
    }

    const blockedOnlyByProviderHealth =
      attempts.length === 0 &&
      hadEligibleRoute &&
      providerBlockedModels.length > 0;
    const providerRetryAfterMs = providerBlockedModels
      .map((entry) => Number(entry.retryAfterMs))
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b)[0] || null;

    const finalCode = lastError?.code || (
      blockedOnlyByProviderHealth
        ? AI_ERROR_CODES.PROVIDER_OVERLOADED
        : hadEligibleRoute
          ? AI_ERROR_CODES.UNKNOWN
          : AI_ERROR_CODES.CAPACITY_EXHAUSTED
    );
    const finalMessage = lastError
      ? `All approved routes failed for AI task ${taskId}`
      : blockedOnlyByProviderHealth
        ? `Approved models are temporarily unavailable for AI task ${taskId}`
        : `No healthy project/model capacity is currently available for AI task ${taskId}`;
    const finalError = new AIError(
      finalMessage,
      {
        code: finalCode,
        status: lastError?.status || (
          blockedOnlyByProviderHealth ? 503 : null
        ),
        retryable: lastError
          ? Boolean(lastError.retryable)
          : blockedOnlyByProviderHealth,
        retryAfterMs: lastError?.retryAfterMs || providerRetryAfterMs,
        scope: blockedOnlyByProviderHealth ? 'PROVIDER' : 'REQUEST',
        details: {
          attempts,
          lastErrorCode: lastError?.code || null,
          hadEligibleRoute,
          blockedOnlyByProviderHealth,
          providerBlockedModels,
          retryPolicy: task.retryPolicy,
          maxAttempts: retryPolicy.maxAttempts,
          maxQuotaAttemptsPerModel: retryPolicy.maxQuotaAttemptsPerModel || null,
          maxTransientAttemptsPerModel: retryPolicy.maxTransientAttemptsPerModel || null,
          temporarilyUnavailableModels: providerBlockedModels.map((entry) => entry.modelId),
        },
        cause: lastError,
      }
    );

    await finishFailure(finalError);
    throw finalError;
    } finally {
      trafficLease?.release?.();
    }
  }

  return Object.freeze({
    initialize,
    plan,
    observe,
    run,
    registry,
    catalog,
    router: resolvedRouter,
    projectPool: resolvedProjectPool,
    quotaManager,
    telemetry,
    modelLifecycle,
    providerHealth: resolvedProviderHealth,
    trafficController: resolvedTrafficController,
    generationAffinity,
  });
}

module.exports = {
  IMMEDIATE_FAILURE_CODES,
  FAST_MODEL_FALLBACK_CODES,
  DEFAULT_RETRY_POLICY,
  validateFeatureGenerationConfig,
  createAIOrchestrator,
};
