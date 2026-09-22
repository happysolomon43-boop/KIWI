'use strict';

const { normalizeGeminiResponse } = require('./response-normalizer');
const { AIError, AI_ERROR_CODES } = require('./errors');

const QUALIFICATION_VERSION = 1;

// 1x1 transparent PNG. The probe asks the model to accept multimodal input and
// return a tiny structured JSON response; no user data is involved.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl7lT8AAAAASUVORK5CYII=';

function qualificationCapabilities(model) {
  const capabilities = [
    'generateContent',
    'thinking',
    'vision',
    'structuredOutput',
  ];

  if (Number(model.outputTokenLimit) >= 24000) {
    capabilities.push('longOutput');
  }

  return capabilities;
}

function createModelQualifier({
  transport,
  projectPool,
  quotaManager = null,
  lifecycle,
  store = null,
  logger = console,
  env = process.env,
} = {}) {
  if (!transport?.generate) throw new Error('Model qualifier requires transport');
  if (!projectPool) throw new Error('Model qualifier requires projectPool');
  if (!lifecycle) throw new Error('Model qualifier requires lifecycle');

  function candidateSlots(modelId) {
    const configured = projectPool.snapshot().filter((slot) => slot.enabled);
    if (configured.length === 0) return [];

    const preferred = String(env.AI_QUALIFICATION_PROJECT_SLOT || '').trim();
    let ordered = configured;

    if (preferred) {
      ordered = [...configured].sort((a, b) => {
        const aPreferred = a.id === preferred || a.envName === preferred;
        const bPreferred = b.id === preferred || b.envName === preferred;
        return Number(bPreferred) - Number(aPreferred);
      });
    } else {
      // Default to the highest-numbered project slot so qualification traffic
      // does not always consume the first project's fresh VVIP quota.
      ordered = [...configured].sort((a, b) => b.index - a.index);
    }

    return ordered
      .map((slot) => projectPool.get(slot.id))
      .filter(Boolean)
      .filter((slot) => !quotaManager || quotaManager.isEligible(slot.id, modelId));
  }

  async function record(record) {
    if (!store?.recordModelQualification) return null;
    return store.recordModelQualification(record);
  }

  async function probeWithFallback(modelId, {
    content,
    generationConfig,
    timeoutMs = 45000,
  }) {
    const slots = candidateSlots(modelId);
    let lastError = null;

    for (const slot of slots) {
      try {
        const result = await transport.generate({
          apiKey: slot.apiKey,
          modelId,
          content,
          generationConfig,
          timeoutMs,
        });

        await quotaManager?.markSuccess?.(slot.id, modelId);

        return {
          slotId: slot.id,
          result,
        };
      } catch (error) {
        lastError = error;
        await quotaManager?.markFailure?.(slot.id, modelId, error).catch(() => null);
        if (error?.code === AI_ERROR_CODES.AUTH) {
          projectPool.disable(slot.id, 'AUTH');
        }

        // 400 means the probe configuration is unsupported by the model itself;
        // retrying it through another account cannot make it valid.
        if (error?.code === AI_ERROR_CODES.BAD_REQUEST) throw error;

        // Model rollout/access can differ across independent projects. Keep
        // trying the same model on the remaining project slots for 403/404.
        if (
          error?.code === AI_ERROR_CODES.MODEL_NOT_FOUND ||
          error?.code === AI_ERROR_CODES.ACCESS_DENIED
        ) {
          continue;
        }

        if (!error?.retryable && error?.code !== AI_ERROR_CODES.AUTH) {
          throw error;
        }
      }
    }

    throw lastError || new AIError('No healthy project slot available for model qualification', {
      code: AI_ERROR_CODES.CAPACITY_EXHAUSTED,
      retryable: false,
      scope: 'MODEL',
    });
  }

  async function qualify(model) {
    const startedAt = new Date();
    let probeCount = 0;
    let projectSlot = null;

    await lifecycle.markQualifying(model.id);
    await record({
      modelId: model.id,
      status: 'STARTED',
      qualificationVersion: QUALIFICATION_VERSION,
      startedAt,
    });

    try {
      if (!model?.metadata?.thinkingAdvertised) {
        const reason = 'models.list does not advertise thinking support';
        await lifecycle.deny(model.id, reason);
        await record({
          modelId: model.id,
          status: 'FAILED',
          qualificationVersion: QUALIFICATION_VERSION,
          reason,
          startedAt,
          completedAt: new Date(),
        });
        return { status: 'FAILED', reason };
      }

      if (!Number.isFinite(Number(model.outputTokenLimit)) || Number(model.outputTokenLimit) < 1024) {
        const reason = 'model reports an unusable output token limit';
        await lifecycle.deny(model.id, reason);
        await record({
          modelId: model.id,
          status: 'FAILED',
          qualificationVersion: QUALIFICATION_VERSION,
          reason,
          startedAt,
          completedAt: new Date(),
        });
        return { status: 'FAILED', reason };
      }

      // Probe 1: verifies high thinking + multimodal input + structured output.
      probeCount += 1;
      const highProbe = await probeWithFallback(model.id, {
        content: {
          contents: [{
            parts: [
              { text: 'Return exactly one JSON object with boolean field "ok" set to true. Ignore the image contents.' },
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: TINY_PNG_BASE64,
                },
              },
            ],
          }],
        },
        generationConfig: {
          maxOutputTokens: 1024,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingLevel: 'high' },
        },
      });
      projectSlot = highProbe.slotId;

      const normalizedHigh = normalizeGeminiResponse(highProbe.result.raw, {
        modelId: model.id,
        slotId: highProbe.slotId,
      });
      let structured = null;
      try { structured = JSON.parse(normalizedHigh.text); } catch (_) {}
      if (!structured || structured.ok !== true) {
        throw new AIError('Qualification structured-output probe did not return expected JSON', {
          code: AI_ERROR_CODES.EMPTY_RESPONSE,
          retryable: false,
          scope: 'MODEL',
        });
      }

      // Probe 2: determine whether MINIMAL exists.
      let supportsMinimal = false;
      probeCount += 1;
      try {
        await probeWithFallback(model.id, {
          content: 'Reply with exactly OK.',
          generationConfig: {
            maxOutputTokens: 128,
            thinkingConfig: { thinkingLevel: 'minimal' },
          },
        });
        supportsMinimal = true;
      } catch (error) {
        if (error?.code !== AI_ERROR_CODES.BAD_REQUEST) throw error;

        // Models such as 3.8/3.7 reject MINIMAL but must accept LOW.
        probeCount += 1;
        await probeWithFallback(model.id, {
          content: 'Reply with exactly OK.',
          generationConfig: {
            maxOutputTokens: 128,
            thinkingConfig: { thinkingLevel: 'low' },
          },
        });
      }

      // Future-model promotion must verify MEDIUM explicitly because many KIWI
      // VIP tasks request MEDIUM reasoning. Do not infer support merely from
      // LOW + HIGH being accepted.
      probeCount += 1;
      await probeWithFallback(model.id, {
        content: 'Reply with exactly OK.',
        generationConfig: {
          maxOutputTokens: 128,
          thinkingConfig: { thinkingLevel: 'medium' },
        },
      });

      const supportedThinking = supportsMinimal
        ? ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH']
        : ['LOW', 'MEDIUM', 'HIGH'];

      const capabilities = qualificationCapabilities(model);
      const approved = await lifecycle.approve(model.id, {
        supportedThinking,
        capabilities,
        qualification: {
          version: QUALIFICATION_VERSION,
          probeCount,
          projectSlot,
          completedAt: new Date().toISOString(),
        },
      });

      await record({
        modelId: model.id,
        status: 'PASSED',
        projectSlot,
        qualificationVersion: QUALIFICATION_VERSION,
        supportedThinking,
        capabilities,
        probeCount,
        metadata: {
          outputTokenLimit: model.outputTokenLimit,
          inputTokenLimit: model.inputTokenLimit,
        },
        startedAt,
        completedAt: new Date(),
      });

      if (typeof logger?.log === 'function') {
        logger.log('[KIWI AI] model qualification passed', {
          modelId: model.id,
          supportedThinking,
          capabilities,
        });
      }

      return {
        status: 'PASSED',
        model: approved,
        supportedThinking,
        capabilities,
      };
    } catch (error) {
      const transient = Boolean(
        error?.retryable ||
        [
          AI_ERROR_CODES.MODEL_NOT_FOUND,
          AI_ERROR_CODES.ACCESS_DENIED,
          AI_ERROR_CODES.RATE_LIMIT_RPD,
          AI_ERROR_CODES.RATE_LIMIT_RPM,
          AI_ERROR_CODES.RATE_LIMIT_TPM,
          AI_ERROR_CODES.RATE_LIMIT_UNKNOWN,
          AI_ERROR_CODES.TIMEOUT,
          AI_ERROR_CODES.TRANSIENT,
          AI_ERROR_CODES.NETWORK,
          AI_ERROR_CODES.CAPACITY_EXHAUSTED,
          AI_ERROR_CODES.AUTH,
        ].includes(error?.code)
      );

      const status = transient ? 'INCONCLUSIVE' : 'FAILED';
      const reason = error?.message || 'qualification failed';

      if (transient) {
        // Put it back into DISCOVERED so a later discovery cycle can retry.
        await lifecycle.discover({
          ...model,
          status: 'DISCOVERED',
          metadata: {
            ...(model.metadata || {}),
            lastQualificationError: error?.code || 'UNKNOWN',
            lastQualificationAttemptAt: new Date().toISOString(),
          },
        });
      } else {
        await lifecycle.deny(model.id, reason);
      }

      await record({
        modelId: model.id,
        status,
        projectSlot,
        qualificationVersion: QUALIFICATION_VERSION,
        supportedThinking: [],
        capabilities: [],
        probeCount,
        errorCode: error?.code || null,
        reason,
        startedAt,
        completedAt: new Date(),
      });

      if (typeof logger?.warn === 'function') {
        logger.warn('[KIWI AI] model qualification did not pass', {
          modelId: model.id,
          status,
          code: error?.code || null,
          reason,
        });
      }

      return { status, reason, error };
    }
  }

  return Object.freeze({
    qualify,
    candidateSlots,
  });
}

module.exports = {
  QUALIFICATION_VERSION,
  TINY_PNG_BASE64,
  qualificationCapabilities,
  createModelQualifier,
};
