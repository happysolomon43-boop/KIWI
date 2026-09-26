'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const registry = require('../../../teaching/capability-registry');
const { createTeachingPromptControlPlane } = require('../../../teaching/prompt-runtime');
const { buildSeparatedContextLanes } = require('../../../teaching/security/context-lanes');
const { createCapabilityContextAssembler } = require('../../../teaching/orchestrator/context-assembly');
const { createCentralAIExecutionBoundary } = require('../../../teaching/ai/central-orchestrator-boundary');
const { createTeachingAIAdapter } = require('../../../teaching/orchestrator/ai-adapter');
const { createTeachingOrchestrator } = require('../../../teaching/orchestrator/teaching-orchestrator');
const { createOrchestratorPreflight } = require('../../../teaching/orchestrator/preflight');
const { createAuthoritativeOwnerRouter } = require('../../../teaching/orchestrator/owner-router');
const {
  createExecutionEnvelope,
  normalizeOrchestrationTrigger,
} = require('../../../teaching/orchestrator/contracts');
const {
  createOrchestrationPlan,
  executeOrchestrationPlan,
} = require('../../../teaching/orchestrator/composition');
const { createTransactionalTeachingMutation } = require('../../../teaching/runtime/transactional-mutation');
const { TEACHING_EVENTS } = require('../../../teaching/events/names');
const { createTeachingEventSubscriberRegistry } = require('../../../teaching/events/dispatcher');
const {
  evaluateWorkspaceTransition,
  reconcileMaterialityAndStaleness,
  evaluateFinalizationReadiness,
  assertProtectedContentIsolation,
  PPL_T0_CAPABILITIES,
} = require('../../../teaching/preparation/t0-handlers');
const {
  buildPreparationEvent,
  coalescePreparationInputChanges,
  createPreparationEventScheduler,
} = require('../../../teaching/preparation/events');
const {
  createPreparationWorkflowPlan,
  executePreparationWorkflow,
} = require('../../../teaching/preparation/workflow');

const T1 = 'teaching.lesson.student_facing_class_summary_generation';
const T2 = 'teaching.curriculum.intake_signal_extraction';
const T3 = 'teaching.curriculum.deep_curriculum_audit';
const T4 = 'teaching.scheduling.homework_independent_work_evaluation';

function schemaDescriptor(id = 'd05.test') {
  return {
    id,
    version: '1',
    uncertainty_states: ['INSUFFICIENT_EVIDENCE','UNRESOLVED_CONFLICT','REVIEW_NEEDED'],
    review_needed_field: 'reviewNeeded',
    state_bearing_fields: ['classification'],
    student_facing_field: 'message',
    declared_fields: ['classification','message','reviewNeeded'],
    validate: async (value) => ({ ok: true, value: value.structured || value }),
  };
}

function directiveFor(capabilityId) {
  const cap = registry.getCapability(capabilityId);
  return {
    bounded_actions: ['perform_registered_capability'],
    allowed_operations: ['return_structured_result'],
    prohibited_operations: ['direct_authoritative_mutation'],
    evidence_purpose: 'd05_test',
    downstream_handoff: {
      type: 'authoritative_owner_validation',
      validator_ids: ['d05-test-validator'],
      commit_owner_boundary: cap.authoritative_owner_boundary,
    },
  };
}

const freshSnapshot = Object.freeze({
  stateReference: {
    aggregate_type: 'course',
    aggregate_id: 'course-1',
    state_version: '7',
    precondition_token: 'p7',
  },
  preconditions: { scopeVersion: 'scope-7' },
});

