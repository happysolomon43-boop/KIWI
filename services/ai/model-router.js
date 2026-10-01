'use strict';

const { AI_TASKS } = require('./task-registry');
const { AI_INPUT_MODALITIES, modelSatisfies } = require('./capabilities');
const { isProductionRoutableModel, createModelCatalog } = require('./model-catalog');
const { createProviderModelRef } = require('./providers');
const { resolveReasoning } = require('./reasoning');
const { routeSlotsForTask, ROUTE_SLOT_KINDS } = require('./routing-policy');
const { AIError, AI_ERROR_CODES } = require('./errors');

function requiredInputModalities(task, content = null) {
  const modalities = new Set(task?.inputModalities || [AI_INPUT_MODALITIES.TEXT]);
  if (content?.kind === 'MULTIMODAL') {
    for (const part of content.parts || []) {
      if (part?.kind === 'IMAGE') modalities.add(AI_INPUT_MODALITIES.IMAGE);
    }
  }
  return Object.freeze([...modalities]);
}

function createModelRouter({ registry = AI_TASKS, catalog = createModelCatalog() } = {}) {
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
      return catalog.latestApproved(slot.family, {
        provider: slot.provider,
        excludeIds: slot.excludeIds || [],
      });
    }
    if (slot.kind === ROUTE_SLOT_KINDS.MODEL) {
      return catalog.get(slot.modelId, slot.provider);
    }
    return null;
  }

  function candidateFor(model, task, taskId, inputModalities) {
    if (!isProductionRoutableModel(model)) return null;
    if (!modelSatisfies({
      model,
      capabilities: task.capabilities,
      inputModalities,
    })) return null;

    const reasoning = resolveReasoning(model, task.reasoning);
    if (task.reasoning && !reasoning) return null;

    const modelRef = createProviderModelRef({ provider: model.provider, modelId: model.id });
    return Object.freeze({
      model,
      modelRef,
      provider: modelRef.provider,
      modelId: modelRef.modelId,
      routeKey: modelRef.key,
      taskId,
      taskClass: task.class,
      reasoning,
      timeoutMs: task.timeoutMs,
      attemptTimeoutMs: task.attemptTimeoutMs || null,
      retryPolicy: task.retryPolicy,
      executionLane: task.executionLane,
      affinityGroup: task.affinityGroup || null,
      requiredCapabilities: task.capabilities,
      requiredInputModalities: inputModalities,
    });
  }

  function resolveCandidates(taskId, { content = null, preferredRouteKey = null } = {}) {
    const task = getTask(taskId);
    const inputModalities = requiredInputModalities(task, content);
    const seen = new Set();
    const candidates = [];

    for (const slot of routeSlotsForTask(taskId)) {
      const candidate = candidateFor(resolveSlot(slot), task, taskId, inputModalities);
      if (!candidate || seen.has(candidate.routeKey)) continue;
      seen.add(candidate.routeKey);
      candidates.push(candidate);
    }

    let ordered = candidates;
    if (preferredRouteKey) {
      const index = candidates.findIndex((candidate) => candidate.routeKey === preferredRouteKey);
      if (index >= 0) ordered = candidates.slice(index);
    }

    if (!ordered.length) {
      throw new AIError(`No approved model satisfies task ${taskId}`, {
        code: AI_ERROR_CODES.CONFIG,
        retryable: false,
        scope: 'REQUEST',
        details: {
          requiredCapabilities: task.capabilities,
          requiredInputModalities: inputModalities,
        },
      });
    }
    return Object.freeze(ordered);
  }

  function describeRequirement(taskId, { content = null } = {}) {
    const task = getTask(taskId);
    return Object.freeze({
      taskId,
      capabilities: task.capabilities,
      inputModalities: requiredInputModalities(task, content),
      routeSlots: routeSlotsForTask(taskId),
    });
  }

  return Object.freeze({ getTask, resolveCandidates, describeRequirement });
}

module.exports = {
  requiredInputModalities,
  createModelRouter,
};
