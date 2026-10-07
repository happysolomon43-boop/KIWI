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
const { validateTeachingEvent } = require('../../../teaching/events/contracts');
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
const {
  toCanonicalEvent,
} = require('../../../teaching/runtime/durable-outbox-runtime');
const {
  createPreparationPublishedEventHandlers,
  registerPreparationPublishedEventSubscribers,
} = require('../../../teaching/preparation/subscribers');

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

test('D05 durable outbox normalizes PostgreSQL Date timestamps before event validation', () => {
  const canonical = toCanonicalEvent({
    event_id: 'evt-outbox-date',
    schema_version: 1,
    event_type: TEACHING_EVENTS.PREPARATION_WORKSPACE_SEEDED,
    event_category: 'committed_domain_event',
    trigger_type: 'committed_domain_event',
    source: 'teaching_preparation',
    origin: 'teaching_preparation',
    actor_id: null,
    aggregate_type: 'preparation_workspace',
    aggregate_id: 'workspace-1',
    aggregate_version: 1,
    occurred_at: new Date('2026-09-29T05:38:45.106Z'),
    effective_at: null,
    correlation_id: 'corr-outbox-date',
    causation_id: null,
    idempotency_key: 'outbox-date-1',
    payload: {},
    audit_refs: [],
    provenance_refs: [],
  });

  assert.equal(canonical.occurredAt, '2026-09-29T05:38:45.106Z');
  assert.equal(canonical.effectiveAt, null);
  assert.doesNotThrow(() => validateTeachingEvent(canonical));
});

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


test('D05 durable outbox canonicalizes pg Date timestamps before event validation', () => {
  const { toCanonicalEvent } = require('../../../teaching/runtime/durable-outbox-runtime');
  const event = toCanonicalEvent({
    event_id: 'outbox-date-1',
    schema_version: 1,
    event_type: TEACHING_EVENTS.PREPARATION_WORKSPACE_SEEDED,
    event_category: 'committed_domain_event',
    trigger_type: 'committed_domain_event',
    source: 'teaching_preparation',
    origin: 'teaching_preparation',
    actor_id: null,
    aggregate_type: 'preparation_workspace',
    aggregate_id: 'workspace-date-1',
    aggregate_version: 1,
    occurred_at: new Date('2026-09-29T05:38:45.106Z'),
    effective_at: new Date('2026-09-30T05:38:45.106Z'),
    correlation_id: 'corr-date-1',
    causation_id: null,
    idempotency_key: 'outbox-date-1:key',
    payload: { target_ref: 'semester-schedule' },
    audit_refs: [],
    provenance_refs: [],
  });
  assert.equal(event.occurredAt, '2026-09-29T05:38:45.106Z');
  assert.equal(event.effectiveAt, '2026-09-30T05:38:45.106Z');
});

test('D05 durable outbox publishes a Date-backed PostgreSQL row through canonical event validation', async () => {
  const { createDurableTeachingOutboxRuntime } = require('../../../teaching/runtime/durable-outbox-runtime');
  const { validateTeachingEvent } = require('../../../teaching/events/contracts');
  const seen = [];
  let published = 0;
  const row = {
    event_id: 'outbox-date-2',
    schema_version: 1,
    event_type: TEACHING_EVENTS.PREPARATION_WORKSPACE_SEEDED,
    event_category: 'committed_domain_event',
    trigger_type: 'committed_domain_event',
    source: 'teaching_preparation',
    origin: 'teaching_preparation',
    actor_id: null,
    aggregate_type: 'preparation_workspace',
    aggregate_id: 'workspace-date-2',
    aggregate_version: 1,
    occurred_at: new Date('2026-09-29T05:38:45.106Z'),
    effective_at: null,
    correlation_id: 'corr-date-2',
    causation_id: null,
    idempotency_key: 'outbox-date-2:key',
    payload: { target_ref: 'semester-schedule' },
    audit_refs: [],
    provenance_refs: [],
    attempt_count: 1,
    claim_token: 'claim-date-2',
  };
  const runtime = createDurableTeachingOutboxRuntime({
    store: {
      async releaseExpiredClaims() { return 0; },
      async claimPending() { return published > 0 ? [] : [row]; },
      async markPublished(event) {
        assert.equal(event.event_id, row.event_id);
        published += 1;
      },
      async retry() { throw new Error('valid Date-backed row must not enter retry'); },
    },
    publish: async (event) => {
      const validated = validateTeachingEvent(event);
      seen.push(validated);
      return { ok: true };
    },
    workerId: 'test-outbox-date-worker',
    timers: { setInterval() { return null; }, clearInterval() {} },
  });
  const result = await runtime.tick();
  assert.equal(result.claimed, 1);
  assert.deepEqual(result.outcomes, ['PUBLISHED']);
  assert.equal(published, 1);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].occurredAt, '2026-09-29T05:38:45.106Z');
});