function baseRequest(capabilityId, overrides = {}) {
  const capability = registry.getCapability(capabilityId);
  return {
    capabilityId,
    declaredAuthorityLevel: capability.authority_ceiling,
    trigger: {
      type: 'committed_domain_event',
      ref: `trigger:${capabilityId}`,
      source: 'd05-test',
      event_id: `evt:${capabilityId}`,
    },
    stateReference: { ...freshSnapshot.stateReference },
    preconditions: { ...freshSnapshot.preconditions },
    resultContract: {
      output_schema_id: 'd05.test',
      output_schema_version: '1',
      validator_ids: ['d05-test-validator'],
    },
    correlationId: `corr:${capabilityId}`,
    idempotencyKey: `idem:${capabilityId}`,
    taskMode: 'd05_test',
    directive: directiveFor(capabilityId),
    outputSchema: schemaDescriptor(),
    contextSpec: {},
    contextAllowlist: capability.authority_ceiling === 'T4' ? {
      trustedAuthoritativeState: ['course'],
      permissionConstraints: ['assistanceAllowed'],
      provenanceLinkedAcademicContent: [],
      untrustedContent: [],
    } : null,
    academicInput: { bounded: true },
    schemaValidator: async (value) => ({ ok: true, value: value.structured || value }),
    domainValidator: async () => true,
    provenanceValidator: async () => true,
    ...overrides,
  };
}

function memoryExecutionStore() {
  const rows = new Map();
  const byKey = new Map();
  return {
    async begin(envelope) {
      if (envelope.idempotency_key && byKey.has(envelope.idempotency_key)) {
        return { inserted: false, execution: rows.get(byKey.get(envelope.idempotency_key)) };
      }
      const row = { execution_id: envelope.execution_id, status: 'PENDING' };
      rows.set(envelope.execution_id, row);
      if (envelope.idempotency_key) byKey.set(envelope.idempotency_key, envelope.execution_id);
      return { inserted: true, execution: row };
    },
    async mark(id, status, metadata = {}) {
      const row = rows.get(id);
      row.status = status;
      Object.assign(row, metadata);
      return row;
    },
  };
}

function contextAssembler() {
  return {
    async assemble() {
      return buildSeparatedContextLanes({
        trustedAuthoritativeState: { course: { version: 7 } },
        permissionConstraints: { assistanceAllowed: true },
        provenanceLinkedAcademicContent: [],
        untrustedContent: [],
      });
    },
  };
}

function modelAdapter(aiRun, sequence = null) {
  const promptControl = createTeachingPromptControlPlane();
  const boundary = createCentralAIExecutionBoundary({
    aiRun: async (...args) => {
      sequence?.push('MODEL');
      return aiRun(...args);
    },
  });
  return createTeachingAIAdapter({
    promptControl,
    aiBoundary: boundary,
    assertRouteExecutable: () => true,
    resolveCentralTaskId: async () => 'D05_TEST_CENTRAL_TASK',
  });
}

function harness({
  capabilityId,
  aiRun = async () => ({ structured: { classification: 'ok', reviewNeeded: false } }),
  snapshots = [freshSnapshot, freshSnapshot],
  deterministicHandlers = {},
  sequence = null,
} = {}) {
  const promptControl = createTeachingPromptControlPlane();
  const executionStore = memoryExecutionStore();
  const ownerBoundary = registry.getCapability(capabilityId).authoritative_owner_boundary;
  let ownerCalls = 0;
  let readIndex = 0;
  const ownerRouter = createAuthoritativeOwnerRouter({
    ownerServices: {
      [ownerBoundary]: {
        async commitValidatedModelResult() {
          ownerCalls += 1;
          sequence?.push('OWNER_COMMIT');
          return { mutationRef: 'mutation-1' };
        },
      },
    },
  });
  const orchestrator = createTeachingOrchestrator({
    promptControl,
    aiAdapter: modelAdapter(aiRun, sequence),
    executionStore,
    stateReader: async () => {
      const phase = readIndex === 0 ? 'READ_BEFORE_MODEL' : 'READ_AFTER_MODEL';
      sequence?.push(phase);
      return snapshots[Math.min(readIndex++, snapshots.length - 1)];
    },
    contextAssembler: contextAssembler(),
    preflight: createOrchestratorPreflight(),
    ownerRouter,
    deterministicHandlers,
    randomUUID: () => crypto.randomUUID(),
  });
  return { orchestrator, getOwnerCalls: () => ownerCalls };
}

