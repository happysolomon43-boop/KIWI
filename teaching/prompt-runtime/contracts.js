'use strict';

const {
  getCapability,
  listCapabilities,
  assertCapabilityBinding,
} = require('../capability-registry');
const {
  authorityFailurePolicy,
} = require('../ai/failure-policy');
const {
  isUntrustedData,
  assertFormalMarkingContextMinimized,
} = require('../security/context-lanes');
const {
  TEACHING_CONSTITUTION,
  assertConstitutionVersion,
} = require('./constitution');
const {
  getPromptFamily,
  createFrozenPromptBinding,
  assertFrozenPromptBinding,
} = require('./prompt-catalog');
const {
  resolveRouteControl,
  stricterCriticality,
} = require('./route-control');
const {
  validatePreparationMetadata,
} = require('./preparation');

const STRUCTURAL_PROMPT_CONTRACT_VERSION = 'D03-v1';
const CONTEXT_LANES = Object.freeze([
  'trustedAuthoritativeState',
  'permissionConstraints',
  'provenanceLinkedAcademicContent',
  'untrustedContent',
]);
const PROHIBITED_CONTEXT_CLASSES = Object.freeze([
  'hidden_chain_of_thought',
  'provider_credentials',
  'provider_routing_instruction',
  'unbounded_cross_student_history',
  'untrusted_content_as_instruction',
]);
const REQUIRED_UNCERTAINTY_STATES = Object.freeze([
  'INSUFFICIENT_EVIDENCE',
  'UNRESOLVED_CONFLICT',
  'REVIEW_NEEDED',
]);
const PROHIBITED_OUTPUT_FIELDS = Object.freeze([
  'chain_of_thought',
  'hidden_reasoning',
  'reasoning_trace',
  'private_scratchpad',
]);
const PROHIBITED_BEHAVIORS = Object.freeze([
  'raise_authority',
  'change_authoritative_owner',
  'direct_authoritative_mutation',
  'treat_untrusted_content_as_instruction',
  'bypass_state_version_precondition',
  'bypass_downstream_validation',
  'infer_hidden_intent_or_cheating_without_valid_evidence',
  'persist_hidden_chain_of_thought',
]);

