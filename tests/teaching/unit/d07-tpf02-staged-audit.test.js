'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TPF02_SOURCE_INVENTORY_BATCH_SIZE,
  TPF02_STAGED_SOURCE_COUNT_THRESHOLD,
  sourceInventoryRequest,
  curriculumSynthesisRequest,
  shouldStageCurriculumAudit,
  createD07Intelligence,
} = require('../../../teaching/d07/intelligence');
const {
  buildTpf02AcademicInput,
  validateTpf02Domain,
} = require('../../../teaching/d07/tpf02-direct');

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

function sources(count) {
  return Array.from({ length: count }, (_, index) => ({
    source_content_item_id: `source-${index + 1}`,
    source_kind: index % 5 === 0 ? 'PRIMARY_STUDY_NOTE' : 'KIWI_SUBJECT_FLASHCARDS',
    source_ref: `ref-${index + 1}`,
    source_version_ref: 'v1',
    locator: { index: index + 1 },
    content_hash: `hash-${index + 1}`,
    content_summary: `Academic source ${index + 1}: concise content for staged curriculum analysis.`,
  }));
}

function inventoryItem(item) {
  return {
    source_item_ref: item.source_item_ref,
    provenance: `provenance:${item.source_item_ref}`,
    academic_meaning: `Meaning of ${item.source_item_ref}`,
    proposed_scope_classification: 'required',
    scope_classification_basis: 'Directly supports the course.',
    content_validity_status: 'current_supported',
    content_validity_basis: 'No contradiction identified in this stage.',
    confidence: 'high',
  };
}

function inventoryStageOutput(request, { unresolved = false } = {}) {
  const input = request.academicInput;
  return {
    status: unresolved ? 'unresolved' : 'ok',
    input_state_reference: input.input_state_reference,
    review_required: unresolved,
    review_reasons: unresolved ? ['A source needs later whole-artifact review.'] : [],
    audit_scope: input.audit_scope,
    source_inventory: input.source_items.map(inventoryItem),
    topics: [],
    learning_units: [],
    assumed_prerequisites: [],
    source_conflicts: [],
    coverage_gaps: [],
    structure_change_proposals: [],
    unresolved_items: unresolved ? [{
      issue: 'A source relationship remains unresolved.',
      why_unresolved: 'The relationship requires whole-curriculum context.',
      required_next_input_or_review: 'Resolve during DEEP_AUDIT synthesis.',
      blocks_responsible_planning: false,
    }] : [],
    student_facing_summary_candidate: null,
  };
}

function synthesisOutput(request) {
  const refs = request.academicInput.audit_scope.source_refs;
  return {
    status: 'ok',
    input_state_reference: request.academicInput.input_state_reference,
    review_required: false,
    review_reasons: [],
    audit_scope: request.academicInput.audit_scope,
    source_inventory: [],
    topics: [{
      topic_id: 'topic-1',
      title: 'Mechanics',
      source_item_refs: refs.slice(0, 3),
      subtopics: [],
    }],
    learning_units: [{
      learning_unit_id: 'unit-1',
      title: 'Foundations of mechanics',
      intended_competence: 'Explain and apply the central mechanics relationships.',
      source_item_refs: refs.slice(0, 3),
      topic_refs: ['topic-1'],
      prerequisite_refs: [],
      dependency_type_notes: 'No in-course prerequisite is required for this first unit.',
      criticality: 'foundational',
      criticality_basis: 'Later mechanics work depends on this unit.',
      proposed_exit_evidence: 'Accurate explanation and independent application.',
      uncertainties: [],
    }],
    assumed_prerequisites: [],
    source_conflicts: [],
    coverage_gaps: [],
    structure_change_proposals: [],
    unresolved_items: [],
    student_facing_summary_candidate: 'The course structure is ready for review.',
  };
}

test('TPF-02 academic input preserves the frozen family task mode supplied by D07', () => {
  const input = buildTpf02AcademicInput({
    course: course(),
    sources: sources(2),
    taskMode: 'SOURCE_INVENTORY',
  });
  assert.equal(input.task_mode, 'SOURCE_INVENTORY');
  assert.equal(input.source_items.length, 2);
});

test('large TPF-02 audits stage before the monolithic output-risk range', () => {
  assert.equal(TPF02_STAGED_SOURCE_COUNT_THRESHOLD, 48);
  assert.equal(shouldStageCurriculumAudit({ course: course(), sources: sources(49) }), true);
  assert.equal(TPF02_SOURCE_INVENTORY_BATCH_SIZE, 24);
});