test('D05 trigger normalization preserves authority categories and server time', () => {
  const command = normalizeOrchestrationTrigger({
    type: 'authenticated_input',
    ref: 'input-1',
    source: 'browser',
    occurred_at: '1999-01-01T00:00:00Z',
  }, { serverNow: new Date('2026-09-26T12:00:00Z') });
  assert.equal(command.authority_category, 'authenticated_command');
  assert.equal(command.occurred_at, '2026-09-26T12:00:00.000Z');
  assert.equal(command.client_occurred_at, '1999-01-01T00:00:00.000Z');
  assert.throws(
    () => normalizeOrchestrationTrigger({
      type: 'authenticated_input',
      ref: 'input-1',
      source: 'browser',
      authority_category: 'committed_domain_event',
    }),
    (error) => error.code === 'TEACHING_D05_TRIGGER_AUTHORITY_MISMATCH'
  );
});

test('D05 execution envelope resolves Registry authority/family and rejects escalation', () => {
  const cap = registry.getCapability(T2);
  const envelope = createExecutionEnvelope({
    executionId: 'execution-1',
    trigger: { type: 'committed_domain_event', ref: 'event-1', source: 'domain' },
    capabilityId: T2,
    declaredAuthorityLevel: cap.authority_ceiling,
    stateReference: { aggregate_type: 'course', aggregate_id: 'course-1', state_version: '7' },
    resultContract: { output_schema_id: 'test', output_schema_version: '1', validator_ids: [] },
    correlationId: 'corr-1',
  });
  assert.equal(envelope.capability.id, T2);
  assert.equal(envelope.prompt_contract.family_id, cap.prompt_family_id);
  assert.throws(
    () => createExecutionEnvelope({
      executionId: 'execution-2',
      trigger: { type: 'committed_domain_event', ref: 'event-2', source: 'domain' },
      capabilityId: T2,
      declaredAuthorityLevel: 'T4',
      stateReference: { aggregate_type: 'course', aggregate_id: 'course-1', state_version: '7' },
      resultContract: { output_schema_id: 'test', output_schema_version: '1', validator_ids: [] },
      correlationId: 'corr-2',
    }),
    (error) => error.code === 'TEACHING_D05_AUTHORITY_MISMATCH'
  );
});

test('D05 context assembly authorizes references before retrieval', async () => {
  let reads = 0;
  const assembler = createCapabilityContextAssembler({
    readers: {
      authoritative: async () => { reads += 1; return {}; },
      permissions: async () => ({}),
      provenance: async () => ({}),
      untrusted: async () => ({ kind: 'source_passage', data: 'x' }),
    },
    authorizeContextRef: async ({ ref }) => ref.ref === 'approved',
  });
  await assert.rejects(
    () => assembler.assemble({
      capability: registry.getCapability(T2),
      contextSpec: { authoritative_refs: [{ ref: 'unrelated-attendance' }] },
    }),
    (error) => error.code === 'TEACHING_D05_CONTEXT_REFERENCE_NOT_AUTHORIZED'
  );
  assert.equal(reads, 0);
});

test('D05 model adapter requires provenance validation for T2-T4', async () => {
  const adapter = modelAdapter(async () => ({ structured: { classification: 'x' } }));
  const envelope = createExecutionEnvelope({
    executionId: 'execution-provenance',
    trigger: { type: 'committed_domain_event', ref: 'event-provenance', source: 'domain' },
    capabilityId: T2,
    stateReference: freshSnapshot.stateReference,
    resultContract: { output_schema_id: 'test', output_schema_version: '1', validator_ids: [] },
    correlationId: 'corr-provenance',
  });
  const invocation = adapter.prepare({
    envelope,
    taskMode: 'test',
    directive: directiveFor(T2),
    contextLanes: buildSeparatedContextLanes({
      trustedAuthoritativeState: {},
      permissionConstraints: {},
      provenanceLinkedAcademicContent: [],
      untrustedContent: [],
    }),
    outputSchema: schemaDescriptor(),
  });
  await assert.rejects(
    () => adapter.execute({
      invocation,
      schemaValidator: async (v) => ({ ok: true, value: v }),
      domainValidator: async () => true,
    }),
    (error) => error.code === 'TEACHING_D05_PROVENANCE_VALIDATOR_REQUIRED'
  );
});

