'use strict';

const { getCapability, assertCapabilityBinding } = require('../capability-registry');
const { getCapabilityContract } = require('../prompt-runtime/contracts');
const { EVENT_CATEGORIES } = require('../runtime/constants');
const { assertAuthorityLevel } = require('../ai/contracts');

const ORCHESTRATION_TRIGGER_TYPES = Object.freeze({
  AUTHENTICATED_INPUT: 'authenticated_input',
  SCHEDULED_DUE_EVENT: 'scheduled_due_event',
  COMMITTED_DOMAIN_EVENT: 'committed_domain_event',
  BACKGROUND_ANALYSIS: 'background_analysis',
  WORKFLOW_CONTINUATION: 'workflow_continuation',
});

const TRIGGER_AUTHORITY_CATEGORY = Object.freeze({
  [ORCHESTRATION_TRIGGER_TYPES.AUTHENTICATED_INPUT]: EVENT_CATEGORIES.AUTHENTICATED_COMMAND,
  [ORCHESTRATION_TRIGGER_TYPES.SCHEDULED_DUE_EVENT]: EVENT_CATEGORIES.SCHEDULED_DUE_EVENT,
  [ORCHESTRATION_TRIGGER_TYPES.COMMITTED_DOMAIN_EVENT]: EVENT_CATEGORIES.COMMITTED_DOMAIN_EVENT,
  [ORCHESTRATION_TRIGGER_TYPES.BACKGROUND_ANALYSIS]: EVENT_CATEGORIES.OPERATIONAL_RECOVERY_EVENT,
  [ORCHESTRATION_TRIGGER_TYPES.WORKFLOW_CONTINUATION]: EVENT_CATEGORIES.OPERATIONAL_RECOVERY_EVENT,
});

const FORBIDDEN_AUDIT_KEYS = Object.freeze(new Set([
  'prompt',
  'prompt_text',
  'raw_prompt',
  'raw_response',
  'model_response',
  'chain_of_thought',
  'hidden_reasoning',
  'reasoning_trace',
  'private_scratchpad',
  'protected_payload',
]));

function fail(message, code = 'TEACHING_D05_ORCHESTRATION_CONTRACT_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function nonEmpty(value, field) {
  const normalized = String(value || '').trim();
  if (!normalized) fail(`${field} is required.`);
  return normalized;
}

function optionalString(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function freezeDeep(value) {
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) return Object.freeze(value.map(freezeDeep));
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = freezeDeep(item);
    return Object.freeze(result);
  }
  return value;
}

function normalizeStringArray(value, field) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value)) fail(`${field} must be an array.`);
  const normalized = value.map((item) => nonEmpty(item, field));
  if (new Set(normalized).size !== normalized.length) fail(`${field} must not contain duplicates.`);
  return Object.freeze(normalized);
}

function sanitizeAuditMetadata(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('auditMetadata must be an object.');
  }
  const safe = {};
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = String(key).trim().toLowerCase();
    if (FORBIDDEN_AUDIT_KEYS.has(normalizedKey)) {
      fail(`Unsafe audit metadata field is forbidden: ${key}`, 'TEACHING_HIDDEN_REASONING_PERSISTENCE_FORBIDDEN');
    }
    safe[key] = item;
  }
  const encoded = JSON.stringify(safe);
  if (Buffer.byteLength(encoded, 'utf8') > 32_768) {
    fail('auditMetadata exceeds the 32 KiB safe metadata limit.');
  }
  return freezeDeep(safe);
}

function normalizeStateReference(value, { required = true } = {}) {
  if (value == null && !required) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('stateReference must be an object.');
  }
  return freezeDeep({
    aggregate_type: nonEmpty(value.aggregate_type, 'stateReference.aggregate_type'),
    aggregate_id: nonEmpty(value.aggregate_id, 'stateReference.aggregate_id'),
    state_version: nonEmpty(value.state_version, 'stateReference.state_version'),
    precondition_token: optionalString(value.precondition_token),
  });
}

function normalizePreconditions(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('preconditions must be an object.');
  }
  return freezeDeep(value);
}

function toIso(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) fail(`${field} must be an ISO-compatible timestamp.`);
  return date.toISOString();
}

/**
 * Normalizes all trigger classes without allowing caller authority promotion.
 * Authenticated/client input is stamped with server-received time; a client
 * clock may be retained as non-authoritative metadata only.
 */
