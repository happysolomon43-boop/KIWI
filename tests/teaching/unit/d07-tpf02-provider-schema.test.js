'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  curriculumAuditRequest,
  sourceInventoryRequest,
  lineageRepairRequest,
} = require('../../../teaching/d07/intelligence');
const {
  TPF02_OUTPUT_SCHEMA_ID,
  TPF02_TOP_LEVEL_FIELDS,
  TPF02_DECOMPOSITION_PATCH_FIELDS,
} = require('../../../teaching/d07/tpf02-direct');
const {
  TPF02_CURRICULUM_AUDIT_RESPONSE_SCHEMA,
  TPF02_DECOMPOSITION_PATCH_RESPONSE_SCHEMA,
} = require('../../../teaching/d07/tpf02-provider-schema');
const { createExecutionRequest } = require('../../../services/ai/execution-contracts');
const { serializeGoogleExecutionRequest } = require('../../../services/ai/google-provider-adapter');

function course() {
  return {
    course_id: 'course-1',
    student_id: 'student-1',
    subject_id: 'subject-1',
    title: 'Physics',
    lifecycle_state: 'DRAFT',
    state_version: 2,
    subject_snapshot_ref: 'subject:subject-1:snapshot-2',
  };
}

function source() {
  return {
    source_content_item_id: 'source-1',
    source_kind: 'PRIMARY_STUDY_NOTE',
    source_ref: 'ref-1',
    source_version_ref: 'v1',
    locator: { page: 1 },
    content_hash: 'hash-1',
    content_summary: 'A bounded mechanics source used by the response-contract regression.',
  };
}

function preparedInventory() {
  return [{
    source_item_ref: 'source:source-1',
    provenance: 'fixture',
    academic_meaning: 'Mechanics evidence',
    proposed_scope_classification: 'required',
    scope_classification_basis: 'The source is in approved Course scope.',
    duplicate_of_ref: null,
    content_validity_status: 'current_supported',
    content_validity_basis: null,
    confidence: 'high',
  }];
}

test('TPF-02 provider schema requires the exact canonical top-level contract', () => {
  assert.deepEqual(
    [...TPF02_CURRICULUM_AUDIT_RESPONSE_SCHEMA.required].sort(),
    [...TPF02_TOP_LEVEL_FIELDS].sort()
  );
  assert.deepEqual(
    [...TPF02_CURRICULUM_AUDIT_RESPONSE_SCHEMA.propertyOrdering],
    [...TPF02_TOP_LEVEL_FIELDS]
  );
  for (const field of TPF02_TOP_LEVEL_FIELDS) {
    assert.ok(TPF02_CURRICULUM_AUDIT_RESPONSE_SCHEMA.properties[field], field);
  }
});

test('TPF-02 full audit requests send the canonical schema to structured generation', () => {
  const audit = curriculumAuditRequest({ course: course(), sources: [source()] });
  const inventory = sourceInventoryRequest({ course: course(), sources: [source()] });

  assert.equal(audit.generation.structuredOutput.mimeType, 'application/json');
  assert.equal(audit.generation.structuredOutput.schema, TPF02_CURRICULUM_AUDIT_RESPONSE_SCHEMA);
  assert.equal(inventory.generation.structuredOutput.schema, TPF02_CURRICULUM_AUDIT_RESPONSE_SCHEMA);
});

test('Google adapter receives TPF-02 responseSchema instead of JSON MIME type alone', () => {
  const request = createExecutionRequest({
    provider: 'GOOGLE',
    modelId: 'gemini-3.5-flash-lite',
    taskId: 'MAIN_CBT',
    content: 'Return the requested TPF-02 artifact.',
    generation: {
      maxOutputTokens: 64_000,
      structuredOutput: {
        mimeType: 'application/json',
        schema: TPF02_CURRICULUM_AUDIT_RESPONSE_SCHEMA,
      },
    },
  });
  const serialized = serializeGoogleExecutionRequest(request);

  assert.equal(serialized.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(serialized.generationConfig.responseSchema, TPF02_CURRICULUM_AUDIT_RESPONSE_SCHEMA);
  assert.deepEqual(
    serialized.generationConfig.responseSchema.required,
    TPF02_CURRICULUM_AUDIT_RESPONSE_SCHEMA.required
  );
  assert.equal(Object.hasOwn(serialized.generationConfig, 'structuredOutput'), false);
});

test('lineage repair declares and generates the full TPF-02 artifact contract', () => {
  const request = lineageRepairRequest({
    course: course(),
    sources: [source()],
    baseOutput: {
      topics: [],
      learning_units: [],
      assumed_prerequisites: [],
      coverage_gaps: [],
    },
    preparedInventory: preparedInventory(),
    preparedSourceWalk: [],
    stageFindings: {
      status: 'ok',
      review_required: false,
      review_reasons: [],
      unresolved_items: [],
    },
    repairRefs: ['source:source-1'],
  });

  assert.equal(request.outputSchema.id, TPF02_OUTPUT_SCHEMA_ID);
  assert.deepEqual(request.outputSchema.declared_fields, [...TPF02_TOP_LEVEL_FIELDS]);
  assert.equal(request.generation.structuredOutput.schema, TPF02_CURRICULUM_AUDIT_RESPONSE_SCHEMA);
});

test('TPF-02 decomposition provider schema mirrors the dedicated patch contract', () => {
  assert.deepEqual(
    [...TPF02_DECOMPOSITION_PATCH_RESPONSE_SCHEMA.required].sort(),
    [...TPF02_DECOMPOSITION_PATCH_FIELDS].sort()
  );
  assert.deepEqual(
    [...TPF02_DECOMPOSITION_PATCH_RESPONSE_SCHEMA.propertyOrdering],
    [...TPF02_DECOMPOSITION_PATCH_FIELDS]
  );

  const unit = TPF02_DECOMPOSITION_PATCH_RESPONSE_SCHEMA.properties.resulting_units.items;
  assert.deepEqual(
    [...unit.required].sort(),
    [
      'learning_unit_id','title','intended_competence','source_item_refs','prerequisite_refs',
      'dependency_type_notes','criticality','criticality_basis','proposed_exit_evidence','uncertainties',
    ].sort()
  );
  assert.equal(Object.hasOwn(unit.properties, 'topic_refs'), false);
  assert.equal(Object.hasOwn(unit.properties, 'subtopic_id'), false);
  assert.equal(Object.hasOwn(unit.properties, 'gap_refs'), false);
});