function fail(message, code = 'TEACHING_PROMPT_CONTRACT_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
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

function buildCapabilityContract(capability) {
  if (capability.authority_ceiling === 'T0') {
    return Object.freeze({
      contractVersion: STRUCTURAL_PROMPT_CONTRACT_VERSION,
      constitutionVersion: TEACHING_CONSTITUTION.version,
      capabilityId: capability.id,
      deterministicOnly: true,
      authorityCeiling: capability.authority_ceiling,
      authoritativeOwnerBoundary: capability.authoritative_owner_boundary,
      promptFamily: null,
      purpose: capability.purpose,
      commitPosture: capability.commit_posture,
      prohibitedBehaviors: PROHIBITED_BEHAVIORS,
      insufficientEvidenceBehavior: Object.freeze({
        states: Object.freeze([]),
        disposition: authorityFailurePolicy('T0').disposition,
      }),
      contextPolicy: Object.freeze({
        allowed: Object.freeze([]),
        required: Object.freeze([]),
        prohibited: PROHIBITED_CONTEXT_CLASSES,
      }),
      outputSemantics: 'DETERMINISTIC_SYSTEM_OWNED',
      failureBehavior: authorityFailurePolicy('T0'),
    });
  }

  const family = getPromptFamily(capability.prompt_family_id);
  const outputSemantics = {
    T1: 'PRESENTATION_ONLY',
    T2: 'STRUCTURED_INTERPRETATION_OR_HYPOTHESIS',
    T3: 'PROVISIONAL_ACADEMIC_ARTIFACT',
    T4: 'CONTROLLED_ACADEMIC_JUDGMENT',
  }[capability.authority_ceiling];

  return Object.freeze({
    contractVersion: STRUCTURAL_PROMPT_CONTRACT_VERSION,
    constitutionVersion: TEACHING_CONSTITUTION.version,
    capabilityId: capability.id,
    executionClass: capability.execution_class,
    authorityCeiling: capability.authority_ceiling,
    authoritativeOwnerBoundary: capability.authoritative_owner_boundary,
    modelPosture: capability.model_posture,
    promptFamily: Object.freeze({
      id: family.id,
      version: family.version,
      defaultCriticality: family.criticality,
      sourceSha256: family.promptSha256,
    }),
    purpose: capability.purpose,
    commitPosture: capability.commit_posture,
    prohibitedBehaviors: PROHIBITED_BEHAVIORS,
    insufficientEvidenceBehavior: Object.freeze({
      states: REQUIRED_UNCERTAINTY_STATES,
      disposition: authorityFailurePolicy(capability.authority_ceiling).disposition,
      reviewHandoffRequired: capability.authority_ceiling === 'T4',
    }),
    directiveRequirements: Object.freeze({
      typedTaskMode: true,
      boundedActions: true,
      allowedOperations: true,
      prohibitedOperations: true,
      evidencePurpose: true,
      downstreamHandoff: true,
    }),
    contextPolicy: Object.freeze({
      allowed: Object.freeze([...CONTEXT_LANES]),
      required: Object.freeze([
        'trustedAuthoritativeState',
        'permissionConstraints',
      ]),
      prohibited: PROHIBITED_CONTEXT_CLASSES,
      capabilityScopedMinimizationRequired: true,
      t4StrictMinimizationRequired: capability.authority_ceiling === 'T4',
    }),
    outputContract: Object.freeze({
      schemaBindingRequired: true,
      uncertaintyStatesRequired: REQUIRED_UNCERTAINTY_STATES,
      explicitReviewNeededRequired: true,
      studentFacingAndStateBearingFieldsMustBeSeparate: true,
      hiddenChainOfThoughtAllowed: false,
      prohibitedFields: PROHIBITED_OUTPUT_FIELDS,
      outputSemantics,
    }),
    validationRequirements: Object.freeze({
      schema: true,
      authority: true,
      provenance: true,
      domain: capability.authority_ceiling !== 'T1',
      stateVersion: true,
      downstreamGate: true,
      deterministicAuthorityChecks: true,
    }),
    failureBehavior: authorityFailurePolicy(capability.authority_ceiling),
    auditMetadata: Object.freeze([
      'capability_id',
      'prompt_family_id',
      'prompt_family_version',
      'constitution_version',
      'output_schema_id',
      'output_schema_version',
      'correlation_id',
      'validation_outcome',
    ]),
  });
}

const capabilityContracts = new Map();
for (const capability of listCapabilities()) {
  capabilityContracts.set(capability.id, buildCapabilityContract(capability));
}

function getCapabilityContract(capabilityId) {
  const capability = getCapability(capabilityId);
  return capabilityContracts.get(capability.id);
}

function assertStateReference(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('Teaching model invocation requires a structured state_reference.');
  }
  for (const field of ['aggregate_type', 'aggregate_id', 'state_version']) {
    if (!String(value[field] ?? '').trim()) fail(`state_reference.${field} is required.`);
  }
  return freezeDeep({
    aggregate_type: String(value.aggregate_type).trim(),
    aggregate_id: String(value.aggregate_id).trim(),
    state_version: String(value.state_version).trim(),
    precondition_token: value.precondition_token == null
      ? null
      : String(value.precondition_token).trim(),
  });
}

function assertContextLanes(contextLanes, contract) {
  if (!contextLanes || typeof contextLanes !== 'object' || Array.isArray(contextLanes)) {
    fail('Teaching model invocation requires structurally separated context lanes.');
  }
  for (const lane of contract.contextPolicy.required) {
    if (!Object.prototype.hasOwnProperty.call(contextLanes, lane)) {
      fail(`Required context lane is missing: ${lane}`, 'TEACHING_REQUIRED_CONTEXT_LANE_MISSING');
    }
  }
  for (const key of Object.keys(contextLanes)) {
    if (!CONTEXT_LANES.includes(key)) {
      fail(`Unknown or untrusted instruction-like context lane: ${key}`, 'TEACHING_CONTEXT_LANE_FORBIDDEN');
    }
  }
  const untrusted = contextLanes.untrustedContent || [];
  if (!Array.isArray(untrusted) || untrusted.some((item) => !isUntrustedData(item))) {
    fail(
      'Every untrusted Teaching context item must remain wrapped as untrusted data.',
      'TEACHING_UNTRUSTED_CONTEXT_NOT_WRAPPED'
    );
  }
  if (contract.contextPolicy.t4StrictMinimizationRequired) {
    assertFormalMarkingContextMinimized(contextLanes);
  }
  return true;
}