function normalizeOrchestrationTrigger(trigger, { serverNow = new Date() } = {}) {
  if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) {
    fail('Teaching orchestration trigger must be an object.');
  }
  const type = nonEmpty(trigger.type, 'trigger.type');
  if (!Object.values(ORCHESTRATION_TRIGGER_TYPES).includes(type)) {
    fail(`Unsupported Teaching orchestration trigger type: ${type}`, 'TEACHING_D05_TRIGGER_TYPE_INVALID');
  }
  const authorityCategory = TRIGGER_AUTHORITY_CATEGORY[type];
  const suppliedCategory = optionalString(trigger.authority_category);
  if (suppliedCategory && suppliedCategory !== authorityCategory) {
    fail('Trigger authority category cannot be reclassified by the caller.', 'TEACHING_D05_TRIGGER_AUTHORITY_MISMATCH');
  }

  const serverReceivedAt = toIso(serverNow, 'serverNow');
  const suppliedOccurredAt = optionalString(trigger.occurred_at);
  const dueAt = optionalString(trigger.due_at);
  if (type === ORCHESTRATION_TRIGGER_TYPES.SCHEDULED_DUE_EVENT && !dueAt) {
    fail('scheduled_due_event trigger requires due_at.');
  }

  const isClientInput = type === ORCHESTRATION_TRIGGER_TYPES.AUTHENTICATED_INPUT;
  const authoritativeOccurredAt = isClientInput
    ? serverReceivedAt
    : suppliedOccurredAt == null
      ? serverReceivedAt
      : toIso(suppliedOccurredAt, 'trigger.occurred_at');

  return freezeDeep({
    type,
    ref: nonEmpty(trigger.ref, 'trigger.ref'),
    source: nonEmpty(trigger.source, 'trigger.source'),
    authority_category: authorityCategory,
    actor_id: optionalString(trigger.actor_id),
    occurred_at: authoritativeOccurredAt,
    client_occurred_at: isClientInput && suppliedOccurredAt != null
      ? toIso(suppliedOccurredAt, 'trigger.occurred_at')
      : null,
    server_received_at: serverReceivedAt,
    time_authority: isClientInput ? 'server_received' : 'authoritative_trigger_or_server',
    due_at: dueAt == null ? null : toIso(dueAt, 'trigger.due_at'),
    event_id: optionalString(trigger.event_id),
  });
}

function normalizeResultContract(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('resultContract must be an object.');
  }
  return freezeDeep({
    output_schema_id: nonEmpty(value.output_schema_id, 'resultContract.output_schema_id'),
    output_schema_version: nonEmpty(value.output_schema_version, 'resultContract.output_schema_version'),
    validator_ids: normalizeStringArray(value.validator_ids, 'resultContract.validator_ids'),
  });
}

function createExecutionEnvelope({
  executionId,
  trigger,
  capabilityId,
  declaredAuthorityLevel = null,
  stateReference = null,
  preconditions = {},
  provenanceRefs = [],
  resultContract,
  correlationId,
  causationId = null,
  idempotencyKey = null,
  deadlineAt = null,
  auditMetadata = {},
  serverNow = new Date(),
} = {}) {
  const capability = getCapability(nonEmpty(capabilityId, 'capabilityId'));
  assertCapabilityBinding(capability.id);

  if (declaredAuthorityLevel != null) {
    const declared = assertAuthorityLevel(declaredAuthorityLevel);
    if (declared !== capability.authority_ceiling) {
      fail(
        `${capability.id} must execute at its registered authority ceiling ${capability.authority_ceiling}.`,
        'TEACHING_D05_AUTHORITY_MISMATCH'
      );
    }
  }

  const contract = getCapabilityContract(capability.id);
  const normalizedTrigger = normalizeOrchestrationTrigger(trigger, { serverNow });
  const normalizedState = normalizeStateReference(stateReference, {
    required: capability.authority_ceiling !== 'T0',
  });
  const promptContract = capability.authority_ceiling === 'T0'
    ? null
    : freezeDeep({
        family_id: contract.promptFamily.id,
        family_version: contract.promptFamily.version,
        structural_contract_version: contract.contractVersion,
        constitution_version: contract.constitutionVersion,
      });

  return freezeDeep({
    execution_id: nonEmpty(executionId, 'executionId'),
    trigger: normalizedTrigger,
    correlation_id: nonEmpty(correlationId, 'correlationId'),
    causation_id: optionalString(causationId),
    idempotency_key: optionalString(idempotencyKey),
    capability: {
      id: capability.id,
      execution_class: capability.execution_class,
      authority_ceiling: capability.authority_ceiling,
      authoritative_owner_boundary: capability.authoritative_owner_boundary,
      commit_posture: capability.commit_posture,
    },
    prompt_contract: promptContract,
    state_reference: normalizedState,
    preconditions: normalizePreconditions(preconditions),
    provenance_refs: normalizeStringArray(provenanceRefs, 'provenanceRefs'),
    result_contract: normalizeResultContract(resultContract),
    deadline_at: deadlineAt == null ? null : toIso(deadlineAt, 'deadlineAt'),
    audit_metadata: sanitizeAuditMetadata(auditMetadata),
  });
}

module.exports = {
  ORCHESTRATION_TRIGGER_TYPES,
  TRIGGER_AUTHORITY_CATEGORY,
  FORBIDDEN_AUDIT_KEYS,
  normalizeOrchestrationTrigger,
  normalizeStateReference,
  normalizePreconditions,
  sanitizeAuditMetadata,
  createExecutionEnvelope,
};