test('D05 durable outbox records terminal failure when retry budget is exhausted', async () => {
  const { createDurableTeachingOutboxRuntime } = require('../../../teaching/runtime/durable-outbox-runtime');
  const row = {
    event_id: 'outbox-exhausted-1', schema_version: 1,
    event_type: TEACHING_EVENTS.COURSE_ACTIVATED,
    event_category: 'committed_domain_event', trigger_type: 'committed_domain_event',
    source: 'course', origin: 'course', actor_id: 'student-1',
    aggregate_type: 'course', aggregate_id: 'course-1', aggregate_version: 1,
    occurred_at: new Date().toISOString(), effective_at: null,
    correlation_id: 'corr-exhausted-1', causation_id: null,
    idempotency_key: 'outbox-exhausted-1:key', payload: {}, audit_refs: [], provenance_refs: [],
    attempt_count: 8, claim_token: 'claim-exhausted-1',
  };
  let cancelled = null;
  const runtime = createDurableTeachingOutboxRuntime({
    store: {
      async releaseExpiredClaims() { return 0; },
      async claimPending() { return cancelled ? [] : [row]; },
      async markPublished() { throw new Error('failed publication cannot be marked published'); },
      async retry() { throw new Error('exhausted publication cannot return to retry wait'); },
      async markCancelled(event, details) { cancelled = { event, details }; },
    },
    publish: async () => { throw Object.assign(new Error('invalid model result'), { code: 'TEACHING_D07_CURRICULUM_AUDIT_REJECTED' }); },
    workerId: 'test-outbox-exhausted-worker',
    logger: { error() {} },
    timers: { setInterval() { return null; }, clearInterval() {} },
    maxAttempts: 8,
  });
  const result = await runtime.tick();
  assert.deepEqual(result.outcomes, ['CANCELLED']);
  assert.equal(cancelled.event.event_id, row.event_id);
  assert.equal(cancelled.details.errorCode, 'TEACHING_D07_CURRICULUM_AUDIT_REJECTED');
});

test('D05 terminal outbox update preserves the required next-attempt timestamp', () => {
  const source = require('node:fs').readFileSync(require.resolve('../../../teaching/runtime/postgres-outbox-store'), 'utf8');
  assert.match(source, /status='CANCELLED'.*next_attempt_at=coalesce\(next_attempt_at,now\(\)\)/s);
  assert.doesNotMatch(source, /status='CANCELLED'.*next_attempt_at=null/s);
});

test('D05 central boundary forwards Teaching route posture to the shared AI runtime', async () => {
  let observedOptions = null;
  const boundary = createCentralAIExecutionBoundary({
    aiRun: async (_taskId, _request, options) => {
      observedOptions = options;
      return { structured: { ok: true } };
    },
  });
  await boundary.execute({
    taskId: 'MAIN_CBT', request: { content: 'audit' }, responsibilityKey: 'teaching.test',
    intelligenceClass: 'DIRECT-AI', authorityLevel: 'T1',
    centralRouteOptions: { preparationRoutePosture: 'bounded_interpretive' },
  });
  assert.deepEqual(observedOptions, { preparationRoutePosture: 'bounded_interpretive' });
});