test('SOURCE_INVENTORY requests validate a complete batch and forbid premature whole-curriculum synthesis', async () => {
  const request = sourceInventoryRequest({ course: course(), sources: sources(3) });
  const output = inventoryStageOutput(request);
  assert.equal((await request.domainValidator(output)).ok, true);
  assert.equal((await request.provenanceValidator(output)).ok, true);

  const invalid = { ...output, topics: [{
    topic_id: 'topic-1',
    title: 'Premature topic',
    source_item_refs: [output.source_inventory[0].source_item_ref],
    subtopics: [],
  }] };
  assert.equal((await request.domainValidator(invalid)).reason, 'TPF02_SOURCE_INVENTORY_STAGE_SCOPE_EXCEEDED');
});

test('staged TPF-02 exhaustively inventories large courses, then synthesizes one canonically validated artifact', async () => {
  const allSources = sources(50);
  const calls = [];
  let inventoryCallIndex = 0;

  const orchestrator = {
    async execute(request) {
      calls.push(request);
      if (request.taskMode === 'SOURCE_INVENTORY') {
        const output = inventoryStageOutput(request, { unresolved: inventoryCallIndex++ === 0 });
        const domain = await request.domainValidator(output);
        assert.equal(domain.ok, true, domain.reason);
        const provenance = await request.provenanceValidator(domain.value);
        assert.equal(provenance.ok, true, provenance.reason);
        return { accepted: true, validatedResult: { output: domain.value } };
      }

      assert.equal(request.taskMode, 'DEEP_AUDIT');
      assert.equal(request.academicInput.source_items.length, 0);
      assert.equal(request.academicInput.source_evidence_items.length, 50);
      assert.equal(request.academicInput.prepared_source_inventory.length, 50);

      const domain = await request.domainValidator(synthesisOutput(request));
      assert.equal(domain.ok, true, domain.reason);
      const provenance = await request.provenanceValidator(domain.value);
      assert.equal(provenance.ok, true, provenance.reason);
      return { accepted: true, validatedResult: { output: domain.value } };
    },
  };

  const result = await createD07Intelligence({ orchestrator }).runCurriculumAudit({
    course: course(),
    sources: allSources,
  });

  const inventoryCalls = calls.filter((request) => request.taskMode === 'SOURCE_INVENTORY');
  assert.equal(inventoryCalls.length, 3);
  assert.deepEqual(inventoryCalls.map((request) => request.academicInput.source_items.length), [24, 24, 2]);
  assert.equal(calls.at(-1).taskMode, 'DEEP_AUDIT');

  const output = result.validatedResult.output;
  assert.equal(output.source_inventory.length, 50);
  assert.equal(new Set(output.source_inventory.map((item) => item.source_item_ref)).size, 50);
  assert.equal(output.status, 'unresolved');
  assert.equal(output.review_required, true);
  assert.ok(output.review_reasons.includes('A source needs later whole-artifact review.'));
  assert.equal(output.unresolved_items.length, 1);

  const fullInput = buildTpf02AcademicInput({ course: course(), sources: allSources });
  const finalValidation = validateTpf02Domain(output, {
    inputStateReference: fullInput.input_state_reference,
    trustedScopeVersion: fullInput.audit_scope.trusted_scope_version,
    sourceItems: fullInput.source_items,
  });
  assert.equal(finalValidation.ok, true, finalValidation.reason);
});

test('staged synthesis rejects any attempt by the model to replace prepared source accounting', async () => {
  const allSources = sources(49);
  const fullInput = buildTpf02AcademicInput({ course: course(), sources: allSources });
  const preparedInventory = fullInput.source_items.map(inventoryItem);
  const request = curriculumSynthesisRequest({
    course: course(),
    sources: allSources,
    preparedInventory,
    stageFindings: {
      status: 'ok',
      review_required: false,
      review_reasons: [],
      unresolved_items: [],
    },
  });
  const output = synthesisOutput(request);
  output.source_inventory = [preparedInventory[0]];
  const result = await request.domainValidator(output);
  assert.equal(result.reason, 'TPF02_STAGED_SYNTHESIS_MUST_DEFER_SOURCE_INVENTORY');
});
