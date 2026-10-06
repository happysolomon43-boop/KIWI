'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TPF02_STAGING_SOURCE_THRESHOLD,
  TPF02_SOURCE_BATCH_SIZE,
  TPF02_INVENTORY_SCHEMA_ID,
  TPF02_SYNTHESIS_SCHEMA_ID,
  partitionSources,
  createStagedCurriculumAuditRunner,
} = require('../../../teaching/d07/tpf02-staged');
const { createD07Intelligence } = require('../../../teaching/d07/intelligence');

function course(stateVersion = 2) {
  return {
    course_id: 'course-1',
    student_id: 'student-1',
    subject_id: 'subject-1',
    title: 'PHY 103',
    lifecycle_state: 'DRAFT',
    state_version: stateVersion,
    subject_snapshot_ref: 'subject:subject-1:snapshot-1',
  };
}

function sources(count) {
  return Array.from({ length: count }, (_, index) => ({
    source_content_item_id: `source-${index + 1}`,
    source_kind: 'CARD_FRONT',
    source_ref: `card-${index + 1}:front`,
    source_version_ref: `card-${index + 1}:v1`,
    locator: { ordinal: index + 1 },
    content_hash: `hash-${index + 1}`,
    content_summary: `Physics source item ${index + 1}: bounded academic content for the curriculum audit.`,
  }));
}

function inventoryItem(sourceItem) {
  return {
    source_item_ref: sourceItem.source_item_ref,
    provenance: sourceItem.source_item_ref,
    academic_meaning: `Academic meaning for ${sourceItem.source_item_ref}`,
    proposed_scope_classification: 'required',
    scope_classification_basis: 'Supplied Course material.',
    content_validity_status: 'current_supported',
    content_validity_basis: 'Supported by the supplied Course source.',
    confidence: 'high',
  };
}

async function acceptedThroughValidators(request, candidate) {
  const schema = await request.schemaValidator(candidate, request.validationContext || {});
  assert.equal(schema.ok, true, schema.reason);
  const schemaValue = Object.hasOwn(schema, 'value') ? schema.value : candidate;
  const domain = await request.domainValidator(schemaValue, request.validationContext || {});
  assert.equal(domain.ok, true, domain.reason);
  const domainValue = Object.hasOwn(domain, 'value') ? domain.value : schemaValue;
  const provenance = await request.provenanceValidator(domainValue, request.validationContext || {});
  assert.equal(provenance.ok, true, provenance.reason);
  return {
    accepted: true,
    validatedResult: { output: domainValue },
  };
}

test('large TPF-02 source censuses are partitioned into bounded source-inventory batches', () => {
  const input = sources(130);
  const batches = partitionSources(input);

  assert.equal(TPF02_STAGING_SOURCE_THRESHOLD, 64);
  assert.equal(TPF02_SOURCE_BATCH_SIZE, 24);
  assert.equal(batches.length, 6);
  assert.deepEqual(batches.map((batch) => batch.length), [24, 24, 24, 24, 24, 10]);
  assert.deepEqual(batches.flat().map((item) => item.source_content_item_id), input.map((item) => item.source_content_item_id));
});

test('staged TPF-02 reassembles every validated inventory item before the canonical full validator accepts the audit', async () => {
  const inputSources = sources(65);
  const calls = [];
  const orchestrator = {
    async execute(request) {
      calls.push(request);
      if (request.taskMode === 'SOURCE_INVENTORY') {
        assert.equal(request.outputSchema.id, TPF02_INVENTORY_SCHEMA_ID);
        const candidate = {
          input_state_reference: request.academicInput.input_state_reference,
          source_inventory: request.academicInput.source_items.map(inventoryItem),
        };
        return acceptedThroughValidators(request, candidate);
      }

      assert.equal(request.taskMode, 'DEEP_AUDIT');
      assert.equal(request.outputSchema.id, TPF02_SYNTHESIS_SCHEMA_ID);
      assert.equal(request.academicInput.validated_source_inventory.length, inputSources.length);
      const candidate = {
        status: 'ok',
        input_state_reference: request.academicInput.input_state_reference,
        review_required: false,
        review_reasons: [],
        audit_scope: { ...request.academicInput.audit_scope },
        topics: [],
        learning_units: [],
        assumed_prerequisites: [],
        source_conflicts: [],
        coverage_gaps: [],
        structure_change_proposals: [],
        unresolved_items: [],
        student_facing_summary_candidate: null,
      };
      return acceptedThroughValidators(request, candidate);
    },
  };
  const makeBaseRequest = ({ capabilityId, course: currentCourse, taskMode, outputSchema, contextSpec, academicInput, provenanceRefs }) => ({
    trigger: { type: 'authenticated_input', ref: `course:${currentCourse.course_id}:${taskMode}`, source: 'test', actor_id: currentCourse.student_id },
    capabilityId,
    stateReference: { aggregate_type: 'teaching_course', aggregate_id: currentCourse.course_id, state_version: String(currentCourse.state_version) },
    preconditions: { lifecycle_state: currentCourse.lifecycle_state },
    provenanceRefs,
    resultContract: { output_schema_id: outputSchema.id, output_schema_version: outputSchema.version, validator_ids: ['schema','domain','provenance'] },
    taskMode,
    directive: {
      bounded_actions: ['analyze supplied D07 data'],
      allowed_operations: ['return schema-valid candidate output'],
      prohibited_operations: ['mutate authoritative state'],
      evidence_purpose: taskMode,
      downstream_handoff: { type: 'validated_candidate', validator_ids: ['schema','domain','provenance'], commit_owner_boundary: 'Curriculum Planner' },
    },
    contextSpec,
    outputSchema,
    academicInput,
    commit: false,
  });
  const runner = createStagedCurriculumAuditRunner({ orchestrator, makeBaseRequest });

  const result = await runner.run({ course: course(), sources: inputSources });

  assert.equal(result.accepted, true);
  assert.equal(result.staged, true);
  assert.equal(result.stageCount, 4);
  assert.equal(result.validatedResult.output.source_inventory.length, inputSources.length);
  assert.deepEqual(
    result.validatedResult.output.source_inventory.map((item) => item.source_item_ref),
    inputSources.map((item) => `source:${item.source_content_item_id}`)
  );
  assert.equal(calls.filter((call) => call.taskMode === 'SOURCE_INVENTORY').length, 3);
  assert.equal(calls.filter((call) => call.taskMode === 'DEEP_AUDIT').length, 1);
});

test('ordinary TPF-02 censuses remain a single direct DEEP_AUDIT execution', async () => {
  const calls = [];
  const orchestrator = {
    async execute(request) {
      calls.push(request);
      return { accepted: false, rejectionReason: 'test-stop' };
    },
  };
  const intelligence = createD07Intelligence({ orchestrator });

  await intelligence.runCurriculumAudit({
    course: course(),
    sources: sources(TPF02_STAGING_SOURCE_THRESHOLD),
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].taskMode, 'DEEP_AUDIT');
  assert.equal(calls[0].outputSchema.id, 'tpf02.curriculum-audit');
});