test('D05 T0 path is deterministic and never invokes model execution', async () => {
  const capabilityId = PPL_T0_CAPABILITIES.FINALIZATION_READINESS_GATE;
  let modelCalls = 0;
  const { orchestrator } = harness({
    capabilityId,
    aiRun: async () => { modelCalls += 1; return {}; },
    snapshots: [{ stateReference: null, preconditions: {} }],
    deterministicHandlers: {
      [capabilityId]: async () => ({ ready: false, authoritativeMutationPerformed: false }),
    },
  });
  const result = await orchestrator.execute({
    capabilityId,
    trigger: { type: 'workflow_continuation', ref: 'ppl-finalization', source: 'preparation' },
    resultContract: { output_schema_id: 't0', output_schema_version: '1', validator_ids: [] },
    correlationId: 'corr-t0',
    idempotencyKey: 'idem-t0',
    deterministicInput: { workspaceId: 'ws-1' },
  });
  assert.equal(result.deterministic, true);
  assert.equal(modelCalls, 0);
});

test('D05 T1 failure can return safe communication fallback but cannot commit', async () => {
  const { orchestrator, getOwnerCalls } = harness({
    capabilityId: T1,
    aiRun: async () => { throw Object.assign(new Error('provider down'), { code: 'PROVIDER_DOWN' }); },
  });
  const result = await orchestrator.execute(baseRequest(T1, {
    safeCommunicationFallback: async () => 'Temporarily unavailable.',
    commit: true,
  }));
  assert.equal(result.accepted, false);
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.authoritativeMutationPerformed, false);
  assert.equal(getOwnerCalls(), 0);
});

test('D05 invalid T2 output cannot reach authoritative owner', async () => {
  const { orchestrator, getOwnerCalls } = harness({ capabilityId: T2 });
  const result = await orchestrator.execute(baseRequest(T2, {
    schemaValidator: async () => ({ ok: false, reason: 'BAD_SCHEMA' }),
    commit: true,
  }));
  assert.equal(result.accepted, false);
  assert.equal(getOwnerCalls(), 0);
});

test('D05 stale T3 result is rejected before authoritative owner handoff', async () => {
  const stale = {
    stateReference: { ...freshSnapshot.stateReference, state_version: '8', precondition_token: 'p8' },
    preconditions: { scopeVersion: 'scope-8' },
  };
  const { orchestrator, getOwnerCalls } = harness({
    capabilityId: T3,
    snapshots: [freshSnapshot, stale],
  });
  const result = await orchestrator.execute(baseRequest(T3, { commit: true }));
  assert.equal(result.stale, true);
  assert.equal(result.authoritativeMutationPerformed, false);
  assert.equal(getOwnerCalls(), 0);
});

test('D05 validated T4 reaches only registered owner after post-model state re-read', async () => {
  const sequence = [];
  const { orchestrator, getOwnerCalls } = harness({
    capabilityId: T4,
    snapshots: [freshSnapshot, freshSnapshot],
    sequence,
  });
  const result = await orchestrator.execute(baseRequest(T4, { commit: true }));
  assert.equal(result.accepted, true);
  assert.equal(getOwnerCalls(), 1);
  assert.deepEqual(sequence, ['READ_BEFORE_MODEL','MODEL','READ_AFTER_MODEL','OWNER_COMMIT']);
});

test('D05 duplicate durable orchestration delivery is replay-safe', async () => {
  let aiCalls = 0;
  const { orchestrator } = harness({
    capabilityId: T2,
    aiRun: async () => {
      aiCalls += 1;
      return { structured: { classification: 'x', reviewNeeded: false } };
    },
  });
  const request = baseRequest(T2, { commit: false, idempotencyKey: 'same-key' });
  await orchestrator.execute(request);
  const replay = await orchestrator.execute(request);
  assert.equal(replay.replay, true);
  assert.equal(aiCalls, 1);
});

