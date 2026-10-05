'use strict';

const {
  AI_TASKS,
  AI_EXECUTION_LANES,
  RETRY_POLICY_CONFIG,
} = require('./task-registry');
const { AI_CAPABILITIES } = require('./capabilities');
const { createModelCatalog, MODEL_STATUS } = require('./model-catalog');
const { createModelRouter } = require('./model-router');
const { createCredentialRegistry } = require('./credential-registry');
const { createProviderRegistry } = require('./provider-registry');
const {
  normalizeExecutionContent,
  createExecutionRequest,
} = require('./execution-contracts');
const { createProviderHealth, ROUTE_AVAILABILITY_CODES } = require('./provider-health');
const { createAITrafficController } = require('./traffic-controller');
const { createRouteScheduler } = require('./route-scheduler');
const { createOperationBudget } = require('./operation-budget');
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

const FAST_ROUTE_FALLBACK_CODES = new Set([
  AI_ERROR_CODES.PROVIDER_OVERLOADED,
  AI_ERROR_CODES.TRANSIENT,
  AI_ERROR_CODES.TIMEOUT,
  AI_ERROR_CODES.NETWORK,
  AI_ERROR_CODES.EMPTY_RESPONSE,
]);

const DAILY_QUOTA_CODES = new Set([AI_ERROR_CODES.RATE_LIMIT_RPD]);
const SHORT_RATE_LIMIT_CODES = new Set([
  AI_ERROR_CODES.RATE_LIMIT_RPM,
  AI_ERROR_CODES.RATE_LIMIT_TPM,
  AI_ERROR_CODES.RATE_LIMIT_UNKNOWN,
]);

const PROVIDER_NATIVE_GENERATION_FIELDS = Object.freeze([
  'thinkingConfig',
  'thinking_level',
  'thinkingLevel',
  'reasoning_effort',
  'reasoningEffort',
  'include_reasoning',
  'reasoning_format',
  'max_completion_tokens',
  'responseMimeType',
  'responseSchema',
]);

const DEFAULT_RETRY_POLICY = Object.freeze({
  maxAttempts: 6,
  maxAttemptsPerRoute: 2,
  maxDailyQuotaAttemptsPerRoute: 4,
  maxShortRateLimitAttemptsPerRoute: 2,
  maxTransientAttemptsPerRoute: 1,
});

function validateFeatureGenerationConfig(generation = {}) {
  const source = generation && typeof generation === 'object' ? generation : {};
  const leaked = PROVIDER_NATIVE_GENERATION_FIELDS.find((key) =>
    Object.prototype.hasOwnProperty.call(source, key)
  );
  if (leaked) {
    throw new AIError(
      `Feature code cannot set provider-native generation field ${leaked}; use neutral KIWI generation options`,
      { code: AI_ERROR_CODES.CONFIG, retryable: false, scope: 'REQUEST' }
    );
  }
  return { ...source };
}

