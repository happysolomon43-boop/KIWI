'use strict';

const registry = require('./d06-decision-registry.json');

const VALID_STATUSES = Object.freeze(new Set([
  'DECIDED',
  'CONFIGURED',
  'EXPLICITLY_DEFERRED',
]));

const REQUIRED_TASK_IDS = Object.freeze([
  ...Array.from({ length: 23 }, (_, index) => `TCH-${String(71 + index).padStart(4, '0')}`),
  ...Array.from({ length: 4 }, (_, index) => `TCH-${String(691 + index).padStart(4, '0')}`),
]);

function assertDecisionRegistryIntegrity(candidate = registry) {
  if (!candidate || candidate.delivery !== 'D06') {
    throw new Error('Teaching D06 decision registry must declare delivery D06.');
  }

  const ids = Object.keys(candidate.decisions || {});
  if (ids.length !== 27 || new Set(ids).size !== 27) {
    throw new Error('Teaching D06 decision registry must contain exactly 27 unique decisions.');
  }

  for (const id of REQUIRED_TASK_IDS) {
    const entry = candidate.decisions[id];
    if (!entry) throw new Error(`Missing D06 decision: ${id}`);
    if (!VALID_STATUSES.has(entry.status)) {
      throw new Error(`Invalid D06 decision status for ${id}: ${entry.status}`);
    }
    if (!entry.decision_id || !entry.policy_version || !entry.owner || !entry.decision) {
      throw new Error(`Incomplete D06 decision contract: ${id}`);
    }
    if (!Array.isArray(entry.sources) || entry.sources.length === 0) {
      throw new Error(`D06 decision lacks canonical source provenance: ${id}`);
    }
    if (!Array.isArray(entry.downstream_deliveries) || entry.downstream_deliveries.length === 0) {
      throw new Error(`D06 decision lacks downstream ownership mapping: ${id}`);
    }
    if (entry.status === 'EXPLICITLY_DEFERRED') {
      if (!entry.defer_prerequisite || !Array.isArray(entry.blocked_until_resolved) || entry.blocked_until_resolved.length === 0) {
        throw new Error(`Deferred D06 decision lacks closure prerequisite/block: ${id}`);
      }
    }
  }

  if (candidate.governance?.no_parallel_truth !== true) {
    throw new Error('D06 policy registry must not become a parallel academic truth store.');
  }
  if (candidate.governance?.no_direct_cross_system_writes !== true) {
    throw new Error('D06 must preserve the cross-system write hold.');
  }
  if (candidate.governance?.teaching_ai_routes !== 'UNQUALIFIED_UNTIL_D30') {
    throw new Error('D06 must preserve the D30 route qualification hold.');
  }
  if (candidate.governance?.production_release !== 'NOT_AUTHORIZED_UNTIL_D31') {
    throw new Error('D06 must preserve the D31 production release hold.');
  }

  return Object.freeze({
    total: ids.length,
    decided: ids.filter((id) => candidate.decisions[id].status === 'DECIDED').length,
    configured: ids.filter((id) => candidate.decisions[id].status === 'CONFIGURED').length,
    deferred: ids.filter((id) => candidate.decisions[id].status === 'EXPLICITLY_DEFERRED').length,
  });
}

function getTeachingDecision(taskId) {
  const id = String(taskId || '').trim();
  const decision = registry.decisions[id];
  if (!decision) {
    const error = new Error(`Unknown or unresolved Teaching D06 policy gate: ${id || '<empty>'}`);
    error.code = 'TEACHING_D06_POLICY_NOT_FOUND';
    throw error;
  }
  return Object.freeze(structuredClone(decision));
}

function listTeachingDecisions() {
  return Object.freeze(REQUIRED_TASK_IDS.map((id) => Object.freeze({
    taskId: id,
    decisionId: registry.decisions[id].decision_id,
    status: registry.decisions[id].status,
    policyVersion: registry.decisions[id].policy_version,
    owner: registry.decisions[id].owner,
  })));
}

module.exports = {
  D06_DECISION_REGISTRY: registry,
  REQUIRED_D06_TASK_IDS: REQUIRED_TASK_IDS,
  assertDecisionRegistryIntegrity,
  getTeachingDecision,
  listTeachingDecisions,
};