test('D05 explicit composition permits safe concurrency and separate dependent validation', async () => {
  const plan = createOrchestrationPlan([
    { id: 'a', depends_on: [] },
    { id: 'b', depends_on: [] },
    { id: 'validate-a', depends_on: ['a'], independent_validation_of: 'a' },
  ]);
  assert.equal(plan.layers[0].length, 2);
  assert.equal(plan.layers[1][0].id, 'validate-a');
  const result = await executeOrchestrationPlan(plan, async (step) => step.id.toUpperCase());
  assert.equal(result['validate-a'], 'VALIDATE-A');
});

test('D05 authoritative mutation and committed-domain publication share one transaction', async () => {
  const order = [];
  const tx = { query: async () => ({ rows: [] }) };
  const mutation = createTransactionalTeachingMutation({
    withTransaction: async (fn) => {
      order.push('BEGIN');
      const result = await fn(tx);
      order.push('COMMIT');
      return result;
    },
    outboxStore: {
      async appendUsing(queryFn, event) {
        assert.equal(typeof queryFn, 'function');
        order.push(`OUTBOX:${event.eventType}`);
        return { inserted: true };
      },
    },
  });
  await mutation.mutateAndPublish({
    mutate: async () => { order.push('MUTATE'); return { version: 8 }; },
    buildEvent: async (result) => ({
      eventId: 'domain-8',
      eventType: TEACHING_EVENTS.COURSE_ACTIVATED,
      eventCategory: 'committed_domain_event',
      triggerType: 'committed_domain_event',
      source: 'course',
      aggregateType: 'course',
      aggregateId: 'course-1',
      aggregateVersion: result.version,
      occurredAt: '2026-09-26T10:00:00Z',
      idempotencyKey: 'course-1:activated:8',
      payload: {},
    }),
  });
  assert.deepEqual(order, ['BEGIN','MUTATE',`OUTBOX:${TEACHING_EVENTS.COURSE_ACTIVATED}`,'COMMIT']);
});

test('PPL workspace transitions are deterministic, monotonic and finalization-gated', () => {
  assert.throws(
    () => evaluateWorkspaceTransition({
      currentLifecycle: 'ACTIVE',
      currentMaturity: 'CANDIDATE',
      nextMaturity: 'SKELETON',
    }),
    (error) => error.code === 'TEACHING_PPL_MATURITY_REGRESSION_FORBIDDEN'
  );
  assert.throws(
    () => evaluateWorkspaceTransition({
      currentLifecycle: 'FINALIZATION_DUE',
      currentMaturity: 'CANDIDATE',
      nextLifecycle: 'FINALIZED',
      finalizationReadiness: { ready: false },
    }),
    (error) => error.code === 'TEACHING_PPL_FINALIZATION_NOT_READY'
  );
  const decision = evaluateWorkspaceTransition({
    currentLifecycle: 'FINALIZATION_DUE',
    currentMaturity: 'CANDIDATE',
    nextLifecycle: 'FINALIZED',
    finalizationReadiness: { ready: true },
    gateResults: [{ id: 'all', passed: true }],
  });
  assert.equal(decision.nextLifecycle, 'FINALIZED');
  assert.equal(decision.modelConfidenceUsed, false);
});

test('PPL materiality selectively invalidates dependencies and stale completions fail closed', () => {
  const stale = reconcileMaterialityAndStaleness({
    completionCapturedVersions: { workspace: 3 },
    currentVersions: { workspace: 4 },
  });
  assert.equal(stale.disposition, 'STALE_RESULT_REJECTED');

  const material = reconcileMaterialityAndStaleness({
    completionCapturedVersions: { workspace: 4 },
    currentVersions: { workspace: 4 },
    changedDependencyRefs: ['coverage:v2'],
    componentDependencies: [
      { componentId: 'a', dependencyRef: 'coverage:v2' },
      { componentId: 'b', dependencyRef: 'policy:v1' },
    ],
  });
  assert.deepEqual(material.invalidatedComponentIds, ['a']);
  assert.equal(material.artifactValidity, 'PARTIALLY_STALE');
});

test('PPL finalization is fail-closed and deadline never overrides blockers', () => {
  const result = evaluateFinalizationReadiness({
    versions: [{ id: 'eligibility', expected: '7', current: '7' }],
    requiredValidations: [{
      id: 'whole-paper',
      passed: false,
      reason: 'WHOLE_PAPER_NOT_VALIDATED',
    }],
    deadlineAt: '2026-09-26T10:00:01Z',
  });
  assert.equal(result.ready, false);
  assert.equal(result.deadline_override_allowed, false);
  assert.ok(result.blockers.includes('WHOLE_PAPER_NOT_VALIDATED'));
});

