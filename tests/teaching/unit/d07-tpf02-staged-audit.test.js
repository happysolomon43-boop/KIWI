'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TPF02_SOURCE_INVENTORY_BATCH_SIZE,
  TPF02_STAGED_SOURCE_COUNT_THRESHOLD,
  TPF02_SERVER_LINEAGE_REPAIR_REASON,
  sourceInventoryRequest,
  curriculumSynthesisRequest,
  lineageRepairRequest,
  shouldStageCurriculumAudit,
  createD07Intelligence,
} = require('../../../teaching/d07/intelligence');
const {
  EXECUTION_STAGES,
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
    duplicate_of_ref: null,
    content_validity_status: 'current_supported',
    content_validity_basis: 'No contradiction identified in this stage.',
    confidence: 'high',
  };
}

function sourceWalk(item) {
  return { source_item_ref: item.source_item_ref, analysis_status: 'complete', note: null };
}

function inventoryStageOutput(request, { unresolved = false } = {}) {
  const input = request.academicInput;
  return {
    input_state_reference: input.input_state_reference,
    task_mode: 'SOURCE_INVENTORY',
    execution_stage: EXECUTION_STAGES.SOURCE_INVENTORY_STAGE,
    audit_scope: { ...input.audit_scope, source_walk: input.source_items.map(sourceWalk) },
    source_inventory: input.source_items.map(inventoryItem),
    topics: [],
    learning_units: [],
    assumed_prerequisites: [],
    source_conflicts: [],
    coverage_gaps: [],
    structure_change_proposals: [],
    source_to_unit_reconciliation: { required_item_map: [], unmapped_required_refs: [] },
    unresolved_items: unresolved ? [{
      unresolved_id: 'UI-stage-1',
      issue: 'A source relationship remains unresolved.',
      source_item_refs: [input.source_items[0].source_item_ref],
      why_unresolved: 'The relationship requires whole-curriculum context.',
      required_next_input_or_review: 'Resolve during DEEP_AUDIT synthesis.',
      blocks_responsible_planning: false,
    }] : [],
    status: unresolved ? 'unresolved' : 'ok',
    review_required: unresolved,
    review_reasons: unresolved ? ['A source needs later whole-artifact review.'] : [],
    student_facing_summary_candidate: null,
  };
}

function synthesisOutput(request) {
  const refs = request.academicInput.audit_scope.source_refs;
  return {
    input_state_reference: request.academicInput.input_state_reference,
    task_mode: 'DEEP_AUDIT',
    execution_stage: EXECUTION_STAGES.WHOLE_CURRICULUM_SYNTHESIS_STAGE,
    audit_scope: { ...request.academicInput.audit_scope, source_walk: [] },
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
      source_item_refs: refs,
      topic_refs: ['topic-1'],
      prerequisite_refs: [],
      dependency_type_notes: 'No in-course prerequisite is required for this first unit.',
      criticality: 'foundational',
      criticality_basis: 'Later mechanics work depends on this unit.',
      proposed_exit_evidence: 'Accurate explanation and independent application.',
      gap_refs: [],
      uncertainties: [],
    }],
    assumed_prerequisites: [],
    source_conflicts: [],
    coverage_gaps: [],
    structure_change_proposals: [],
    source_to_unit_reconciliation: {
      required_item_map: refs.map((ref) => ({ source_item_ref: ref, learning_unit_refs: ['unit-1'] })),
      unmapped_required_refs: [],
    },
    unresolved_items: [],
    status: 'ok',
    review_required: false,
    review_reasons: [],
    student_facing_summary_candidate: 'The course structure is ready for review.',
  };
}

