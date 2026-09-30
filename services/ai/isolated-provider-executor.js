'use strict';

const { AI_PROVIDERS, assertProviderId } = require('./providers');
const { createExecutionRequest } = require('./execution-contracts');
const { AIError, AI_ERROR_CODES } = require('./errors');
const { MODEL_STATUS } = require('./model-catalog');

const DISALLOWED_ISOLATED_MODEL_STATES = new Set([
  MODEL_STATUS.DENIED,
  MODEL_STATUS.RETIRED,
  MODEL_STATUS.SUSPENDED,
]);

function _poolFor(credentialPools, provider) {
  if (!credentialPools) return null;
  if (credentialPools instanceof Map) return credentialPools.get(provider) || null;
  return credentialPools[provider] || credentialPools[String(provider).toLowerCase()] || null;
}

function createIsolatedProviderExecutor({
  providerRegistry,
  credentialPools,
  catalog,
  logger = console,
} = {}) {
  if (!providerRegistry?.require) {
    throw new Error('Isolated provider executor requires providerRegistry');
  }
  if (!catalog?.get) {
    throw new Error('Isolated provider executor requires model catalog');
  }

  async function execute({
    provider,
    modelId,
    taskId = 'AIM_D02_ISOLATED_PROVIDER_EXECUTION',
    content = '',
    generation = {},
    metadata = {},
    timeoutMs = 30000,
    signal = null,
  } = {}) {
    const normalizedProvider = assertProviderId(provider);
    const model = catalog.get(modelId);
    if (!model) {
      throw new AIError(`Unknown isolated AI model: ${modelId}`, {
        code: AI_ERROR_CODES.CONFIG,
        retryable: false,
        scope: 'REQUEST',
        provider: normalizedProvider,
      });
    }
    if (model.provider !== normalizedProvider) {
      throw new AIError(
        `Model ${modelId} belongs to ${model.provider}, not ${normalizedProvider}`,
        {
          code: AI_ERROR_CODES.CONFIG,
          retryable: false,
          scope: 'REQUEST',
          provider: normalizedProvider,
        }
      );
    }
    if (DISALLOWED_ISOLATED_MODEL_STATES.has(model.status)) {
      throw new AIError(`Model ${modelId} is not available for isolated execution`, {
        code: AI_ERROR_CODES.CONFIG,
        retryable: false,
        scope: 'MODEL',
        provider: normalizedProvider,
      });
    }

    const adapter = providerRegistry.require(normalizedProvider);
    const pool = _poolFor(credentialPools, normalizedProvider);
    if (!pool?.orderedSlots || pool.enabledCount() === 0) {
      throw new AIError(`No enabled ${normalizedProvider} credentials are configured`, {
        code: AI_ERROR_CODES.CONFIG,
        retryable: false,
        scope: 'REQUEST',
        provider: normalizedProvider,
      });
    }

    const request = createExecutionRequest({
      provider: normalizedProvider,
      modelId,
      taskId,
      content,
      generation,
      metadata: {
        ...metadata,
        isolatedQualification: true,
      },
    });
    const slots = pool.orderedSlots(`${normalizedProvider}::${modelId}`);
    let lastAuthError = null;

    for (const slot of slots) {
      try {
        const result = await adapter.generate({
          credential: slot,
          request,
          timeoutMs,
          signal,
          fallbackDepth: 0,
          generationGroupId: metadata?.generationGroupId || null,
        });
        const normalized = result?.normalized;
        if (!normalized) {
          throw new AIError(`${normalizedProvider} adapter returned no normalized response`, {
            code: AI_ERROR_CODES.UNKNOWN,
            retryable: false,
            scope: 'ATTEMPT',
            provider: normalizedProvider,
          });
        }

        return Object.freeze({
          ...normalized,
          taskId,
          isolatedQualification: true,
        });
      } catch (error) {
        const aiError = error instanceof AIError
          ? error
          : new AIError(error?.message || 'Isolated provider execution failed', {
              code: AI_ERROR_CODES.UNKNOWN,
              retryable: false,
              scope: 'ATTEMPT',
              provider: normalizedProvider,
              cause: error,
            });

        // A 401 is evidence about one credential. Disable only that slot and
        // continue. Shared Groq 403/429/provider failures are deliberately not
        // key-cycled because another API key may share the same project/org cap.
        if (aiError.code === AI_ERROR_CODES.AUTH && aiError.scope === 'SLOT') {
          pool.disable(slot.id, aiError.code);
          lastAuthError = aiError;
          continue;
        }

        if (typeof logger?.warn === 'function') {
          logger.warn('[KIWI AI] isolated provider execution failed', {
            provider: normalizedProvider,
            modelId,
            slotId: slot.id,
            code: aiError.code,
            status: aiError.status,
          });
        }
        throw aiError;
      }
    }

    throw lastAuthError || new AIError(
      `No usable ${normalizedProvider} credential remained for ${modelId}`,
      {
        code: AI_ERROR_CODES.CAPACITY_EXHAUSTED,
        retryable: false,
        scope: 'PROVIDER',
        provider: normalizedProvider,
      }
    );
  }

  return Object.freeze({
    execute,
  });
}

function createGroqIsolatedExecutor({
  providerRegistry,
  groqCredentialPool,
  catalog,
  logger,
} = {}) {
  return createIsolatedProviderExecutor({
    providerRegistry,
    credentialPools: {
      [AI_PROVIDERS.GROQ]: groqCredentialPool,
    },
    catalog,
    logger,
  });
}

module.exports = {
  DISALLOWED_ISOLATED_MODEL_STATES,
  createIsolatedProviderExecutor,
  createGroqIsolatedExecutor,
};
