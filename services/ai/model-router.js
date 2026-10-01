'use strict';

const { AI_TASKS } = require('./task-registry');
const {
  MODEL_STATUS,
  MODEL_CHANNELS,
  MODEL_INPUT_MODALITIES,
  createModelCatalog,
  modelMeetsCapabilities,
} = require('./model-catalog');
const { createProviderModelRef } = require('./providers');
const { routeSlotsForTask, ROUTE_SLOT_KINDS } = require('./routing-policy');
const { AIError, AI_ERROR_CODES } = require('./errors');

function requiredInputModalities(task, content = null) {
  const modalities = new Set([MODEL_INPUT_MODALITIES.TEXT]);

  // During the final caller cleanup, IMPORT_IMAGE_EXTRACTION still carries the
  // old semantic capability name. Treat it as an input modality here; it does
  // not create a separate route or provider lane.
  if (task?.capabilities?.includes('vision')) modalities.add(MODEL_INPUT_MODALITIES.IMAGE);

  if (content?.kind === 'MULTIMODAL') {
    for (const part of content.parts || []) {
      if (part?.kind === 'IMAGE') modalities.add(MODEL_INPUT_MODALITIES.IMAGE);
    }
  }
  return Object.freeze([...modalities]);
}

function requiredCapabilities(task) {
  return Object.freeze((task?.capabilities || []).filter((capability) => capability !== 'vision'));
}

function resolveReasoning(model, requested) {
  const supported = model?.supportedThinking || [];
  if (!requested) return null;
  if (supported.includes(requested)) return requested;
  if (requested === 'MINIMAL' && supported.includes('LOW')) return 'LOW';
  return null;
}

function createModelRouter({
  registry = AI_TASKS,
  catalog = createModelCatalog(),
} = {}) {
  function getTask(taskId) {
    const task = registry[taskId];
    if (!task) {
      throw new AIError(`Unknown AI task: ${taskId}`, {
        code: AI_ERROR_CODES.CONFIG,
        retryable: false,
        scope: 'REQUEST',
      });
    }
    return task;
  }

  function resolveSlot(slot) {
    if (slot.kind === ROUTE_SLOT_KINDS.LATEST_FAMILY) {
      return catalog.latestApproved(slot.family, { excludeIds: slot.excludeIds || [] });
    }
    if (slot.kind === ROUTE_SLOT_KINDS.MODEL) {
      return catalog.get(slot.modelId, slot.provider);
    }
    return null;
  }

  function candidateFor(model, task, taskId, inputModalities, capabilities) {
    if (!model || model.status !== MODEL_STATUS.APPROVED || model.productionEligible === false) return null;
    if (model.channel !== MODEL_CHANNELS.STABLE && model.id !== 'qwen/qwen3.8-27b') return null;
    if (!modelMeetsCapabilities(model, capabilities, inputModalities)) return null;

    const resolvedReasoning = resolveReasoning(model, task.reasoning);
    if (task.reasoning && !resolvedReasoning) return null;

    const modelRef = createProviderModelRef({ provider: model.provider, modelId: model.id });
    return Object.freeze({
      model,
      modelRef,
      provider: modelRef.provider,
      modelId: modelRef.modelId,
      routeKey: modelRef.key,
      class: task.class,
      requestedReasoning: task.reasoning || null,
      resolvedReasoning,
      reasoning: task.reasoning
        ? Object.freeze({ requested: task.reasoning, resolved: resolvedReasoning })
        : null,
      timeoutMs: task.timeoutMs,
      retryPolicy: task.retryPolicy,
      executionLane: task.executionLane,
      affinityGroup: task.affinityGroup || null,
      requiredCapabilities: capabilities,
      requiredInputModalities: inputModalities,
      taskId,
    });
  }

  function applyPreferredRoute(candidates, preferredRouteKey = null, preferredModelId = null) {
    if (!preferredRouteKey && !preferredModelId) return candidates;
    const index = candidates.findIndex((entry) => (
      preferredRouteKey ? entry.routeKey === preferredRouteKey : entry.modelId === preferredModelId
    ));
    return index >= 0 ? candidates.slice(index) : candidates;
  }

  function resolveCandidates(taskId, {
    content = null,
    preferredRouteKey = null,
    preferredModelId = null,
  } = {}) {
    const task = getTask(taskId);
    const capabilities = requiredCapabilities(task);
    const inputModalities = requiredInputModalities(task, content);
    const seen = new Set();
    const candidates = [];

    for (const slot of routeSlotsForTask(taskId)) {
      const model = resolveSlot(slot);
      const candidate = candidateFor(model, task, taskId, inputModalities, capabilities);
      if (!candidate || seen.has(candidate.routeKey)) continue;
      seen.add(candidate.routeKey);
      candidates.push(candidate);
    }

    const preferred = applyPreferredRoute(candidates, preferredRouteKey, preferredModelId);
    if (preferred.length === 0) {
      throw new AIError(`No approved model satisfies task ${taskId}`, {
        code: AI_ERROR_CODES.CONFIG,
        retryable: false,
        scope: 'REQUEST',
        details: { requiredCapabilities: capabilities, requiredInputModalities: inputModalities },
      });
    }
    return Object.freeze(preferred);
  }

  function describeRequirement(taskId, { content = null } = {}) {
    const task = getTask(taskId);
    return Object.freeze({
      taskId,
      requiredCapabilities: requiredCapabilities(task),
      requiredInputModalities: requiredInputModalities(task, content),
      routeSlots: routeSlotsForTask(taskId),
    });
  }

  return Object.freeze({ getTask, resolveCandidates, describeRequirement });
}

module.exports = {
  requiredInputModalities,
  requiredCapabilities,
  resolveReasoning,
  createModelRouter,
};