function lineageRepairOutput(request) {
  const refs = request.academicInput.audit_scope.source_refs;
  const existingId = request.academicInput.lineage_repair_context.existing_learning_unit_ids[0];
  return {
    input_state_reference: request.academicInput.input_state_reference,
    task_mode: 'LEARNING_UNIT_DECOMPOSITION',
    execution_stage: EXECUTION_STAGES.WHOLE_CURRICULUM_SYNTHESIS_STAGE,
    audit_scope: { ...request.academicInput.audit_scope, source_walk: [] },
    source_inventory: [],
    topics: [],
    learning_units: [{
      learning_unit_id: existingId,
      title: 'Lineage repair projection',
      intended_competence: 'Attach the missing required source to the already identified competence.',
      source_item_refs: refs,
      topic_refs: [],
      prerequisite_refs: [],
      dependency_type_notes: null,
      criticality: 'supporting',
      criticality_basis: 'Bounded lineage repair only.',
      proposed_exit_evidence: 'Use the existing Learning Unit exit evidence after lineage merge.',
      gap_refs: [],
      uncertainties: [],
    }],
    assumed_prerequisites: [],
    source_conflicts: [],
    coverage_gaps: [],
    structure_change_proposals: [],
    source_to_unit_reconciliation: {
      required_item_map: refs.map((ref) => ({ source_item_ref: ref, learning_unit_refs: [existingId] })),
      unmapped_required_refs: [],
    },
    unresolved_items: [],
    status: 'ok',
    review_required: false,
    review_reasons: [],
    student_facing_summary_candidate: null,
  };
}

test('TPF-02 academic input carries an explicit execution stage as well as task mode', () => {
  const input = buildTpf02AcademicInput({
    course: course(),
    sources: sources(2),
    taskMode: 'SOURCE_INVENTORY',
    executionStage: EXECUTION_STAGES.SOURCE_INVENTORY_STAGE,
  });
  assert.equal(input.task_mode, 'SOURCE_INVENTORY');
  assert.equal(input.execution_stage, EXECUTION_STAGES.SOURCE_INVENTORY_STAGE);
  assert.equal(input.source_items.length, 2);
});

test('large TPF-02 audits stage before the monolithic output-risk range', () => {
  assert.equal(TPF02_STAGED_SOURCE_COUNT_THRESHOLD, 48);
  assert.equal(shouldStageCurriculumAudit({ course: course(), sources: sources(49) }), true);
  assert.equal(TPF02_SOURCE_INVENTORY_BATCH_SIZE, 24);
});