function assertOutputSchemaDescriptor(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    fail('Teaching model invocation requires an output schema descriptor.');
  }
  const id = String(schema.id || '').trim();
  const version = String(schema.version || '').trim();
  if (!id || !version) fail('Output schema descriptor requires id and version.');

  if (typeof schema.validate !== 'function') {
    fail('Output schema descriptor requires validate().', 'TEACHING_OUTPUT_SCHEMA_VALIDATOR_REQUIRED');
  }

  const uncertaintyStates = Array.isArray(schema.uncertainty_states)
    ? schema.uncertainty_states.map((value) => String(value).trim())
    : [];
  for (const required of REQUIRED_UNCERTAINTY_STATES) {
    if (!uncertaintyStates.includes(required)) {
      fail(
        `Output schema ${id}@${version} must support ${required}.`,
        'TEACHING_OUTPUT_SCHEMA_UNCERTAINTY_INCOMPLETE'
      );
    }
  }

  const reviewNeededField = String(schema.review_needed_field || '').trim();
  if (!reviewNeededField) {
    fail('Output schema descriptor requires review_needed_field.');
  }

  const stateBearingFields = Array.isArray(schema.state_bearing_fields)
    ? schema.state_bearing_fields.map((value) => String(value).trim()).filter(Boolean)
    : [];
  const studentFacingField = schema.student_facing_field == null
    ? null
    : String(schema.student_facing_field).trim();

  if (studentFacingField && stateBearingFields.includes(studentFacingField)) {
    fail(
      'Student-facing prose cannot share the same field as state-bearing classification/judgment.',
      'TEACHING_OUTPUT_SEMANTIC_LANES_COLLAPSED'
    );
  }

  const declaredFields = Array.isArray(schema.declared_fields)
    ? schema.declared_fields.map((value) => String(value).trim())
    : [];
  for (const prohibited of PROHIBITED_OUTPUT_FIELDS) {
    if (declaredFields.includes(prohibited)) {
      fail(
        `Output schema must not request hidden chain-of-thought field: ${prohibited}`,
        'TEACHING_HIDDEN_REASONING_FIELD_FORBIDDEN'
      );
    }
  }

  return Object.freeze({
    id,
    version,
    validate: schema.validate,
    uncertainty_states: Object.freeze(uncertaintyStates),
    review_needed_field: reviewNeededField,
    state_bearing_fields: Object.freeze(stateBearingFields),
    student_facing_field: studentFacingField,
    declared_fields: Object.freeze(declaredFields),
  });
}

function assertStringArray(value, field, { allowEmpty = false } = {}) {
  if (!Array.isArray(value)) {
    fail(`${field} must be an array.`, 'TEACHING_PROMPT_DIRECTIVE_INVALID');
  }
  const normalized = value.map((item) => String(item || '').trim()).filter(Boolean);
  if (!allowEmpty && normalized.length === 0) {
    fail(`${field} must contain at least one bounded value.`, 'TEACHING_PROMPT_DIRECTIVE_INVALID');
  }
  if (new Set(normalized).size !== normalized.length) {
    fail(`${field} must not contain duplicate values.`, 'TEACHING_PROMPT_DIRECTIVE_INVALID');
  }
  return Object.freeze(normalized);
}