test('PPL protected-content isolation blocks ordinary Teaching contexts structurally', () => {
  assert.throws(
    () => assertProtectedContentIsolation({
      protectionClass: 'FORMAL_ASSESSMENT_SECRET',
      contextKind: 'lesson',
      accessPurpose: 'preparation',
      authorization: { trustBoundary: 'server', protectedPreparationAuthorized: true },
    }),
    (error) => error.code === 'TEACHING_PPL_PROTECTED_CONTEXT_DENIED'
  );
  assert.equal(assertProtectedContentIsolation({
    protectionClass: 'FORMAL_ASSESSMENT_SECRET',
    contextKind: 'protected_preparation',
    accessPurpose: 'independent_validation',
    authorization: { trustBoundary: 'server', protectedPreparationAuthorized: true },
  }), true);
});

test('PPL durable event coalescing keeps all material dependency refs', () => {
  const common = {
    eventType: TEACHING_EVENTS.PREPARATION_INPUT_CHANGED,
    workspaceId: 'ws-1',
    workspaceVersion: 4,
    occurredAt: '2026-09-26T10:00:00Z',
    correlationId: 'corr-ws-1',
  };
  const a = buildPreparationEvent({ ...common, eventId: 'a', changedDependencyRefs: ['coverage:v2'] });
  const b = buildPreparationEvent({ ...common, eventId: 'b', changedDependencyRefs: ['policy:v3'] });
  const merged = coalescePreparationInputChanges([a,b]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].payload.changedDependencyRefs, ['coverage:v2','policy:v3']);
});

test('PPL scheduler reuses D02 due-events and D05 outbox', async () => {
  const calls = [];
  const scheduler = createPreparationEventScheduler({
    dueEventStore: {
      async enqueue(event) { calls.push(`due:${event.eventType}`); return { inserted: true }; },
    },
    outboxStore: {
      async append(event) { calls.push(`outbox:${event.eventType}`); return { inserted: true }; },
    },
  });
  const reviewDue = buildPreparationEvent({
    eventId: 'due-1',
    eventType: TEACHING_EVENTS.PREPARATION_REVIEW_DUE,
    workspaceId: 'ws-1',
    workspaceVersion: 4,
    occurredAt: '2026-09-26T10:00:00Z',
    dueAt: '2026-09-27T10:00:00Z',
    correlationId: 'corr-ws-1',
  });
  const changed = buildPreparationEvent({
    eventId: 'change-1',
    eventType: TEACHING_EVENTS.PREPARATION_INPUT_CHANGED,
    workspaceId: 'ws-1',
    workspaceVersion: 4,
    occurredAt: '2026-09-26T10:00:00Z',
    correlationId: 'corr-ws-1',
    changedDependencyRefs: ['coverage:v2'],
  });
  await scheduler.enqueue(reviewDue);
  await scheduler.enqueue(changed);
  assert.deepEqual(calls, [
    `due:${TEACHING_EVENTS.PREPARATION_REVIEW_DUE}`,
    `outbox:${TEACHING_EVENTS.PREPARATION_INPUT_CHANGED}`,
  ]);
});

test('PPL workflow is explicit/profile-driven and preserves last valid artifact after failure', async () => {
  const profile = {
    profile_id: 'test-profile',
    version: '1',
    required_independent_review_stages: [],
  };
  const plan = createPreparationWorkflowPlan({
    profile,
    stages: [
      { stage: 'Seed', capabilityId: T3, maturityTarget: 'Skeleton', routePosture: 'strong_design' },
      { stage: 'Repair', capabilityId: T3, maturityTarget: 'Structured', routePosture: 'strong_design' },
    ],
  });
  assert.equal(plan.universalPassCount, null);
  const result = await executePreparationWorkflow(plan, {
    initialArtifact: { version: 0 },
    executeDeterministicStage: async () => ({}),
    executeModelStage: async (stage) => {
      if (stage.stage === 'Repair') {
        throw Object.assign(new Error('provider failure'), { code: 'PROVIDER_DOWN' });
      }
      return { valid: true, artifact: { version: 1 } };
    },
  });
  assert.equal(result.completed, false);
  assert.deepEqual(result.lastValidArtifact, { version: 1 });
});


