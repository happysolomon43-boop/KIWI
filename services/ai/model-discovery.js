'use strict';

const {
  MODEL_FAMILIES,
  MODEL_CHANNELS,
  MODEL_STATUS,
  modelVersionRank,
} = require('./model-catalog');

function normalizeModelId(apiModel) {
  const raw = String(apiModel?.baseModelId || apiModel?.name || '').trim();
  return raw.replace(/^models\//, '');
}

function classifyStableFlash(apiModel) {
  const id = normalizeModelId(apiModel);
  const match = id.match(/^gemini-(\d+)\.(\d+)(?:\.(\d+))?-(flash|flash-lite)$/i);
  if (!match) return null;

  const methods = Array.isArray(apiModel?.supportedGenerationMethods)
    ? apiModel.supportedGenerationMethods.map((m) => String(m).toLowerCase())
    : [];
  if (!methods.includes('generatecontent')) return null;

  return {
    id,
    family: match[4].toLowerCase() === 'flash-lite'
      ? MODEL_FAMILIES.FLASH_LITE
      : MODEL_FAMILIES.FLASH,
    channel: MODEL_CHANNELS.STABLE,
    rank: modelVersionRank(id),
    inputTokenLimit: Number(apiModel?.inputTokenLimit) || null,
    outputTokenLimit: Number(apiModel?.outputTokenLimit) || null,
    supportedThinking: [],
    capabilities: ['generateContent'],
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
  transport,
  projectPool,
  catalog,
  lifecycle,
  qualifier,
  logger = console,
  env = process.env,
  sampleSize = 3,
} = {}) {
  if (!transport?.listModels) throw new Error('Model discovery requires listModels transport');
  if (!projectPool) throw new Error('Model discovery requires projectPool');
  if (!catalog) throw new Error('Model discovery requires catalog');
  if (!lifecycle) throw new Error('Model discovery requires lifecycle');
  if (!qualifier) throw new Error('Model discovery requires qualifier');

  const deniedNames = new Set(
    String(env.AI_MODEL_DENYLIST || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );

  function autoDiscoveryEnabled() {
    return String(env.AI_AUTO_DISCOVERY ?? 'true').toLowerCase() !== 'false';
  }

  function autoPromoteEnabled() {
    return String(env.AI_AUTO_PROMOTE ?? 'true').toLowerCase() !== 'false';
  }

  function highestApprovedRank(family) {
    const approved = catalog.list({
      family,
      channel: MODEL_CHANNELS.STABLE,
      status: MODEL_STATUS.APPROVED,
    });
    return approved[0]?.rank || 0;
  }

  async function fetchProviderModels() {
    const slots = projectPool.orderedSlots('__model_discovery__').slice(
      0,
      Math.max(1, Number(env.AI_DISCOVERY_PROJECT_SAMPLE) || sampleSize)
    );

    if (slots.length === 0) return [];

    const union = new Map();
    let successCount = 0;
    let lastError = null;

    for (const slot of slots) {
      try {
        const models = await transport.listModels({
          apiKey: slot.apiKey,
          timeoutMs: 15000,
        });
        successCount += 1;
        for (const model of models || []) {
          const id = normalizeModelId(model);
          if (id && !union.has(id)) union.set(id, model);
        }
      } catch (error) {
        lastError = error;
        if (error?.code === 'AUTH') {
          projectPool.disable(slot.id, 'AUTH');
        }
        if (typeof logger?.warn === 'function') {
          logger.warn('[KIWI AI] model discovery slot failed', {
            slotId: slot.id,
            code: error?.code || null,
            status: error?.status || null,
          });
        }
      }
    }

    if (successCount === 0 && lastError) throw lastError;
    return [...union.values()];
  }

  async function discoverOnce() {
    if (!autoDiscoveryEnabled()) {
      return Object.freeze({
        enabled: false,
        providerModels: 0,
        stableFlashModels: 0,
        discovered: [],
        promoted: [],
      });
    }

    const providerModels = await fetchProviderModels();
    const stable = providerModels
      .map(classifyStableFlash)
      .filter(Boolean)
      .sort((a, b) => b.rank - a.rank);

    const discovered = [];
    const promoted = [];
    const skipped = [];

    for (const model of stable) {
      const existing = catalog.get(model.id);

      let candidate = existing;

      if (existing) {
        candidate = catalog.upsert({
          ...existing,
          inputTokenLimit: model.inputTokenLimit || existing.inputTokenLimit,
          outputTokenLimit: model.outputTokenLimit || existing.outputTokenLimit,
          metadata: {
            ...(existing.metadata || {}),
            ...(model.metadata || {}),
            lastSeenAt: new Date().toISOString(),
          },
        });
        await lifecycle.discover(candidate);

        if (
          candidate.status === MODEL_STATUS.APPROVED ||
          candidate.status === MODEL_STATUS.SUSPENDED ||
          candidate.status === MODEL_STATUS.DENIED
        ) {
          continue;
        }
      } else {
        candidate = await lifecycle.discover({
          ...model,
          status: deniedNames.has(model.id)
            ? MODEL_STATUS.DENIED
            : MODEL_STATUS.DISCOVERED,
        });
        discovered.push(candidate.id);
      }

      if (deniedNames.has(model.id)) {
        skipped.push({ modelId: model.id, reason: 'denylist' });
        continue;
      }

      const currentBestRank = highestApprovedRank(model.family);
      if (model.rank <= currentBestRank) {
        skipped.push({ modelId: model.id, reason: 'not newer than approved stable model' });
        continue;
      }

      if (!autoPromoteEnabled()) {
        skipped.push({ modelId: model.id, reason: 'auto promotion disabled' });
        continue;
      }

      const result = await qualifier.qualify(candidate);
      if (result.status === 'PASSED') {
        promoted.push(model.id);
      }
    }

    const summary = Object.freeze({
      enabled: true,
      providerModels: providerModels.length,
      stableFlashModels: stable.length,
      discovered: Object.freeze(discovered),
      promoted: Object.freeze(promoted),
      skipped: Object.freeze(skipped),
    });

    if (typeof logger?.log === 'function') {
      logger.log('[KIWI AI] model discovery complete', {
        providerModels: summary.providerModels,
        stableFlashModels: summary.stableFlashModels,
        discovered: summary.discovered,
        promoted: summary.promoted,
      });
    }

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