function createAIOrchestrator({
  registry = AI_TASKS,
  catalog = createModelCatalog(),
  router = null,
  providerRegistry = null,
  credentialRegistry = null,
  quotaManager = null,
  telemetry = null,
  modelLifecycle = null,
  providerHealth = null,
  trafficController = null,
  routeScheduler = null,
  operationBudget = null,
  logger = console,
  env = process.env,
  clock = () => Date.now(),
  assertReady = null,
} = {}) {
  const resolvedRouter = router || createModelRouter({ registry, catalog });
  const resolvedProviders = providerRegistry || createProviderRegistry();
  const resolvedCredentials = credentialRegistry || createCredentialRegistry({ env, clock });

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

  const interactiveAttemptTimeoutMs = boundedEnvNumber(
    'AI_INTERACTIVE_ATTEMPT_TIMEOUT_MS',
    19000,
    5000,
    75000
  );
  const confirmationProbeTimeoutMs = boundedEnvNumber(
    'AI_CONFIRMATION_PROBE_TIMEOUT_MS',
    5000,
    1000,
    15000
  );

  function operationTimeoutFor(task) {
    return Math.max(1000, Number(task.timeoutMs) || 60000);
  }

  function attemptTimeoutFor(task, candidate, {
    confirmationProbe = false,
    requestStartedAt,
    operationTimeoutMs,
  } = {}) {
    const elapsedMs = Math.max(0, nowMs() - requestStartedAt);
    const remainingMs = operationTimeoutMs - elapsedMs;
    if (remainingMs <= 0) return 0;

    const configured = Number(candidate.attemptTimeoutMs || task.attemptTimeoutMs);
    const attemptCeiling = Number.isFinite(configured) && configured > 0
      ? configured
      : task.executionLane === AI_EXECUTION_LANES.BACKGROUND
        ? Number(task.timeoutMs) || operationTimeoutMs
        : interactiveAttemptTimeoutMs;

    return Math.max(1, Math.min(
      confirmationProbe ? confirmationProbeTimeoutMs : attemptCeiling,
      Number(candidate.timeoutMs) || Number(task.timeoutMs) || operationTimeoutMs,
      remainingMs
    ));
  }

  const resolvedProviderHealth = providerHealth || createProviderHealth({
    clock,
    failureEvidenceWindowMs: boundedEnvNumber(
      'AI_PROVIDER_FAILURE_EVIDENCE_WINDOW_MS', 30000, 5000, 300000
    ),
    openCooldownMs: boundedEnvNumber(
      'AI_MODEL_TRANSIENT_COOLDOWN_MS', 20000, 5000, 120000
    ),
    minDistinctFailureSlots: boundedEnvNumber(
      'AI_PROVIDER_FAILURE_EVIDENCE_SLOTS', 2, 1, 5
    ),
  });
  const resolvedTrafficController = trafficController || createAITrafficController({ env, clock });
  const resolvedRouteScheduler = routeScheduler || createRouteScheduler({ env, clock });
  const resolvedOperationBudget = operationBudget || createOperationBudget({ env, clock });

  const generationAffinity = new Map();
  const AFFINITY_TTL_MS = 30 * 60 * 1000;
  const AFFINITY_MAX_ENTRIES = 2000;
  let operationSequence = 0;

  function retryPolicyFor(task) {
    return RETRY_POLICY_CONFIG[task?.retryPolicy] || DEFAULT_RETRY_POLICY;
  }

  function affinityKey(task, generationGroupId) {
    if (!generationGroupId || !task?.affinityGroup) return null;
    return `${task.affinityGroup}::${generationGroupId}`;
  }

  function pruneAffinity() {
    const now = nowMs();
    for (const [key, entry] of generationAffinity) {
      if (now - entry.updatedAt >= AFFINITY_TTL_MS) generationAffinity.delete(key);
    }
  }

  function getAffinity(task, generationGroupId) {
    const key = affinityKey(task, generationGroupId);
    if (!key) return null;
    const entry = generationAffinity.get(key);
    if (!entry) return null;
    if (nowMs() - entry.updatedAt >= AFFINITY_TTL_MS) {
      generationAffinity.delete(key);
      return null;
    }
    return entry.routeKey;
  }

  function setAffinity(task, generationGroupId, routeKey) {
    const key = affinityKey(task, generationGroupId);
    if (!key || !routeKey) return;
    pruneAffinity();
    if (!generationAffinity.has(key) && generationAffinity.size >= AFFINITY_MAX_ENTRIES) {
      generationAffinity.delete(generationAffinity.keys().next().value);
    }
    generationAffinity.set(key, { routeKey, updatedAt: nowMs() });
  }

  async function sideEffect(label, fn) {
    if (typeof fn !== 'function') return null;
    try {
      return await fn();
    } catch (error) {
      logger?.warn?.(`[KIWI AI] ${label} failed`, { error: error?.message || String(error) });
      return null;
    }
  }

  async function initialize() {
    const hydratedQuotaStates = quotaManager ? await quotaManager.hydrate() : 0;
    const hydratedProviderHealth = resolvedProviderHealth?.hydrate
      ? await resolvedProviderHealth.hydrate()
      : 0;
    return Object.freeze({
      credentialSlots: resolvedCredentials.enabledCount(),
      hydratedRouteQuotaStates: Number(hydratedQuotaStates) || 0,
      hydratedRouteHealthStates: Number(hydratedProviderHealth) || 0,
    });
  }

  function credentialSlotsFor(candidate, { advance = false } = {}) {
    const base = advance
      ? resolvedCredentials.ordered(candidate.provider, candidate.routeKey)
      : resolvedCredentials.peek(candidate.provider, candidate.routeKey);
    const eligible = quotaManager
      ? quotaManager.filterEligibleSlots(candidate.routeKey, base)
      : base;
    return resolvedRouteScheduler.orderSlots(candidate.routeKey, eligible, quotaManager);
  }

  function plan(taskId, { content = null } = {}) {
    const normalizedContent = normalizeExecutionContent(content);
    const candidates = resolvedRouter.resolveCandidates(taskId, { content: normalizedContent });
    const routedCandidates = candidates.map((candidate) => {
      const availability = resolvedProviderHealth.availability(candidate.routeKey);
      const slots = availability.available
        ? credentialSlotsFor(candidate, { advance: false })
        : [];
      return Object.freeze({
        provider: candidate.provider,
        modelId: candidate.modelId,
        routeKey: candidate.routeKey,
        taskClass: candidate.taskClass,
        reasoning: candidate.reasoning,
        timeoutMs: candidate.timeoutMs,
        temporarilyUnavailable: !availability.available,
        providerCircuitState: availability.state,
        providerRetryAfterMs: availability.retryAfterMs,
        eligibleCredentialSlots: Object.freeze(slots.map((slot) => slot.id)),
      });
    });
    const primary = routedCandidates.find((candidate) => candidate.eligibleCredentialSlots.length > 0)
      || routedCandidates[0]
      || null;
    return Object.freeze({
      taskId,
      candidates: Object.freeze(routedCandidates),
      plannedPrimaryRoute: primary?.routeKey || null,
      plannedPrimaryProvider: primary?.provider || null,
      plannedPrimaryModel: primary?.modelId || null,
      plannedPrimaryCredentialSlot: primary?.eligibleCredentialSlots?.[0] || null,
      credentialSlots: Object.freeze(resolvedCredentials.snapshot()),
    });
  }

  async function observe(taskId, { content = null } = {}) {
    const task = resolvedRouter.getTask(taskId);
    const shadowPlan = plan(taskId, { content });
    await sideEffect('shadow telemetry', () => telemetry?.recordShadowDecision({
      taskId,
      taskClass: task.class,
      requestedReasoning: task.reasoning,
      candidateRoutes: shadowPlan.candidates,
      plannedCredentialSlotId: shadowPlan.plannedPrimaryCredentialSlot,
    }));
    return shadowPlan;
  }

  async function run(taskId, request = {}, {
    generationGroupId = null,
    operationBudgetId = null,
    preparationRoutePosture = null,
  } = {}) {
    assertReady?.();
    const task = resolvedRouter.getTask(taskId);
    const content = normalizeExecutionContent(
      request.content !== undefined
        ? request.content
        : request.prompt !== undefined
          ? request.prompt
          : ''
    );
    const storedAffinity = getAffinity(task, generationGroupId);
    const affinityCandidates = resolvedRouter.resolveCandidates(taskId, {
      content,
      preferredRouteKey: storedAffinity,
      preparationRoutePosture,
    });

    let routedCandidates = affinityCandidates;
    if (storedAffinity) {
      const unrestricted = resolvedRouter.resolveCandidates(taskId, { content, preparationRoutePosture });
      const present = new Set(affinityCandidates.map((candidate) => candidate.routeKey));
      const emergencyRecovery = unrestricted.filter((candidate) => !present.has(candidate.routeKey));
      if (emergencyRecovery.length) {
        routedCandidates = Object.freeze([...affinityCandidates, ...emergencyRecovery]);
      }
    }

    const featureGeneration = validateFeatureGenerationConfig(request.generation || request.generationConfig || {});
    const generation = {
      ...(task.generationDefaults || {}),
      ...featureGeneration,
    };
    if (task.capabilities?.includes(AI_CAPABILITIES.STRUCTURED_OUTPUT) && !generation.structuredOutput) {
      generation.structuredOutput = { mimeType: 'application/json' };
    }

    const operationTimeoutMs = operationTimeoutFor(task);
    const retryPolicy = retryPolicyFor(task);
    const plannedRoutes = routedCandidates.map((candidate) => ({
      provider: candidate.provider,
      modelId: candidate.modelId,
      routeKey: candidate.routeKey,
    }));
    const requestId = telemetry
      ? await sideEffect('telemetry begin', () => telemetry.beginRequest({
          taskId,
          taskClass: task.class,
          mode: 'LIVE',
          requestedReasoning: task.reasoning,
          plannedRoutes,
          plannedPrimaryRoute: plannedRoutes[0] || null,
          generationGroupId,
        }))
      : null;

    const attempts = [];
    const requestStartedAt = nowMs();
    const operationId = operationBudgetId
      ? `${task.affinityGroup || taskId}::budget::${operationBudgetId}`
      : generationGroupId && task.affinityGroup
        ? `${task.affinityGroup}::${generationGroupId}`
        : requestId || `request::${taskId}::${requestStartedAt}::${++operationSequence}`;
    let lastError = null;
    let hadEligibleRoute = false;
    const providerBlockedRoutes = [];
    const locallyBlockedRoutes = [];
    let trafficLease = null;
    let queueWaitMs = 0;
    let admissionLimit = null;
    let congestionLevel = null;
    let requestFinished = false;

    async function finishFailure(error, outcome = 'FAILED') {
      if (requestFinished) return;
      requestFinished = true;
      await sideEffect('telemetry finish failure', () => telemetry?.finishRequest(requestId, {
        taskId,
        taskClass: task.class,
        mode: 'LIVE',
        outcome,
        fallbackDepth: Math.max(0, new Set(attempts.map((attempt) => attempt.routeKey)).size - 1),
        attemptCount: attempts.length,
        latencyMs: nowMs() - requestStartedAt,
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
        executionLane: task.executionLane,
        timeoutMs: task.timeoutMs,
      });
      queueWaitMs = Number(trafficLease?.queueWaitMs) || 0;
      admissionLimit = trafficLease?.admissionLimit ?? null;
      congestionLevel = trafficLease?.congestionLevel || null;

      routeLoop:
      for (let routeIndex = 0; routeIndex < routedCandidates.length; routeIndex++) {
        const candidate = routedCandidates[routeIndex];
        const slots = credentialSlotsFor(candidate, { advance: true });
        if (slots.length) hadEligibleRoute = true;
        if (!slots.length) continue;
        if (attempts.length >= retryPolicy.maxAttempts) break;

        const providerLease = resolvedProviderHealth.acquire(candidate.routeKey);
        if (!providerLease.available) {
          providerBlockedRoutes.push(Object.freeze({
            routeKey: candidate.routeKey,
            state: providerLease.state,
            retryAfterMs: providerLease.retryAfterMs,
          }));
          continue;
        }

        let routeAttemptCount = 0;
        let dailyQuotaCount = 0;
        let shortRateCount = 0;
        let transientCount = 0;
        let ownsConfirmationProbe = false;

        try {
          for (const slot of slots) {
            if (attempts.length >= retryPolicy.maxAttempts) break routeLoop;

            if (!providerLease.halfOpenProbe && !ownsConfirmationProbe) {
              const availability = resolvedProviderHealth.availability(candidate.routeKey);
              if (!availability.available) {
                providerBlockedRoutes.push(Object.freeze({
                  routeKey: candidate.routeKey,
                  state: availability.state,
                  retryAfterMs: availability.retryAfterMs,
                }));
                break;
              }
            }

            const routeLease = await resolvedRouteScheduler.acquire(candidate.routeKey, slot);
            if (!routeLease.available) {
              locallyBlockedRoutes.push(Object.freeze({
                routeKey: candidate.routeKey,
                credentialSlotId: slot.id,
                reason: routeLease.reason,
              }));
              continue;
            }

            const budgetClaim = await resolvedOperationBudget.claim({
              operationId,
              taskClass: task.class,
            });
            if (!budgetClaim.allowed) {
              await sideEffect('route lease release', () => routeLease.release());
              throw new AIError(`AI operation budget exhausted for task ${taskId}`, {
                code: AI_ERROR_CODES.OPERATION_BUDGET_EXHAUSTED,
                retryable: false,
                scope: 'OPERATION',
                details: { operationId, taskId, limits: budgetClaim.limits, state: budgetClaim.state },
              });
            }

            const attemptTimeoutMs = attemptTimeoutFor(task, candidate, {
              confirmationProbe: ownsConfirmationProbe,
              requestStartedAt,
              operationTimeoutMs,
            });
            if (attemptTimeoutMs <= 0) {
              await sideEffect('route lease release', () => routeLease.release());
              throw new AIError(
                `AI operation exceeded its ${Math.round(operationTimeoutMs / 1000)}s deadline`,
                { code: AI_ERROR_CODES.TIMEOUT, status: 504, retryable: true, scope: 'OPERATION' }
              );
            }

            const attemptNumber = attempts.length + 1;
            const attemptStartedAt = nowMs();
            const operationAttemptNumber = budgetClaim.attemptNumber;
            const routeStateBefore = quotaManager?.get
              ? quotaManager.get(slot.id, candidate.routeKey).state
              : 'READY';
            const executionRequest = createExecutionRequest({
              provider: candidate.provider,
              modelId: candidate.modelId,
              taskId,
              content,
              generation: {
                ...generation,
                reasoning: candidate.reasoning,
              },
              metadata: { generationGroupId, operationId },
            });

            try {
              const adapter = resolvedProviders.require(candidate.provider, 'generate');
              const result = await adapter.generate({
                credential: slot,
                request: executionRequest,
                timeoutMs: attemptTimeoutMs,
                fallbackDepth: routeIndex,
                generationGroupId,
              });
              const normalized = result?.normalized || result;

              if (normalized?.blocked) {
                throw safetyError({
                  finishReason: normalized.finishReason,
                  blockReason: normalized.blockReason,
                });
              }
              if (!normalized?.text) {
                throw new AIError('AI provider returned no visible text', {
                  code: AI_ERROR_CODES.EMPTY_RESPONSE,
                  retryable: true,
                  scope: 'ATTEMPT',
                  provider: candidate.provider,
                });
              }

              await sideEffect('quota success', () => quotaManager?.markSuccess(slot.id, candidate.routeKey));
              await sideEffect('route scheduler success', () => resolvedRouteScheduler.recordSuccess(candidate.routeKey, slot.id));
              await sideEffect('operation budget success', () => resolvedOperationBudget.recordOutcome(operationId));
              const healthBefore = resolvedProviderHealth.snapshot(candidate.routeKey);
              resolvedProviderHealth.recordSuccess(candidate.routeKey);
              if (healthBefore.state !== 'CLOSED' || healthBefore.distinctFailureSlots > 0 || healthBefore.lastErrorCode) {
                await sideEffect('provider health recovery persistence', () => resolvedProviderHealth.persist?.(candidate.routeKey));
              }
              resolvedTrafficController.noteSuccess();
              await sideEffect('model lifecycle success', () => modelLifecycle?.recordSuccess(candidate));

              await sideEffect('telemetry success attempt', () => telemetry?.recordAttempt({
                requestId,
                attemptNumber,
                provider: candidate.provider,
                modelId: candidate.modelId,
                routeKey: candidate.routeKey,
                credentialSlotId: slot.id,
                requestedReasoning: candidate.reasoning?.requested || task.reasoning,
                resolvedReasoning: candidate.reasoning?.resolved || null,
                fallbackDepth: routeIndex,
                outcome: 'SUCCESS',
                finishReason: normalized.finishReason,
                latencyMs: result?.latencyMs ?? normalized.latencyMs ?? (nowMs() - attemptStartedAt),
                inputTokens: normalized.usage?.inputTokens || 0,
                outputTokens: normalized.usage?.outputTokens || 0,
                thoughtTokens: normalized.usage?.thoughtTokens || 0,
                totalTokens: normalized.usage?.totalTokens || 0,
                routeStateBefore,
                routeStateAfter: quotaManager?.get ? quotaManager.get(slot.id, candidate.routeKey).state : 'READY',
                operationId,
                operationAttemptNumber,
                startedAt: new Date(attemptStartedAt),
                completedAt: new Date(),
              }));

              await sideEffect('route lease release', () => routeLease.release());
              setAffinity(task, generationGroupId, candidate.routeKey);
              requestFinished = true;
              await sideEffect('telemetry finish success', () => telemetry?.finishRequest(requestId, {
                taskId,
                taskClass: task.class,
                mode: 'LIVE',
                selectedRoute: candidate,
                selectedCredentialSlotId: slot.id,
                outcome: 'SUCCESS',
                fallbackDepth: routeIndex,
                attemptCount: attemptNumber,
                latencyMs: nowMs() - requestStartedAt,
                usage: normalized.usage || {},
                finishReason: normalized.finishReason,
                queueWaitMs,
                admissionLimit,
                congestionLevel,
              }));

              return Object.freeze({
                ...normalized,
                taskId,
                class: task.class,
                provider: candidate.provider,
                modelId: candidate.modelId,
                routeKey: candidate.routeKey,
                credentialSlot: slot.id,
                requestedReasoning: candidate.reasoning?.requested || task.reasoning,
                resolvedReasoning: candidate.reasoning?.resolved || null,
                fallbackDepth: routeIndex,
                attempts: attemptNumber,
              });
            } catch (error) {
              const aiError = error instanceof AIError
                ? error
                : new AIError(error?.message || 'Unknown AI failure', {
                    code: AI_ERROR_CODES.UNKNOWN,
                    retryable: false,
                    scope: 'REQUEST',
                    provider: candidate.provider,
                    cause: error,
                  });
              lastError = aiError;
              resolvedTrafficController.noteFailure(aiError, {
                routeKey: candidate.routeKey,
                credentialSlotId: slot.id,
              });

              const dailyQuota = DAILY_QUOTA_CODES.has(aiError.code);
              const shortRate = SHORT_RATE_LIMIT_CODES.has(aiError.code);
              const availabilityFailure = ROUTE_AVAILABILITY_CODES.has(aiError.code);
              if (dailyQuota) dailyQuotaCount += 1;
              else if (shortRate) shortRateCount += 1;
              else routeAttemptCount += 1;

              const providerState = availabilityFailure
                ? resolvedProviderHealth.recordFailure(candidate.routeKey, slot.id, aiError, { totalEligibleSlots: slots.length })
                : null;
              if (availabilityFailure) {
                await sideEffect('provider health failure persistence', () => resolvedProviderHealth.persist?.(candidate.routeKey));
              }

              attempts.push(Object.freeze({
                provider: candidate.provider,
                modelId: candidate.modelId,
                routeKey: candidate.routeKey,
                credentialSlotId: slot.id,
                code: aiError.code,
                status: aiError.status,
              }));

              await sideEffect('quota failure', () => quotaManager?.markFailure(slot.id, candidate.routeKey, aiError));
              await sideEffect('route scheduler failure', () => resolvedRouteScheduler.recordFailure(candidate.routeKey, slot.id, aiError));
              await sideEffect('operation budget failure', () => resolvedOperationBudget.recordOutcome(operationId, aiError));
              await sideEffect('telemetry failed attempt', () => telemetry?.recordAttempt({
                requestId,
                attemptNumber,
                provider: candidate.provider,
                modelId: candidate.modelId,
                routeKey: candidate.routeKey,
                credentialSlotId: slot.id,
                requestedReasoning: candidate.reasoning?.requested || task.reasoning,
                resolvedReasoning: candidate.reasoning?.resolved || null,
                fallbackDepth: routeIndex,
                outcome: aiError.code === AI_ERROR_CODES.SAFETY ? 'BLOCKED' : 'FAILED',
                errorCode: aiError.code,
                httpStatus: aiError.status,
                retryAfterMs: aiError.retryAfterMs,
                operationId,
                operationAttemptNumber,
                latencyMs: nowMs() - attemptStartedAt,
                startedAt: new Date(attemptStartedAt),
                completedAt: new Date(),
              }));
              await sideEffect('route lease release', () => routeLease.release());

              logger?.warn?.('[KIWI AI] attempt failed', {
                taskId,
                provider: candidate.provider,
                modelId: candidate.modelId,
                routeKey: candidate.routeKey,
                credentialSlotId: slot.id,
                code: aiError.code,
                status: aiError.status,
                attempt: attemptNumber,
              });

              const lifecycleResult = await sideEffect('model lifecycle failure', () =>
                modelLifecycle?.recordFailure(candidate, aiError)
              );
              if (lifecycleResult?.suspended && aiError.code !== AI_ERROR_CODES.SAFETY) break;

              if (IMMEDIATE_FAILURE_CODES.has(aiError.code)) {
                await finishFailure(aiError, aiError.code === AI_ERROR_CODES.SAFETY ? 'BLOCKED' : 'FAILED');
                throw aiError;
              }

              if (aiError.code === AI_ERROR_CODES.AUTH) {
                resolvedCredentials.disable(candidate.provider, slot.id, aiError.code);
                continue;
              }

              if (aiError.code === AI_ERROR_CODES.MODEL_NOT_FOUND) {
                if (modelLifecycle) {
                  await sideEffect('model suspension', () =>
                    modelLifecycle.suspend(candidate, 'provider returned MODEL_NOT_FOUND')
                  );
                } else {
                  catalog.setStatus(candidate.routeKey, MODEL_STATUS.SUSPENDED);
                }
                break;
              }

              if (dailyQuota) {
                if (dailyQuotaCount >= (retryPolicy.maxDailyQuotaAttemptsPerRoute || retryPolicy.maxAttemptsPerRoute)) break;
                continue;
              }
              if (shortRate) {
                if (shortRateCount >= (retryPolicy.maxShortRateLimitAttemptsPerRoute || 2)) break;
                continue;
              }

              if (FAST_ROUTE_FALLBACK_CODES.has(aiError.code)) {
                transientCount += 1;
                if (providerState?.state === 'OPEN' || transientCount >= retryPolicy.maxTransientAttemptsPerRoute) break;
                if (
                  availabilityFailure &&
                  providerState?.state === 'CLOSED' &&
                  providerState?.distinctFailureSlots === 1 &&
                  !ownsConfirmationProbe
                ) {
                  ownsConfirmationProbe = Boolean(resolvedProviderHealth.beginConfirmationProbe?.(candidate.routeKey));
                  if (!ownsConfirmationProbe) break;
                }
              }

              if (!aiError.retryable && aiError.code !== AI_ERROR_CODES.EMPTY_RESPONSE) {
                await finishFailure(aiError);
                throw aiError;
              }
              if (routeAttemptCount >= retryPolicy.maxAttemptsPerRoute) break;
            }
          }
        } finally {
          if (ownsConfirmationProbe) resolvedProviderHealth.endConfirmationProbe?.(candidate.routeKey);
          resolvedProviderHealth.release(candidate.routeKey);
        }
      }

      const blockedByProviderHealth = attempts.length === 0 && hadEligibleRoute && providerBlockedRoutes.length > 0 && locallyBlockedRoutes.length === 0;
      const blockedByContention = attempts.length === 0 && hadEligibleRoute && locallyBlockedRoutes.length > 0;
      const retryAfterMs = providerBlockedRoutes
        .map((entry) => Number(entry.retryAfterMs))
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((a, b) => a - b)[0] || null;
      const finalCode = lastError?.code || (
        blockedByProviderHealth ? AI_ERROR_CODES.PROVIDER_OVERLOADED :
        blockedByContention ? AI_ERROR_CODES.ORCHESTRATOR_BUSY :
        hadEligibleRoute ? AI_ERROR_CODES.UNKNOWN : AI_ERROR_CODES.CAPACITY_EXHAUSTED
      );
      const finalError = new AIError(
        lastError
          ? `All approved routes failed for AI task ${taskId}`
          : blockedByProviderHealth
            ? `Approved AI routes are temporarily unavailable for task ${taskId}`
            : blockedByContention
              ? `Healthy AI routes are temporarily busy for task ${taskId}`
              : `No healthy AI route capacity is currently available for task ${taskId}`,
        {
          code: finalCode,
          status: lastError?.status || (blockedByProviderHealth || blockedByContention ? 503 : null),
          retryable: lastError ? Boolean(lastError.retryable) : Boolean(blockedByProviderHealth || blockedByContention),
          retryAfterMs: lastError?.retryAfterMs || retryAfterMs || (blockedByContention ? 100 : null),
          scope: blockedByProviderHealth ? 'PROVIDER' : blockedByContention ? 'ORCHESTRATOR' : 'REQUEST',
          details: {
            attempts,
            operationId,
            retryAuthority: 'ORCHESTRATOR',
            providerBlockedRoutes,
            locallyBlockedRoutes,
            maxAttempts: retryPolicy.maxAttempts,
          },
          cause: lastError,
        }
      );
      await finishFailure(finalError);
      throw finalError;
    } catch (error) {
      const failure = error instanceof AIError
        ? error
        : new AIError('KIWI AI runtime is temporarily unavailable', {
            code: AI_ERROR_CODES.RUNTIME_UNAVAILABLE,
            status: 503,
            retryable: true,
            retryAfterMs: 1000,
            scope: 'ORCHESTRATOR',
            cause: error,
          });
      await finishFailure(failure);
      throw failure;
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
    providerRegistry: resolvedProviders,
    credentialRegistry: resolvedCredentials,
    quotaManager,
    telemetry,
    modelLifecycle,
    providerHealth: resolvedProviderHealth,
    trafficController: resolvedTrafficController,
    routeScheduler: resolvedRouteScheduler,
    operationBudget: resolvedOperationBudget,
    generationAffinity,
  });
}

module.exports = {
  IMMEDIATE_FAILURE_CODES,
  FAST_ROUTE_FALLBACK_CODES,
  PROVIDER_NATIVE_GENERATION_FIELDS,
  DEFAULT_RETRY_POLICY,
  validateFeatureGenerationConfig,
  createAIOrchestrator,
};