test('SOURCE_INVENTORY_STAGE validates a complete batch without prematurely requiring Learning Units', async () => {
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

test('staged TPF-02 exhaustively inventories a large course and validates complete required-source lineage after synthesis', async () => {
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
      assert.equal(request.academicInput.execution_stage, EXECUTION_STAGES.WHOLE_CURRICULUM_SYNTHESIS_STAGE);
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
  assert.equal(output.audit_scope.source_walk.length, 50);
  assert.equal(new Set(output.source_inventory.map((item) => item.source_item_ref)).size, 50);
  assert.equal(output.source_to_unit_reconciliation.required_item_map.length, 50);
  assert.deepEqual(output.source_to_unit_reconciliation.unmapped_required_refs, []);
  assert.equal(output.status, 'unresolved');
  assert.equal(output.review_required, true);
  assert.equal(output.student_facing_summary_candidate, null);
  assert.ok(output.review_reasons.includes('A source needs later whole-artifact review.'));
  assert.equal(output.unresolved_items.length, 1);

  const fullInput = buildTpf02AcademicInput({
    course: course(),
    sources: allSources,
    taskMode: 'DEEP_AUDIT',
    executionStage: EXECUTION_STAGES.WHOLE_CURRICULUM_SYNTHESIS_STAGE,
  });
  const finalValidation = validateTpf02Domain(output, {
    inputStateReference: fullInput.input_state_reference,
    trustedScopeVersion: fullInput.audit_scope.trusted_scope_version,
    sourceItems: fullInput.source_items,
    taskMode: fullInput.task_mode,
    executionStage: fullInput.execution_stage,
  });
  assert.equal(finalValidation.ok, true, finalValidation.reason);
});

test('staged synthesis canonically excludes non-instructional source classes from Learning Units without weakening required lineage', async () => {
  const allSources = sources(49);
  const fullInput = buildTpf02AcademicInput({
    course: course(),
    sources: allSources,
    taskMode: 'DEEP_AUDIT',
    executionStage: EXECUTION_STAGES.WHOLE_CURRICULUM_SYNTHESIS_STAGE,
  });
  const preparedInventory = fullInput.source_items.map(inventoryItem);
  const excludedRef = preparedInventory.at(-1).source_item_ref;
  preparedInventory[preparedInventory.length - 1] = {
    ...preparedInventory.at(-1),
    proposed_scope_classification: 'duplicate',
    scope_classification_basis: 'Duplicates the first canonical source.',
    duplicate_of_ref: preparedInventory[0].source_item_ref,
  };
  const preparedSourceWalk = fullInput.source_items.map(sourceWalk);
  const request = curriculumSynthesisRequest({
    course: course(),
    sources: allSources,
    preparedInventory,
    preparedSourceWalk,
    stageFindings: { status: 'ok', review_required: false, review_reasons: [], unresolved_items: [] },
  });

  assert.equal(request.academicInput.eligible_learning_unit_source_refs.length, 48);
  assert.equal(request.academicInput.eligible_learning_unit_source_refs.includes(excludedRef), false);

  const output = synthesisOutput(request);
  assert.equal(output.learning_units[0].source_item_refs.includes(excludedRef), true);

  const result = await request.domainValidator(output);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.value.learning_units[0].source_item_refs.includes(excludedRef), false);
  assert.equal(result.value.source_to_unit_reconciliation.required_item_map.length, 48);
  assert.equal(
    result.value.source_to_unit_reconciliation.required_item_map.some((row) => row.source_item_ref === excludedRef),
    false
  );
  assert.deepEqual(result.value.source_to_unit_reconciliation.unmapped_required_refs, []);
});

test('staged synthesis still fails closed when source-scope canonicalization leaves a Learning Unit without eligible evidence', async () => {
  const allSources = sources(49);
  const fullInput = buildTpf02AcademicInput({
    course: course(),
    sources: allSources,
    taskMode: 'DEEP_AUDIT',
    executionStage: EXECUTION_STAGES.WHOLE_CURRICULUM_SYNTHESIS_STAGE,
  });
  const preparedInventory = fullInput.source_items.map(inventoryItem);
  const excludedRef = preparedInventory.at(-1).source_item_ref;
  preparedInventory[preparedInventory.length - 1] = {
    ...preparedInventory.at(-1),
    proposed_scope_classification: 'non_instructional',
    scope_classification_basis: 'Administrative material only.',
    duplicate_of_ref: null,
    content_validity_status: 'not_applicable',
  };
  const request = curriculumSynthesisRequest({
    course: course(),
    sources: allSources,
    preparedInventory,
    preparedSourceWalk: fullInput.source_items.map(sourceWalk),
    stageFindings: { status: 'ok', review_required: false, review_reasons: [], unresolved_items: [] },
  });
  const output = synthesisOutput(request);
  output.learning_units.push({
    learning_unit_id: 'unit-excluded-only',
    title: 'Invalid excluded-only unit',
    intended_competence: 'This should never become an accepted Learning Unit.',
    source_item_refs: [excludedRef],
    topic_refs: ['topic-1'],
    prerequisite_refs: [],
    dependency_type_notes: null,
    criticality: 'supporting',
    criticality_basis: 'Regression fixture.',
    proposed_exit_evidence: 'None.',
    gap_refs: [],
    uncertainties: [],
  });

  const result = await request.domainValidator(output);
  assert.equal(result.reason, 'TPF02_LEARNING_UNIT_INVALID:1');
});

test('staged synthesis converts accidental required-lineage omission into a bounded server repair state instead of weakening the invariant', async () => {
  const allSources = sources(49);
  const fullInput = buildTpf02AcademicInput({
    course: course(),
    sources: allSources,
    taskMode: 'DEEP_AUDIT',
    executionStage: EXECUTION_STAGES.WHOLE_CURRICULUM_SYNTHESIS_STAGE,
  });
  const preparedInventory = fullInput.source_items.map(inventoryItem);
  const preparedSourceWalk = fullInput.source_items.map(sourceWalk);
  const request = curriculumSynthesisRequest({
    course: course(),
    sources: allSources,
    preparedInventory,
    preparedSourceWalk,
    stageFindings: { status: 'ok', review_required: false, review_reasons: [], unresolved_items: [] },
  });
  const output = synthesisOutput(request);
  const missing = fullInput.audit_scope.source_refs.at(-1);
  output.learning_units[0] = { ...output.learning_units[0], source_item_refs: output.learning_units[0].source_item_refs.slice(0, -1) };
  output.source_to_unit_reconciliation.required_item_map = output.source_to_unit_reconciliation.required_item_map.map((row) => row.source_item_ref === missing ? { ...row, learning_unit_refs: [] } : row);
  output.source_to_unit_reconciliation.unmapped_required_refs = [missing];

  const result = await request.domainValidator(output);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.value.status, 'unresolved');
  assert.equal(result.value.review_required, true);
  assert.ok(result.value.review_reasons.includes(TPF02_SERVER_LINEAGE_REPAIR_REASON));
  assert.deepEqual(result.value.source_to_unit_reconciliation.unmapped_required_refs, [missing]);
  assert.equal(
    result.value.unresolved_items.some((item) => item.blocks_responsible_planning && item.source_item_refs.includes(missing)),
    true
  );
});

