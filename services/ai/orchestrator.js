'use strict';

const { AI_TASKS } = require('./task-registry');
const { createModelCatalog } = require('./model-catalog');
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
  transport = null,
  normalizer = normalizeGeminiResponse,
  logger = console,
  env = process.env,
} = {}) {
  const resolvedRouter = router || createModelRouter({ registry, catalog });
  const resolvedProjectPool = projectPool || createProjectPool({ env });
  const resolvedTransport = transport || createGeminiTransport();

  function plan(taskId, { preferredModelId = null } = {}) {
    const candidates = resolvedRouter.resolveCandidates(taskId, { preferredModelId });
    return Object.freeze({
      taskId,
      candidates: candidates.map((candidate) => Object.freeze({
        modelId: candidate.modelId,
        class: candidate.class,
        requestedReasoning: candidate.requestedReasoning,
        resolvedReasoning: candidate.resolvedReasoning,
        timeoutMs: candidate.timeoutMs,
        qualityFloor: candidate.qualityFloor,
      })),
      projectSlots: resolvedProjectPool.snapshot(),
    });
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

    const attempts = [];
    let lastError = null;

    for (let modelIndex = 0; modelIndex < candidates.length; modelIndex++) {
      const candidate = candidates[modelIndex];
      const slots = resolvedProjectPool.orderedSlots(candidate.modelId);
      let skipRemainingSlotsForModel = false;

      for (const slot of slots) {
        const attemptNumber = attempts.length + 1;
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
            throw aiError;
          }

          if (aiError.code === AI_ERROR_CODES.AUTH) {
            // Authentication/permission failure belongs to this project slot.
            // Disable it in-memory now; Phase 3 will persist health state.
            resolvedProjectPool.disable(slot.id, aiError.code);
            continue;
          }

          if (aiError.code === AI_ERROR_CODES.MODEL_NOT_FOUND) {
            // A missing/retired model is model-wide; trying every API key wastes
            // quota and time. Move directly to the next approved model.
            skipRemainingSlotsForModel = true;
            break;
          }

          if (
            aiError.retryable ||
            aiError.code === AI_ERROR_CODES.EMPTY_RESPONSE
          ) {
            // Phase 2 retries across independent project slots. Persistent
            // RPM/TPM/RPD state and cooldowns arrive in Phase 3.
            continue;
          }

          throw aiError;
        }
      }

      if (skipRemainingSlotsForModel) continue;
    }

    throw new AIError(
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
  }

  return Object.freeze({
    plan,
    run,
    registry,
    catalog,
    router: resolvedRouter,
    projectPool: resolvedProjectPool,
  });
}

module.exports = {
  IMMEDIATE_FAILURE_CODES,
  validateFeatureGenerationConfig,
  createAIOrchestrator,
};
