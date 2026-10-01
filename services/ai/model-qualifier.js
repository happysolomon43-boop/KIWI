'use strict';

const { AI_PROVIDERS } = require('./providers');
const { AIError, AI_ERROR_CODES } = require('./errors');
const { AI_CLASSES } = require('./task-registry');
const {
  createTextContentPart,
  createImageContentPart,
  createMultimodalContent,
  createExecutionRequest,
} = require('./execution-contracts');

const QUALIFICATION_VERSION = 2;
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl7lT8AAAAASUVORK5CYII=';

function qualificationCapabilities(model) {
  const capabilities = ['generateContent', 'thinking', 'structuredOutput'];
  if (Number(model.outputTokenLimit) >= 24000) capabilities.push('longOutput');
  return capabilities;
}

function createModelQualifier({
  providerRegistry,
  credentialRegistry,
  quotaManager = null,
  trafficController = null,
  lifecycle,
  store = null,
  logger = console,
  env = process.env,
} = {}) {
  if (!providerRegistry?.require) throw new Error('Model qualifier requires providerRegistry');
  if (!credentialRegistry?.snapshot) throw new Error('Model qualifier requires credentialRegistry');
  if (!lifecycle) throw new Error('Model qualifier requires lifecycle');

  const googleAdapter = providerRegistry.require(AI_PROVIDERS.GOOGLE);

  function candidateSlots(routeKey) {
    const configured = credentialRegistry
      .snapshot(AI_PROVIDERS.GOOGLE)
      .filter((slot) => slot.enabled !== false);
    if (!configured.length) return [];

    const preferred = String(env.AI_QUALIFICATION_CREDENTIAL_SLOT || env.AI_QUALIFICATION_PROJECT_SLOT || '').trim();
    const ordered = [...configured].sort((a, b) => {
      if (preferred) {
        const aPreferred = a.id === preferred || a.envName === preferred;
        const bPreferred = b.id === preferred || b.envName === preferred;
        if (aPreferred !== bPreferred) return Number(bPreferred) - Number(aPreferred);
      }
      return (Number(b.index) || 0) - (Number(a.index) || 0);
    });

    return ordered
      .map((slot) => credentialRegistry.get(slot.id))
      .filter(Boolean)
      .filter((slot) => !quotaManager || quotaManager.isEligible(slot.id, routeKey));
  }

  async function record(record) {
    return store?.recordModelQualification ? store.recordModelQualification(record) : null;
  }

  async function probe(model, { content, generation = {}, timeoutMs = 45000 }) {
    const routeKey = `${AI_PROVIDERS.GOOGLE}::${model.id}`;
    const slots = candidateSlots(routeKey);
    let lastError = null;

    for (const credential of slots) {
      let trafficLease = null;
      try {
        trafficLease = trafficController
          ? await trafficController.acquire({ taskId: 'MODEL_QUALIFICATION', taskClass: AI_CLASSES.IP, timeoutMs })
          : null;
        const request = createExecutionRequest({
          provider: AI_PROVIDERS.GOOGLE,
          modelId: model.id,
          taskId: 'MODEL_QUALIFICATION',
          content,
          generation,
        });
        const result = await googleAdapter.generate({ credential, request, timeoutMs });
        trafficController?.noteSuccess?.();
        await quotaManager?.markSuccess?.(credential.id, routeKey);
        return { credentialSlot: credential.id, result };
      } catch (error) {
        lastError = error;
        trafficController?.noteFailure?.(error, { modelId: routeKey, projectSlot: credential.id });
        await quotaManager?.markFailure?.(credential.id, routeKey, error).catch(() => null);
        if (error?.code === AI_ERROR_CODES.AUTH) {
          credentialRegistry.disable(AI_PROVIDERS.GOOGLE, credential.id, 'AUTH');
          continue;
        }
        if (error?.code === AI_ERROR_CODES.BAD_REQUEST || error?.code === AI_ERROR_CODES.MODEL_NOT_FOUND) throw error;
        if (!error?.retryable) throw error;
      } finally {
        trafficLease?.release?.();
      }
    }

    throw lastError || new AIError('No healthy Google credential available for model qualification', {
      code: AI_ERROR_CODES.CAPACITY_EXHAUSTED,
      retryable: false,
      scope: 'MODEL',
      provider: AI_PROVIDERS.GOOGLE,
    });
  }

  async function qualify(model) {
    if (model?.provider && model.provider !== AI_PROVIDERS.GOOGLE) {
      throw new Error('Automatic family qualification currently supports Google-discovered models only');
    }

    const startedAt = new Date();
    let probeCount = 0;
    let credentialSlot = null;
    await lifecycle.markQualifying(model.id);
    await record({ modelId: model.id, status: 'STARTED', qualificationVersion: QUALIFICATION_VERSION, startedAt });

    try {
      if (!model?.metadata?.thinkingAdvertised) {
        const reason = 'models.list does not advertise thinking support';
        await lifecycle.deny(model.id, reason);
        await record({ modelId: model.id, status: 'FAILED', qualificationVersion: QUALIFICATION_VERSION, reason, startedAt, completedAt: new Date() });
        return { status: 'FAILED', reason };
      }

      probeCount += 1;
      const multimodal = createMultimodalContent([
        createTextContentPart('Return exactly one JSON object with boolean field "ok" set to true. Ignore the image contents.'),
        createImageContentPart({ mimeType: 'image/png', data: TINY_PNG_BASE64 }),
      ]);
      const highProbe = await probe(model, {
        content: multimodal,
        generation: {
          maxOutputTokens: 1024,
          reasoning: { requested: 'HIGH', resolved: 'HIGH' },
          structuredOutput: { mimeType: 'application/json' },
        },
      });
      credentialSlot = highProbe.credentialSlot;
      let structured = null;
      try { structured = JSON.parse(highProbe.result.normalized?.text || ''); } catch (_) {}
      if (!structured || structured.ok !== true) {
        throw new AIError('Qualification structured-output probe did not return expected JSON', {
          code: AI_ERROR_CODES.EMPTY_RESPONSE,
          retryable: false,
          scope: 'MODEL',
        });
      }

      let supportedThinking;
      probeCount += 1;
      try {
        await probe(model, {
          content: 'Reply with exactly OK.',
          generation: {
            maxOutputTokens: 128,
            reasoning: { requested: 'MINIMAL', resolved: 'MINIMAL' },
          },
        });
        supportedThinking = ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'];
      } catch (error) {
        if (error?.code !== AI_ERROR_CODES.BAD_REQUEST) throw error;
        probeCount += 1;
        await probe(model, {
          content: 'Reply with exactly OK.',
          generation: {
            maxOutputTokens: 128,
            reasoning: { requested: 'LOW', resolved: 'LOW' },
          },
        });
        supportedThinking = ['LOW', 'MEDIUM', 'HIGH'];
      }

      const capabilities = qualificationCapabilities(model);
      const approved = await lifecycle.approve(model.id, {
        supportedThinking,
        capabilities,
        qualification: {
          version: QUALIFICATION_VERSION,
          probeCount,
          credentialSlot,
          multimodalInput: true,
          completedAt: new Date().toISOString(),
        },
      });

      await record({
        modelId: model.id,
        status: 'PASSED',
        projectSlot: credentialSlot,
        qualificationVersion: QUALIFICATION_VERSION,
        supportedThinking,
        capabilities,
        probeCount,
        metadata: { outputTokenLimit: model.outputTokenLimit, inputTokenLimit: model.inputTokenLimit, multimodalInput: true },
        startedAt,
        completedAt: new Date(),
      });
      logger?.log?.('[KIWI AI] model qualification passed', { modelId: model.id, supportedThinking, capabilities });
      return { status: 'PASSED', model: approved, supportedThinking, capabilities };
    } catch (error) {
      const transient = Boolean(error?.retryable || [
        AI_ERROR_CODES.RATE_LIMIT_RPD,
        AI_ERROR_CODES.RATE_LIMIT_RPM,
        AI_ERROR_CODES.RATE_LIMIT_TPM,
        AI_ERROR_CODES.RATE_LIMIT_UNKNOWN,
        AI_ERROR_CODES.TIMEOUT,
        AI_ERROR_CODES.TRANSIENT,
        AI_ERROR_CODES.NETWORK,
        AI_ERROR_CODES.CAPACITY_EXHAUSTED,
        AI_ERROR_CODES.AUTH,
      ].includes(error?.code));
      const status = transient ? 'INCONCLUSIVE' : 'FAILED';
      const reason = error?.message || 'qualification failed';

      if (transient) {
        await lifecycle.discover({
          ...model,
          provider: AI_PROVIDERS.GOOGLE,
          status: 'DISCOVERED',
          metadata: {
            ...(model.metadata || {}),
            provider: AI_PROVIDERS.GOOGLE,
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
        projectSlot: credentialSlot,
        qualificationVersion: QUALIFICATION_VERSION,
        supportedThinking: [],
        capabilities: [],
        probeCount,
        errorCode: error?.code || null,
        reason,
        startedAt,
        completedAt: new Date(),
      });
      logger?.warn?.('[KIWI AI] model qualification did not pass', { modelId: model.id, status, code: error?.code || null, reason });
      return { status, reason, error };
    }
  }

  return Object.freeze({ qualify, candidateSlots });
}

module.exports = {
  QUALIFICATION_VERSION,
  TINY_PNG_BASE64,
  qualificationCapabilities,
  createModelQualifier,
};