test('D31 production release preserves the exact MAIN_CBT candidate route', () => {
  const source = require('node:fs').readFileSync(require.resolve('../../../teaching/d31/release-orchestrator'), 'utf8');
  assert.match(source, /resolveCentralTaskId:\s*async \(route\) => centralTaskFor\(/);
  assert.doesNotMatch(source, /resolveCentralTaskId:[\s\S]*preparationRoutePosture:\s*routePostureFor/);
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

test('D05/D09 PPL workspace-seeded durable event has an explicit deterministic subscriber', async () => {
  const audits = [];
  const handlers = createPreparationPublishedEventHandlers({
    repository: {
      async getWorkspaceSnapshot(workspaceId) {
        return {
          workspace: {
            workspace_id: workspaceId,
            state_version: 1,
            current_authoritative_input_bundle_ref: 'bundle-1',
            current_artifact_version_ref: null,
            lifecycle_state: 'ACTIVE',
            maturity_stage: 'SKELETON',
          },
        };
      },
      async getMaterialitySnapshot() { throw new Error('not expected'); },
      async applyMaterialityDecision() { throw new Error('not expected'); },
      async hasProcessedEvent() { return false; },
      async auditNoop(input) { audits.push(input); return { ok: true }; },
    },
  });
  const published = createTeachingEventSubscriberRegistry();
  registerPreparationPublishedEventSubscribers(published, handlers);

  const event = buildPreparationEvent({
    eventId: 'ppl-seeded-1',
    eventType: TEACHING_EVENTS.PREPARATION_WORKSPACE_SEEDED,
    workspaceId: 'workspace-1',
    workspaceVersion: 1,
    occurredAt: '2026-09-29T09:00:00Z',
    correlationId: 'corr-ppl-seeded-1',
    payload: {
      target_ref: 'semester-schedule',
      idempotency_scope_ref: 'schedule-profile-1',
    },
  });
  const outcomes = await published.publish(event);

  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].subscriberId, 'ppl-d09-deterministic-gate');
  assert.equal(outcomes[0].result.accepted, true);
  assert.equal(outcomes[0].result.modelWorkStarted, false);
  assert.equal(outcomes[0].result.routeQualification, 'UNQUALIFIED_UNTIL_D30');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'preparation.workspace.seed_event.accepted');
  assert.equal(audits[0].reason, 'WORKSPACE_SEEDED_ROUTE_HELD');
});

test('D05/D09 PPL published-event subscriber is replay-idempotent after durable audit receipt', async () => {
  let reads = 0;
  let audits = 0;
  const handlers = createPreparationPublishedEventHandlers({
    repository: {
      async getWorkspaceSnapshot() { reads += 1; throw new Error('replay must not re-read workspace'); },
      async getMaterialitySnapshot() { throw new Error('not expected'); },
      async applyMaterialityDecision() { throw new Error('not expected'); },
      async hasProcessedEvent({ workspaceId, eventId }) {
        assert.equal(workspaceId, 'workspace-replay');
        assert.equal(eventId, 'ppl-seeded-replay');
        return true;
      },
      async auditNoop() { audits += 1; throw new Error('replay must not duplicate audit'); },
    },
  });
  const event = buildPreparationEvent({
    eventId: 'ppl-seeded-replay',
    eventType: TEACHING_EVENTS.PREPARATION_WORKSPACE_SEEDED,
    workspaceId: 'workspace-replay',
    workspaceVersion: 1,
    occurredAt: '2026-09-29T09:00:00Z',
    correlationId: 'corr-ppl-replay',
    payload: { idempotency_scope_ref: 'seed-replay' },
  });
  const result = await handlers.handleWorkspaceSeeded(event);
  assert.equal(result.accepted, true);
  assert.equal(result.idempotent, true);
  assert.equal(result.disposition, 'ALREADY_PROCESSED');
  assert.equal(reads, 0);
  assert.equal(audits, 0);
});