test('D05 protected context references fail closed when deterministic guard is absent', async () => {
  let reads = 0;
  const assembler = createCapabilityContextAssembler({
    readers: {
      authoritative: async () => { reads += 1; return { secret: true }; },
      permissions: async () => ({}),
      provenance: async () => ({}),
      untrusted: async () => ({ kind: 'source_passage', data: 'x' }),
    },
    authorizeContextRef: async () => ({
      allowed: true,
      protectionClass: 'FORMAL_ASSESSMENT_SECRET',
    }),
  });

  await assert.rejects(
    () => assembler.assemble({
      capability: registry.getCapability(T3),
      contextSpec: {
        context_kind: 'protected_preparation',
        access_purpose: 'preparation',
        authoritative_refs: [{ ref: 'protected-artifact' }],
      },
      accessContext: {
        trustBoundary: 'server',
        protectedPreparationAuthorized: true,
      },
    }),
    (error) => error.code === 'TEACHING_D05_PROTECTED_CONTEXT_GUARD_REQUIRED'
  );
  assert.equal(reads, 0);
});

test('PPL maturity cannot skip canonical deterministic gates', () => {
  assert.throws(
    () => evaluateWorkspaceTransition({
      currentLifecycle: 'ACTIVE',
      currentMaturity: 'SKELETON',
      nextMaturity: 'CANDIDATE',
      gateResults: [{ id: 'candidate-check', passed: true }],
    }),
    (error) => error.code === 'TEACHING_PPL_MATURITY_TRANSITION_FORBIDDEN'
  );
});

test('PPL materiality fails closed to full invalidation when changed dependency cannot be mapped safely', () => {
  const result = reconcileMaterialityAndStaleness({
    completionCapturedVersions: { workspace: 4 },
    currentVersions: { workspace: 4 },
    changedDependencyRefs: ['new-policy:v2'],
    componentDependencies: [
      { componentId: 'a', dependencyRef: 'coverage:v2' },
      { componentId: 'b', dependencyRef: 'timing:v1' },
    ],
    allComponentIds: ['a', 'b', 'c'],
  });
  assert.equal(result.disposition, 'MATERIAL_FULL_INVALIDATION');
  assert.equal(result.material, true);
  assert.equal(result.fullArtifactInvalidation, true);
  assert.equal(result.artifactValidity, 'STALE');
  assert.deepEqual(result.invalidatedComponentIds, ['a', 'b', 'c']);
});

test('PPL protected-content isolation rejects invented non-protected context names', () => {
  assert.throws(
    () => assertProtectedContentIsolation({
      protectionClass: 'FORMAL_ASSESSMENT_SECRET',
      contextKind: 'generic_orchestration',
      accessPurpose: 'preparation',
      authorization: { trustBoundary: 'server', protectedPreparationAuthorized: true },
    }),
    (error) => error.code === 'TEACHING_PPL_PROTECTED_CONTEXT_DENIED'
  );
});

test('PPL same-version distinct facts do not collide on one idempotency key', () => {
  const common = {
    eventType: TEACHING_EVENTS.PREPARATION_FINDING_RESOLVED,
    workspaceId: 'ws-identity',
    workspaceVersion: 9,
    occurredAt: '2026-09-26T11:00:00Z',
    correlationId: 'corr-identity',
  };
  const first = buildPreparationEvent({
    ...common,
    eventId: 'finding-event-1',
    payload: { finding_ref: 'finding-1' },
  });
  const second = buildPreparationEvent({
    ...common,
    eventId: 'finding-event-2',
    payload: { finding_ref: 'finding-2' },
  });
  assert.notEqual(first.idempotencyKey, second.idempotencyKey);
});

