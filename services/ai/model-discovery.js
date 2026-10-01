'use strict';

const { AI_PROVIDERS } = require('./providers');
const { AI_CAPABILITIES, AI_INPUT_MODALITIES, AI_OUTPUT_MODALITIES } = require('./capabilities');
const {
  MODEL_FAMILIES,
  MODEL_CHANNELS,
  MODEL_STATUS,
  modelVersionRank,
} = require('./model-catalog');
const { AI_CLASSES } = require('./task-registry');

function normalizeModelId(apiModel) {
  return String(apiModel?.baseModelId || apiModel?.name || '').trim().replace(/^models\//, '');
}

function classifyStableFlash(apiModel) {
  const id = normalizeModelId(apiModel);
  const match = id.match(/^gemini-(\d+)\.(\d+)(?:\.(\d+))?-(flash|flash-lite)$/i);
  if (!match) return null;
  const methods = Array.isArray(apiModel?.supportedGenerationMethods)
    ? apiModel.supportedGenerationMethods.map((method) => String(method).toLowerCase())
    : [];
  if (!methods.includes('generatecontent')) return null;

  return {
    id,
    provider: AI_PROVIDERS.GOOGLE,
    family: match[4].toLowerCase() === 'flash-lite'
      ? MODEL_FAMILIES.FLASH_LITE
      : MODEL_FAMILIES.FLASH,
    channel: MODEL_CHANNELS.STABLE,
    rank: modelVersionRank(id),
    productionEligible: false,
    inputTokenLimit: Number(apiModel?.inputTokenLimit) || null,
    outputTokenLimit: Number(apiModel?.outputTokenLimit) || null,
    supportedReasoning: [],
    capabilities: [AI_CAPABILITIES.INFERENCE],
    inputModalities: [AI_INPUT_MODALITIES.TEXT, AI_INPUT_MODALITIES.IMAGE],
    outputModalities: [AI_OUTPUT_MODALITIES.TEXT],
    metadata: {
      source: 'models.list',
      displayName: apiModel?.displayName || null,
      description: apiModel?.description || null,
      providerVersion: apiModel?.version || null,
      thinkingAdvertised: apiModel?.thinking === true,
      supportedGenerationMethods: apiModel?.supportedGenerationMethods || [],
      discoveredAt: new Date().toISOString(),
    },
  };
}

function createModelDiscoveryManager({
  providerRegistry,
  credentialRegistry,
  catalog,
  lifecycle,
  qualifier,
  trafficController = null,
  logger = console,
  env = process.env,
  sampleSize = 3,
} = {}) {
  if (!providerRegistry?.require) throw new Error('Model discovery requires providerRegistry');
  if (!credentialRegistry?.ordered) throw new Error('Model discovery requires credentialRegistry');
  if (!catalog || !lifecycle || !qualifier) {
    throw new Error('Model discovery requires catalog, lifecycle and qualifier');
  }

  const googleAdapter = providerRegistry.require(AI_PROVIDERS.GOOGLE, 'generate');
  const deniedNames = new Set(
    String(env.AI_MODEL_DENYLIST || '').split(',').map((value) => value.trim()).filter(Boolean)
  );

  function autoDiscoveryEnabled() {
    return String(env.AI_AUTO_DISCOVERY ?? 'true').toLowerCase() !== 'false';
  }

  function autoPromoteEnabled() {
    return String(env.AI_AUTO_PROMOTE ?? 'true').toLowerCase() !== 'false';
  }

  function latestApproved(family) {
    return catalog.latestApproved(family, { provider: AI_PROVIDERS.GOOGLE });
  }

  async function fetchProviderModels() {
    const credentials = credentialRegistry
      .ordered(AI_PROVIDERS.GOOGLE, `${AI_PROVIDERS.GOOGLE}::__model_discovery__`)
      .slice(0, Math.max(1, Number(env.AI_DISCOVERY_CREDENTIAL_SAMPLE || env.AI_DISCOVERY_PROJECT_SAMPLE) || sampleSize));
    if (!credentials.length) return [];

    const union = new Map();
    let successCount = 0;
    let lastError = null;

    for (const credential of credentials) {
      let trafficLease = null;
      try {
        trafficLease = trafficController
          ? await trafficController.acquire({
              taskId: 'MODEL_DISCOVERY',
              taskClass: AI_CLASSES.IP,
              timeoutMs: 15000,
            })
          : null;
        const models = await googleAdapter.listModels({ apiKey: credential.apiKey, timeoutMs: 15000 });
        trafficController?.noteSuccess?.();
        successCount += 1;
        for (const model of models || []) {
          const id = normalizeModelId(model);
          if (id && !union.has(id)) union.set(id, model);
        }
      } catch (error) {
        lastError = error;
        trafficController?.noteFailure?.(error, {
          modelId: `${AI_PROVIDERS.GOOGLE}::__model_discovery__`,
          projectSlot: credential.id,
        });
        if (error?.code === 'AUTH') {
          credentialRegistry.disable(AI_PROVIDERS.GOOGLE, credential.id, 'AUTH');
        }
        logger?.warn?.('[KIWI AI] model discovery credential failed', {
          credentialSlot: credential.id,
          code: error?.code || null,
          status: error?.status || null,
        });
      } finally {
        trafficLease?.release?.();
      }
    }

    if (!successCount && lastError) throw lastError;
    return [...union.values()];
  }

  async function discoverFamilyLeader(family, candidates, discovered, promoted, skipped) {
    const current = latestApproved(family);
    const leader = candidates
      .filter((model) => model.family === family)
      .sort((a, b) => b.rank - a.rank)[0] || null;
    if (!leader) return current;

    if (deniedNames.has(leader.id)) {
      skipped.push({ modelId: leader.id, family, reason: 'denylist' });
      return current;
    }
    if (current && leader.rank <= current.rank) return current;

    let candidate = catalog.get(leader.id, AI_PROVIDERS.GOOGLE);
    if (!candidate) {
      candidate = await lifecycle.discover({ ...leader, status: MODEL_STATUS.DISCOVERED });
      discovered.push(leader.id);
    } else if (![MODEL_STATUS.APPROVED, MODEL_STATUS.SUSPENDED, MODEL_STATUS.DENIED].includes(candidate.status)) {
      candidate = await lifecycle.discover({
        ...candidate,
        ...leader,
        status: candidate.status,
        metadata: {
          ...(candidate.metadata || {}),
          ...(leader.metadata || {}),
          lastSeenAt: new Date().toISOString(),
        },
      });
    }

    if (candidate.status === MODEL_STATUS.APPROVED) return candidate;
    if (candidate.status === MODEL_STATUS.SUSPENDED || candidate.status === MODEL_STATUS.DENIED) {
      skipped.push({ modelId: leader.id, family, reason: candidate.status.toLowerCase() });
      return current;
    }
    if (!autoPromoteEnabled()) {
      skipped.push({ modelId: leader.id, family, reason: 'auto promotion disabled' });
      return current;
    }

    const result = await qualifier.qualify(candidate);
    if (result.status === 'PASSED') {
      const approved = catalog.upsert({ ...result.model, productionEligible: true });
      await lifecycle.discover(approved);
      promoted.push(leader.id);
      return approved;
    }
    return current;
  }

  async function discoverOnce() {
    if (!autoDiscoveryEnabled()) {
      return Object.freeze({
        enabled: false,
        providerModels: 0,
        stableModels: 0,
        discovered: [],
        promoted: [],
        skipped: [],
      });
    }

    const providerModels = await fetchProviderModels();
    const stable = providerModels.map(classifyStableFlash).filter(Boolean);
    const discovered = [];
    const promoted = [];
    const skipped = [];

    const latestFlashLite = await discoverFamilyLeader(
      MODEL_FAMILIES.FLASH_LITE, stable, discovered, promoted, skipped
    );
    const latestFlash = await discoverFamilyLeader(
      MODEL_FAMILIES.FLASH, stable, discovered, promoted, skipped
    );

    for (const model of stable) {
      const existing = catalog.get(model.id, AI_PROVIDERS.GOOGLE);
      if (!existing) continue;
      await lifecycle.discover({
        ...existing,
        inputTokenLimit: model.inputTokenLimit || existing.inputTokenLimit,
        outputTokenLimit: model.outputTokenLimit || existing.outputTokenLimit,
        metadata: {
          ...(existing.metadata || {}),
          ...(model.metadata || {}),
          lastSeenAt: new Date().toISOString(),
        },
      });
    }

    const summary = Object.freeze({
      enabled: true,
      providerModels: providerModels.length,
      stableModels: stable.length,
      latestFlashLiteModel: latestFlashLite?.id || null,
      latestFlashModel: latestFlash?.id || null,
      discovered: Object.freeze(discovered),
      promoted: Object.freeze(promoted),
      skipped: Object.freeze(skipped),
    });
    logger?.log?.('[KIWI AI] model discovery complete', summary);
    return summary;
  }

  return Object.freeze({
    discoverOnce,
    fetchProviderModels,
    autoDiscoveryEnabled,
    autoPromoteEnabled,
  });
}

module.exports = {
  normalizeModelId,
  classifyStableFlash,
  createModelDiscoveryManager,
};