test('D05/D09 PPL published-event handler rejects version gaps and safely no-ops stale events', async () => {
  const audits = [];
  let stateVersion = 2;
  const handlers = createPreparationPublishedEventHandlers({
    repository: {
      async getWorkspaceSnapshot(workspaceId) {
        return {
          workspace: {
            workspace_id: workspaceId,
            state_version: stateVersion,
            current_authoritative_input_bundle_ref: 'bundle-2',
            current_artifact_version_ref: null,
          },
        };
      },
      async getMaterialitySnapshot() { throw new Error('not expected'); },
      async applyMaterialityDecision() { throw new Error('not expected'); },
      async hasProcessedEvent() { return false; },
      async auditNoop(input) { audits.push(input); return { ok: true }; },
    },
  });

  const stale = buildPreparationEvent({
    eventId: 'ppl-seeded-stale',
    eventType: TEACHING_EVENTS.PREPARATION_WORKSPACE_SEEDED,
    workspaceId: 'workspace-2',
    workspaceVersion: 1,
    occurredAt: '2026-09-29T09:00:00Z',
    correlationId: 'corr-ppl-stale',
    payload: { idempotency_scope_ref: 'seed-stale' },
  });
  const staleResult = await handlers.handleWorkspaceSeeded(stale);
  assert.equal(staleResult.accepted, true);
  assert.equal(staleResult.stale, true);
  assert.equal(audits[0].action, 'preparation.event.stale.noop');

  stateVersion = 0;
  const future = buildPreparationEvent({
    eventId: 'ppl-seeded-future',
    eventType: TEACHING_EVENTS.PREPARATION_WORKSPACE_SEEDED,
    workspaceId: 'workspace-2',
    workspaceVersion: 1,
    occurredAt: '2026-09-29T09:00:01Z',
    correlationId: 'corr-ppl-future',
    payload: { idempotency_scope_ref: 'seed-future' },
  });
  await assert.rejects(
    () => handlers.handleWorkspaceSeeded(future),
    (error) => error.code === 'TEACHING_PPL_EVENT_ORDER_GAP'
  );
});

function createCapturedNeutralInferenceRuntime(captured) {
  const { createAIOrchestrator } = require('../../../services/ai/orchestrator');
  const { createProviderRegistry } = require('../../../services/ai/provider-registry');
  const { AI_PROVIDERS } = require('../../../services/ai/providers');

  const providerRegistry = createProviderRegistry([{
    provider: AI_PROVIDERS.GOOGLE,
    async generate({ request, credential }) {
      captured.push({
        request,
        credentialSlotId: credential.id,
      });
      return {
        text: 'ok',
        finishReason: 'STOP',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        latencyMs: 1,
      };
    },
  }]);

  return createAIOrchestrator({
    providerRegistry,
    env: { GEMINI_API_KEY: 'test-key' },
    logger: { warn() {} },
  });
}

test('D05 exact frozen family reaches the central neutral provider boundary without entering durable state', async () => {
  const { getPromptBody } = require('../../../teaching/prompt-runtime/prompt-catalog');
  const captured = [];
  const ai = createCapturedNeutralInferenceRuntime(captured);
  const { orchestrator } = harness({
    capabilityId: T2,
    aiRun: (_taskId, request) => ai.run('MAIN_CBT', request),
  });

  await orchestrator.execute(baseRequest(T2, {
    academicInput: { signal: 'STUDENT_SENTINEL' },
  }));

  assert.equal(captured.length, 1);
  assert.equal(captured[0].request.contractVersion, 2);
  assert.equal(captured[0].request.capability, 'INFERENCE');
  assert.equal(typeof captured[0].request.model.modelId, 'string');
  assert.equal(typeof captured[0].credentialSlotId, 'string');

  const content = captured[0].request.content.text;
  const family = registry.getCapability(T2).prompt_family_id;
  const record = getPromptBody(
    family,
    registry.getCapability(T2).prompt_family_version || '1.0'
  );
  const body = content
    .split('<KIWI_TEACHING_FROZEN_PROMPT>\n')[1]
    .split('</KIWI_TEACHING_FROZEN_PROMPT>')[0];
  assert.equal(crypto.createHash('sha256').update(body).digest('hex'), record.promptSha256);
  assert.equal(body, record.promptText);
  assert.ok(content.includes('STUDENT_SENTINEL'));
  assert.ok(content.includes('KIWI_TEACHING_RUNTIME_CONTRACT_JSON'));

  const envelope = createExecutionEnvelope({
    executionId: 'no-body',
    capabilityId: T2,
    trigger: { type: 'committed_domain_event', ref: 'event', source: 'domain' },
    stateReference: freshSnapshot.stateReference,
    resultContract: { output_schema_id: 'test', output_schema_version: '1', validator_ids: [] },
    correlationId: 'corr',
  });
  assert.equal(JSON.stringify(envelope).includes(record.promptText), false);
  assert.equal(JSON.stringify(envelope).includes('prompt_text'), false);
});