function assertDirective(directive, capability) {
  if (!directive || typeof directive !== 'object' || Array.isArray(directive)) {
    fail('Teaching model invocation requires a structured directive.', 'TEACHING_PROMPT_DIRECTIVE_REQUIRED');
  }

  const boundedActions = assertStringArray(directive.bounded_actions, 'directive.bounded_actions');
  const allowedOperations = assertStringArray(directive.allowed_operations, 'directive.allowed_operations');
  const prohibitedOperations = assertStringArray(
    directive.prohibited_operations,
    'directive.prohibited_operations',
    { allowEmpty: true }
  );
  const evidencePurpose = String(directive.evidence_purpose || '').trim();
  if (!evidencePurpose) {
    fail('directive.evidence_purpose is required.', 'TEACHING_PROMPT_DIRECTIVE_INVALID');
  }

  const handoff = directive.downstream_handoff;
  if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff)) {
    fail('directive.downstream_handoff is required.', 'TEACHING_PROMPT_DIRECTIVE_INVALID');
  }
  const handoffType = String(handoff.type || '').trim();
  const commitOwnerBoundary = String(handoff.commit_owner_boundary || '').trim();
  const validatorIds = assertStringArray(
    handoff.validator_ids || [],
    'directive.downstream_handoff.validator_ids',
    { allowEmpty: true }
  );
  if (!handoffType || !commitOwnerBoundary) {
    fail(
      'directive.downstream_handoff requires type and commit_owner_boundary.',
      'TEACHING_PROMPT_DIRECTIVE_INVALID'
    );
  }
  if (commitOwnerBoundary !== capability.authoritative_owner_boundary) {
    fail(
      `${capability.id} downstream handoff cannot change authoritative owner/boundary.`,
      'TEACHING_PROMPT_HANDOFF_OWNER_MISMATCH'
    );
  }

  return freezeDeep({
    bounded_actions: boundedActions,
    allowed_operations: allowedOperations,
    prohibited_operations: prohibitedOperations,
    evidence_purpose: evidencePurpose,
    downstream_handoff: {
      type: handoffType,
      validator_ids: validatorIds,
      commit_owner_boundary: commitOwnerBoundary,
    },
  });
}

function assertT4ContextAllowlist(contextLanes, allowlist, capability) {
  if (capability.authority_ceiling !== 'T4') return null;
  if (!allowlist || typeof allowlist !== 'object' || Array.isArray(allowlist)) {
    fail(
      'T4 Teaching invocation requires an explicit context allowlist.',
      'TEACHING_T4_CONTEXT_ALLOWLIST_REQUIRED'
    );
  }
  const normalized = {};
  for (const lane of CONTEXT_LANES) {
    const fields = allowlist[lane] == null ? [] : allowlist[lane];
    normalized[lane] = assertStringArray(fields, `context_allowlist.${lane}`, { allowEmpty: true });
  }

  for (const lane of ['trustedAuthoritativeState', 'permissionConstraints']) {
    const allowed = new Set(normalized[lane]);
    for (const field of Object.keys(contextLanes[lane] || {})) {
      if (!allowed.has(field)) {
        fail(
          `T4 context field is not allowlisted for ${capability.id}: ${lane}.${field}`,
          'TEACHING_T4_CONTEXT_FIELD_FORBIDDEN'
        );
      }
    }
  }
  return freezeDeep(normalized);
}

function createStructuralPromptInvocation({
  capabilityId,
  taskMode,
  directive,
  contextLanes,
  contextAllowlist = null,
  stateReference,
  outputSchema,
  constitutionVersion = TEACHING_CONSTITUTION.version,
  capabilityCriticalityOverride = null,
  preparation = null,
  audit = {},
} = {}) {
  const capability = assertCapabilityBinding(capabilityId);
  if (capability.authority_ceiling === 'T0') {
    fail(
      `${capability.id} is T0 and cannot receive a model prompt.`,
      'TEACHING_T0_PROMPT_FORBIDDEN'
    );
  }

  assertConstitutionVersion(constitutionVersion);
  const contract = getCapabilityContract(capability.id);
  const task = String(taskMode || '').trim();
  if (!task) fail('Teaching model invocation requires task_mode.');

  const boundedDirective = assertDirective(directive, capability);
  assertContextLanes(contextLanes, contract);
  const t4ContextAllowlist = assertT4ContextAllowlist(contextLanes, contextAllowlist, capability);
  const state = assertStateReference(stateReference);
  const schema = assertOutputSchemaDescriptor(outputSchema);
  const prompt = createFrozenPromptBinding(
    contract.promptFamily.id,
    contract.promptFamily.version
  );
  assertFrozenPromptBinding(prompt);

  const preparationMetadata = preparation == null
    ? null
    : validatePreparationMetadata(preparation);
  const route = resolveRouteControl(capability.id, {
    capabilityCriticalityOverride,
    preparationRoutePosture: preparationMetadata?.route_posture || null,
  });

  const correlationId = String(audit.correlation_id || preparationMetadata?.correlation_id || '').trim();
  if (!correlationId) fail('Teaching model invocation requires audit.correlation_id.');

  const invocation = {
    contract_version: STRUCTURAL_PROMPT_CONTRACT_VERSION,
    constitution: Object.freeze({
      version: TEACHING_CONSTITUTION.version,
      source_sha256: TEACHING_CONSTITUTION.sourceSha256,
      precedence: TEACHING_CONSTITUTION.precedence,
    }),
    capability: Object.freeze({
      id: capability.id,
      execution_class: capability.execution_class,
      authority_ceiling: capability.authority_ceiling,
      authoritative_owner_boundary: capability.authoritative_owner_boundary,
      commit_posture: capability.commit_posture,
      purpose: capability.purpose,
    }),
    directive: boundedDirective,
    context_allowlist: t4ContextAllowlist,
    prompt: Object.freeze({
      family_id: prompt.familyId,
      family_version: prompt.familyVersion,
      manifest_version: prompt.manifestVersion,
      manifest_sha256: prompt.manifestSha256,
      combined_pack_sha256: prompt.combinedPackSha256,
      frozen_binding: prompt,
      task_mode: task,
    }),
    context_lanes: contextLanes,
    state_reference: state,
    output_schema: schema,
    validation_requirements: contract.validationRequirements,
    failure_behavior: contract.failureBehavior,
    route_control: route,
    preparation: preparationMetadata,
    audit: freezeDeep({
      correlation_id: correlationId,
      causation_id: audit.causation_id == null ? null : String(audit.causation_id).trim(),
      capability_id: capability.id,
      prompt_family_id: prompt.familyId,
      prompt_family_version: prompt.familyVersion,
      constitution_version: TEACHING_CONSTITUTION.version,
      output_schema_id: schema.id,
      output_schema_version: schema.version,
    }),
  };

  return freezeDeep(invocation);
}