test('bounded LEARNING_UNIT_DECOMPOSITION repair closes missing required lineage and preserves the original Learning Unit metadata', async () => {
  const allSources = sources(49);
  const calls = [];

  const orchestrator = {
    async execute(request) {
      calls.push(request);
      if (request.taskMode === 'SOURCE_INVENTORY') {
        const output = inventoryStageOutput(request);
        const domain = await request.domainValidator(output);
        assert.equal(domain.ok, true, domain.reason);
        const provenance = await request.provenanceValidator(domain.value);
        assert.equal(provenance.ok, true, provenance.reason);
        return { accepted: true, validatedResult: { output: domain.value } };
      }

      if (request.taskMode === 'DEEP_AUDIT') {
        const output = synthesisOutput(request);
        const missing = request.academicInput.audit_scope.source_refs.at(-1);
        output.learning_units[0] = {
          ...output.learning_units[0],
          source_item_refs: output.learning_units[0].source_item_refs.filter((ref) => ref !== missing),
        };
        output.source_to_unit_reconciliation.required_item_map = output.source_to_unit_reconciliation.required_item_map.map((row) =>
          row.source_item_ref === missing ? { ...row, learning_unit_refs: [] } : row
        );
        output.source_to_unit_reconciliation.unmapped_required_refs = [missing];
        const domain = await request.domainValidator(output);
        assert.equal(domain.ok, true, domain.reason);
        const provenance = await request.provenanceValidator(domain.value);
        assert.equal(provenance.ok, true, provenance.reason);
        return { accepted: true, validatedResult: { output: domain.value } };
      }

      assert.equal(request.taskMode, 'LEARNING_UNIT_DECOMPOSITION');
      assert.equal(request.capabilityId, 'teaching.curriculum.learning_unit_decomposition');
      assert.equal(request.academicInput.lineage_repair_context.reason, TPF02_SERVER_LINEAGE_REPAIR_REASON);
      assert.equal(request.academicInput.source_evidence_items.length, 1);
      const output = lineageRepairOutput(request);
      const domain = await request.domainValidator(output);
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

  assert.equal(result.accepted, true);
  assert.equal(result.lineageRepair.repaired_source_count, 1);
  assert.equal(result.lineageRepair.repair_batch_count, 1);

  const repairCalls = calls.filter((request) => request.taskMode === 'LEARNING_UNIT_DECOMPOSITION');
  assert.equal(repairCalls.length, 1);

  const final = result.validatedResult.output;
  const missing = final.audit_scope.source_refs.at(-1);
  assert.deepEqual(final.source_to_unit_reconciliation.unmapped_required_refs, []);
  assert.equal(final.learning_units[0].source_item_refs.includes(missing), true);
  assert.equal(final.learning_units[0].title, 'Foundations of mechanics');
  assert.equal(final.learning_units[0].intended_competence, 'Explain and apply the central mechanics relationships.');
  assert.equal(final.review_reasons.includes(TPF02_SERVER_LINEAGE_REPAIR_REASON), false);

  const fullInput = buildTpf02AcademicInput({
    course: course(),
    sources: allSources,
    taskMode: 'DEEP_AUDIT',
    executionStage: EXECUTION_STAGES.WHOLE_CURRICULUM_SYNTHESIS_STAGE,
  });
  const validation = validateTpf02Domain(final, {
    inputStateReference: fullInput.input_state_reference,
    trustedScopeVersion: fullInput.audit_scope.trusted_scope_version,
    sourceItems: fullInput.source_items,
    taskMode: fullInput.task_mode,
    executionStage: fullInput.execution_stage,
  });
  assert.equal(validation.ok, true, validation.reason);
});

test('lineage repair request is fail-closed if it tries to redesign unrelated curriculum structure', async () => {
  const allSources = sources(1);
  const fullInput = buildTpf02AcademicInput({
    course: course(),
    sources: allSources,
    taskMode: 'LEARNING_UNIT_DECOMPOSITION',
    executionStage: EXECUTION_STAGES.WHOLE_CURRICULUM_SYNTHESIS_STAGE,
  });
  const preparedInventory = fullInput.source_items.map(inventoryItem);
  const existingArtifact = {
    learning_units: [{
      learning_unit_id: 'unit-1',
      title: 'Existing unit',
      intended_competence: 'Existing competence',
      source_item_refs: [],
      topic_refs: [],
      criticality: 'foundational',
    }],
  };
  const request = lineageRepairRequest({
    course: course(),
    sources: allSources,
    preparedInventory,
    preparedSourceWalk: fullInput.source_items.map(sourceWalk),
    existingArtifact,
    batchIndex: 0,
  });
  const output = lineageRepairOutput(request);
  output.topics = [{ topic_id: 'unexpected-topic', title: 'Unexpected', source_item_refs: [], subtopics: [] }];
  const result = await request.domainValidator(output);
  assert.equal(result.reason, 'TPF02_LINEAGE_REPAIR_SCOPE_EXCEEDED');
});

test('staged synthesis rejects any attempt by the model to replace prepared source accounting', async () => {
  const allSources = sources(49);
  const fullInput = buildTpf02AcademicInput({
    course: course(),
    sources: allSources,
    taskMode: 'DEEP_AUDIT',
    executionStage: EXECUTION_STAGES.WHOLE_CURRICULUM_SYNTHESIS_STAGE,
  });
  const preparedInventory = fullInput.source_items.map(inventoryItem);
  const preparedSourceWalk = fullInput.source_items.map(sourceWalk);
  const request = curriculumSynthesisRequest({
    course: course(),
    sources: allSources,
    preparedInventory,
    preparedSourceWalk,
    stageFindings: { status: 'ok', review_required: false, review_reasons: [], unresolved_items: [] },
  });
  const output = synthesisOutput(request);
  output.source_inventory = [preparedInventory[0]];
  const result = await request.domainValidator(output);
  assert.equal(result.reason, 'TPF02_STAGED_SYNTHESIS_MUST_DEFER_SOURCE_INVENTORY');
});