test('D05 scheduled due-event publication can share the authoritative owner transaction', async () => {
  const order = [];
  const tx = { query: async () => ({ rows: [] }) };
  const mutation = createTransactionalTeachingMutation({
    withTransaction: async (fn) => {
      order.push('BEGIN');
      const result = await fn(tx);
      order.push('COMMIT');
      return result;
    },
    outboxStore: {
      async appendUsing() {
        throw new Error('scheduled event must not use outbox');
      },
    },
    dueEventStore: {
      async enqueueUsing(queryFn, event) {
        assert.equal(typeof queryFn, 'function');
        order.push(`DUE:${event.eventType}`);
        return { inserted: true };
      },
    },
  });

  await mutation.mutateAndPublish({
    mutate: async () => {
      order.push('MUTATE');
      return { version: 12 };
    },
    buildEvent: async (result) => ({
      eventId: 'class-due-12',
      eventType: TEACHING_EVENTS.CLASS_START_DUE,
      eventCategory: 'scheduled_due_event',
      triggerType: 'system_time',
      source: 'scheduler',
      aggregateType: 'class',
      aggregateId: 'class-12',
      aggregateVersion: result.version,
      occurredAt: '2026-09-26T11:00:00Z',
      dueAt: '2026-09-27T11:00:00Z',
      idempotencyKey: 'class-12:start:12',
      payload: {},
    }),
  });

  assert.deepEqual(order, [
    'BEGIN',
    'MUTATE',
    `DUE:${TEACHING_EVENTS.CLASS_START_DUE}`,
    'COMMIT',
  ]);
});


test('D05 durable published-event registry fails closed when no subscriber exists', async () => {
  const registry = createTeachingEventSubscriberRegistry();
  const event = {
    eventId: 'evt-publish-1',
    schemaVersion: 1,
    eventType: TEACHING_EVENTS.COURSE_ACTIVATED,
    eventCategory: 'committed_domain_event',
    triggerType: 'committed_domain_event',
    source: 'course',
    origin: 'course',
    aggregateType: 'course',
    aggregateId: 'course-1',
    aggregateVersion: 1,
    occurredAt: '2026-09-26T18:00:00Z',
    correlationId: 'corr-publish-1',
    causationId: null,
    idempotencyKey: 'course-1:activated:1',
    payload: {},
    auditRefs: [],
    provenanceRefs: [],
  };

  await assert.rejects(
    () => registry.publish(event),
    (error) => error.code === 'TEACHING_PUBLISHED_EVENT_HANDLER_MISSING'
  );
});

test('D05 durable published-event registry delivers only to explicitly registered subscribers', async () => {
  const registry = createTeachingEventSubscriberRegistry();
  const seen = [];

  registry.register(TEACHING_EVENTS.COURSE_ACTIVATED, {
    subscriberId: 'course-projection',
    handle: async (event) => {
      seen.push(`course:${event.aggregateId}`);
      return { ok: true };
    },
  });
  registry.register(TEACHING_EVENTS.COURSE_ACTIVATED, {
    subscriberId: 'course-audit',
    handle: async (event) => {
      seen.push(`audit:${event.eventId}`);
      return { ok: true };
    },
  });

  const result = await registry.publish({
    eventId: 'evt-publish-2',
    schemaVersion: 1,
    eventType: TEACHING_EVENTS.COURSE_ACTIVATED,
    eventCategory: 'committed_domain_event',
    triggerType: 'committed_domain_event',
    source: 'course',
    origin: 'course',
    aggregateType: 'course',
    aggregateId: 'course-2',
    aggregateVersion: 1,
    occurredAt: '2026-09-26T18:00:00Z',
    correlationId: 'corr-publish-2',
    causationId: null,
    idempotencyKey: 'course-2:activated:1',
    payload: {},
    auditRefs: [],
    provenanceRefs: [],
  });

  assert.deepEqual(seen, ['course:course-2', 'audit:evt-publish-2']);
  assert.equal(result.length, 2);
  assert.deepEqual(
    registry.status(),
    [{
      eventType: TEACHING_EVENTS.COURSE_ACTIVATED,
      subscriberIds: ['course-audit', 'course-projection'],
    }]
  );
});