function assertCapabilityContractsComplete() {
  let modelBacked = 0;
  let deterministic = 0;

  for (const capability of listCapabilities()) {
    const contract = getCapabilityContract(capability.id);
    if (!contract) fail(`Missing capability contract: ${capability.id}`);

    if (capability.authority_ceiling === 'T0') {
      deterministic += 1;
      if (!contract.deterministicOnly || contract.promptFamily !== null) {
        fail(`${capability.id} T0 contract must remain deterministic and promptless.`);
      }
      continue;
    }

    modelBacked += 1;
    if (!contract.purpose) fail(`${capability.id} contract missing purpose.`);
    if (!contract.prohibitedBehaviors?.length) fail(`${capability.id} contract missing prohibited behavior.`);
    if (!contract.directiveRequirements?.boundedActions || !contract.directiveRequirements?.downstreamHandoff) {
      fail(`${capability.id} contract missing bounded directive/downstream handoff requirements.`);
    }
    if (!contract.insufficientEvidenceBehavior?.states?.length) {
      fail(`${capability.id} contract missing insufficient-evidence behavior.`);
    }
    if (!contract.contextPolicy?.allowed?.length) fail(`${capability.id} contract missing legitimate context lanes.`);
    if (!contract.contextPolicy?.prohibited?.length) fail(`${capability.id} contract missing prohibited context.`);
    if (!contract.outputContract?.outputSemantics) fail(`${capability.id} contract missing output semantics.`);
    if (!contract.validationRequirements?.schema) fail(`${capability.id} contract missing schema validation.`);
    if (!contract.authoritativeOwnerBoundary) fail(`${capability.id} contract missing downstream owner/boundary.`);
    if (!contract.failureBehavior?.disposition) fail(`${capability.id} contract missing failure behavior.`);
    if (!contract.constitutionVersion || !contract.promptFamily?.version) {
      fail(`${capability.id} contract missing version metadata.`);
    }
  }

  if (modelBacked !== 147 || deterministic !== 22) {
    fail(`Capability contract census mismatch: ${modelBacked} model-backed, ${deterministic} T0.`);
  }

  return Object.freeze({ modelBacked, deterministic, total: modelBacked + deterministic });
}

const completeness = assertCapabilityContractsComplete();

module.exports = {
  STRUCTURAL_PROMPT_CONTRACT_VERSION,
  CONTEXT_LANES,
  PROHIBITED_CONTEXT_CLASSES,
  REQUIRED_UNCERTAINTY_STATES,
  PROHIBITED_OUTPUT_FIELDS,
  PROHIBITED_BEHAVIORS,
  completeness,
  getCapabilityContract,
  assertCapabilityContractsComplete,
  assertOutputSchemaDescriptor,
  createStructuralPromptInvocation,
  stricterCriticality,
};