test('TCH-0919 TPF-20 exact body reaches central neutral AI boundary and is absent from durable execution envelope', async () => {
  const { getPromptBody } = require('../../../teaching/prompt-runtime/prompt-catalog');
  const capabilityId = 'teaching.study.class_grounded_note_generation';
  const captured = [];
  const ai = createCapturedNeutralInferenceRuntime(captured);

  const { orchestrator } = harness({
    capabilityId,
    aiRun: (_taskId, request) => ai.run('MAIN_CBT', request),
  });
  await orchestrator.execute(baseRequest(capabilityId, {
    taskMode: 'PRE_CLASS_NOTE_PREPARATION',
    academicInput: {
      lesson_plan_ref: 'lesson-1@4',
      source_snapshot_ref: 'source-1@2',
      signal: 'TPF20_TRANSPORT_SENTINEL',
    },
  }));

  assert.equal(captured.length, 1);
  assert.equal(captured[0].request.contractVersion, 2);
  assert.equal(captured[0].request.capability, 'INFERENCE');

  const content = captured[0].request.content.text;
  const record = getPromptBody('TPF-20', '1.0');
  const body = content
    .split('<KIWI_TEACHING_FROZEN_PROMPT>\n')[1]
    .split('</KIWI_TEACHING_FROZEN_PROMPT>')[0];
  assert.equal(crypto.createHash('sha256').update(body).digest('hex'), record.promptSha256);
  assert.equal(body, record.promptText);
  assert.ok(content.includes('TPF20_TRANSPORT_SENTINEL'));

  const envelope = createExecutionEnvelope({
    executionId: 'tpf20-no-body',
    capabilityId,
    trigger: { type: 'committed_domain_event', ref: 'event-tpf20', source: 'teaching-study' },
    stateReference: freshSnapshot.stateReference,
    resultContract: {
      output_schema_id: 'study.note.test',
      output_schema_version: '1',
      validator_ids: ['study-note-validator'],
    },
    correlationId: 'corr-tpf20-no-body',
  });
  const serialized = JSON.stringify(envelope);
  assert.equal(serialized.includes(record.promptText), false);
  assert.equal(serialized.includes('prompt_text'), false);
  assert.equal(envelope.prompt_contract.family_id, 'TPF-20');
  assert.equal(envelope.capability.authority_ceiling, 'T3');
});


test('D05 propagates safe validation failure details instead of collapsing rejection to a boolean', async () => {
  const { orchestrator, getOwnerCalls } = harness({ capabilityId: T3 });
  const result = await orchestrator.execute(baseRequest(T3, {
    domainValidator: async () => ({ ok: false, reason: 'TEST_T3_DOMAIN_REJECTION' }),
  }));

  assert.equal(result.accepted, false);
  assert.equal(result.rejectionReason, 'TEST_T3_DOMAIN_REJECTION');
  assert.equal(result.validationStage, 'domain');
  assert.equal(result.validationFailure.kind, 'VALIDATION_REJECTION');
  assert.equal(result.validationFailure.retryable, false);
  assert.equal(result.validationFailure.repairable, 'TARGETED_REPAIR');
  assert.equal(getOwnerCalls(), 0);
});
