'use strict';

const { AI_TASKS } = require('./task-registry');
const { createModelCatalog, MODEL_STATUS } = require('./model-catalog');
const { createModelRouter } = require('./model-router');
const { createProjectPool } = require('./project-pool');
const { createGeminiTransport } = require('./gemini-transport');
const { normalizeGeminiResponse } = require('./response-normalizer');
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
  transport = null,
  normalizer = normalizeGeminiResponse,
  logger = console,
  env = process.env,
} = {}) {
  const resolvedRouter = router || createModelRouter({ registry, catalog });
  const resolvedProjectPool = projectPool || createProjectPool({ env });
  const resolvedTransport = transport || createGeminiTransport();

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

    return Object.freeze({
      projectSlots: resolvedProjectPool.enabledCount(),
      hydratedProjectModelStates: Number(hydrated) || 0,
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
      const eligibleSlots = slotsForModel(candidate.modelId, { advance: false });
      return Object.freeze({
        modelId: candidate.modelId,
        class: candidate.class,
        requestedReasoning: candidate.requestedReasoning,
        resolvedReasoning: candidate.resolvedReasoning,
        timeoutMs: candidate.timeoutMs,
        qualityFloor: candidate.qualityFloor,
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
      projectSlots: shadowPlan.projectSlots.filter((slot) => slot.enabled),
    }));

    return shadowPlan;
  }

  async function run(taskId, request = {}, {
    preferredModelId = null,
    generationGroupId = null,
  } = {}) {
    const task = resolvedRouter.getTask(taskId);
    const candidates = resolvedRouter.resolveCandidates(taskId, { preferredModelId });
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

    const plannedModels = candidates.map((candidate) => candidate.modelId);
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
      }));
    }

    for (let modelIndex = 0; modelIndex < candidates.length; modelIndex++) {
      const candidate = candidates[modelIndex];
      const slots = slotsForModel(candidate.modelId, { advance: true });
      let skipRemainingSlotsForModel = false;

      for (const slot of slots) {
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

          if (IMMEDIATE_FAILURE_CODES.has(aiError.code)) {
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
            // Suspend it in the in-memory catalog immediately; Phase 7 adds
            // automatic discovery/qualification to bring models back safely.
            catalog.setStatus(candidate.modelId, MODEL_STATUS.SUSPENDED);
            skipRemainingSlotsForModel = true;
            break;
          }

          if (
            aiError.retryable ||
            aiError.code === AI_ERROR_CODES.EMPTY_RESPONSE
          ) {
            continue;
          }

          await finishFailure(aiError);
          throw aiError;
        }
      }

      if (skipRemainingSlotsForModel) continue;
    }

    const finalError = new AIError(
      `All approved routes failed for AI task ${taskId}`,
      {
        code: lastError?.code || AI_ERROR_CODES.UNKNOWN,
        status: lastError?.status || null,
        retryable: false,
        scope: 'REQUEST',
        details: {
          attempts,
          lastErrorCode: lastError?.code || null,
        },
        cause: lastError,
      }
    );

    await finishFailure(finalError);
    throw finalError;
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
  });
}

module.exports = {
  IMMEDIATE_FAILURE_CODES,
  validateFeatureGenerationConfig,
  createAIOrchestrator,
};
