'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TPF02_SOURCE_INVENTORY_BATCH_SIZE,
  TPF02_STAGED_SOURCE_COUNT_THRESHOLD,
  TPF02_PROGRESSIVE_STRUCTURE_SOURCE_COUNT_THRESHOLD,
  TPF02_STRUCTURE_BATCH_SIZE,
  sourceInventoryRequest,
  curriculumSynthesisRequest,
  shouldStageCurriculumAudit,
  shouldUseProgressiveStructure,
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

function lineageRepairOutput(request, unitId = 'unit-lineage-repair') {
  const refs = request.academicInput.audit_scope.source_refs;
  const topic = request.academicInput.lineage_repair_context.existing_topics[0];
  const subtopic = topic?.subtopics?.[0] || null;
  return {
    input_state_reference: request.academicInput.input_state_reference,
    task_mode: 'LEARNING_UNIT_DECOMPOSITION',
    execution_stage: EXECUTION_STAGES.SINGLE_PASS,
    audit_scope: { ...request.academicInput.audit_scope, source_walk: [] },
    source_inventory: [],
    topics: [],
    learning_units: [{
      learning_unit_id: unitId,
      title: 'Resolve the previously unmapped required capability',
      intended_competence: 'Explain and apply the academic requirement carried by the previously unmapped source.',
      source_item_refs: refs,
      topic_refs: topic ? [topic.topic_id] : [],
      subtopic_id: subtopic ? subtopic.subtopic_id : null,
      prerequisite_refs: [],
      dependency_type_notes: null,
      criticality: 'major',
      criticality_basis: 'The required source needs its own competence boundary rather than a catch-all attachment.',
      proposed_exit_evidence: 'Independently explain and apply the requirement represented by the repaired source.',
      gap_refs: [],
      uncertainties: [],
    }],
    assumed_prerequisites: [],
    source_conflicts: [],
    coverage_gaps: [],
    structure_change_proposals: [],
    source_to_unit_reconciliation: {
      required_item_map: refs.map((ref) => ({ source_item_ref: ref, learning_unit_refs: [unitId] })),
      unmapped_required_refs: [],
    },
    unresolved_items: [],
    status: 'ok',
    review_required: false,
    review_reasons: [],
    student_facing_summary_candidate: null,
  };
}

function structurePassOutput(request) {
  const refs = request.academicInput.source_items.map((item) => item.source_item_ref);
  const batchIndex = Number(request.academicInput.structure_pass_context?.batch_index || 0);
  const topicId = `batch-topic-${batchIndex}`;
  const groups = [];
  for (let index = 0; index < refs.length; index += 12) groups.push(refs.slice(index, index + 12));
  const subtopics = groups.map((_, index) => ({
    subtopic_id: `batch-subtopic-${batchIndex}-${index + 1}`,
    title: `Bounded capability area ${index + 1}`,
  }));
  return {
    input_state_reference: request.academicInput.input_state_reference,
    task_mode: 'LEARNING_UNIT_DECOMPOSITION',
    execution_stage: EXECUTION_STAGES.SINGLE_PASS,
    audit_scope: { ...request.academicInput.audit_scope, source_walk: [] },
    source_inventory: [],
    topics: [{
      topic_id: topicId,
      title: `Bounded structure batch ${batchIndex + 1}`,
      source_item_refs: refs,
      subtopics,
    }],
    learning_units: groups.map((sourceRefs, index) => ({
      learning_unit_id: `batch-unit-${batchIndex}-${index + 1}`,
      title: `Apply bounded capability ${index + 1}`,
      intended_competence: `Explain and apply the coherent capability represented by bounded evidence group ${index + 1}.`,
      source_item_refs: sourceRefs,
      topic_refs: [topicId],
      subtopic_id: subtopics[index].subtopic_id,
      prerequisite_refs: [],
      dependency_type_notes: null,
      criticality: 'major',
      criticality_basis: 'This bounded evidence group contributes required Course content.',
      proposed_exit_evidence: 'Independently explain and apply this bounded capability.',
      gap_refs: [],
      uncertainties: [],
    })),
    assumed_prerequisites: [],
    source_conflicts: [],
    coverage_gaps: [],
    structure_change_proposals: [],
    source_to_unit_reconciliation: { required_item_map: [], unmapped_required_refs: [] },
    unresolved_items: [],
    status: 'ok',
    review_required: false,
    review_reasons: [],
    student_facing_summary_candidate: null,
  };
}
function coarseSynthesisOutput(request) {
  const refs = request.academicInput.audit_scope.source_refs;
  return {
    input_state_reference: request.academicInput.input_state_reference,
    task_mode: 'DEEP_AUDIT',
    execution_stage: EXECUTION_STAGES.WHOLE_CURRICULUM_SYNTHESIS_STAGE,
    audit_scope: { ...request.academicInput.audit_scope, source_walk: [] },
    source_inventory: [],
    topics: [{
      topic_id: 'topic-coarse',
      title: 'Mechanics',
      source_item_refs: refs,
      subtopics: [{ subtopic_id: 'subtopic-coarse', title: 'Mechanics foundations' }],
    }],
    learning_units: [{
      learning_unit_id: 'unit-coarse',
      title: 'Apply mechanics foundations',
      intended_competence: 'Apply the complete mechanics foundation represented by the Course sources.',
      source_item_refs: refs,
      topic_refs: ['topic-coarse'],
      subtopic_id: 'subtopic-coarse',
      prerequisite_refs: [],
      dependency_type_notes: null,
      criticality: 'foundational',
      criticality_basis: 'The broad fixture intentionally reproduces the under-decomposition regression.',
      proposed_exit_evidence: 'Solve one broad mechanics task.',
      gap_refs: [],
      uncertainties: [],
    }],
    assumed_prerequisites: [],
    source_conflicts: [],
    coverage_gaps: [],
    structure_change_proposals: [],
    source_to_unit_reconciliation: {
      required_item_map: refs.map((ref) => ({ source_item_ref: ref, learning_unit_refs: ['unit-coarse'] })),
      unmapped_required_refs: [],
    },
    unresolved_items: [],
    status: 'ok',
    review_required: false,
    review_reasons: [],
    student_facing_summary_candidate: 'A deliberately coarse regression fixture.',
  };
}

function decompositionRepairOutput(request) {
  const repaired = synthesisOutput({ academicInput: {
    ...request.academicInput,
    audit_scope: request.academicInput.audit_scope,
  } });
  return {
    ...repaired,
    task_mode: 'SPLIT_UNIT',
    execution_stage: EXECUTION_STAGES.SINGLE_PASS,
    audit_scope: { ...request.academicInput.audit_scope, source_walk: [] },
    source_inventory: [],
    assumed_prerequisites: [],
    source_conflicts: [],
    coverage_gaps: [],
    structure_change_proposals: [],
    source_to_unit_reconciliation: { required_item_map: [], unmapped_required_refs: [] },
    unresolved_items: [],
    status: 'ok',
    review_required: false,
    review_reasons: [],
    student_facing_summary_candidate: null,
  };
}

function synthesisOutput(request) {
  const refs = request.academicInput.audit_scope.source_refs;
  const groups = [];
  for (let index = 0; index < refs.length; index += 12) groups.push(refs.slice(index, index + 12));
  const subtopics = groups.map((_, index) => ({
    subtopic_id: `subtopic-${index + 1}`,
    title: `Mechanics capability area ${index + 1}`,
  }));
  const learningUnits = groups.map((sourceRefs, index) => ({
    learning_unit_id: `unit-${index + 1}`,
    title: `Apply mechanics capability ${index + 1}`,
    intended_competence: `Explain and apply the coherent mechanics capability represented by evidence group ${index + 1}.`,
    source_item_refs: sourceRefs,
    topic_refs: ['topic-1'],
    subtopic_id: subtopics[index].subtopic_id,
    prerequisite_refs: [],
    dependency_type_notes: index === 0 ? 'No in-course prerequisite is required for this first unit.' : null,
    criticality: index === 0 ? 'foundational' : 'major',
    criticality_basis: 'The capability contributes required mechanics content.',
    proposed_exit_evidence: 'Independently explain and apply the capability to a representative problem.',
    gap_refs: [],
    uncertainties: [],
  }));
  const unitBySource = new Map();
  for (const unit of learningUnits) for (const ref of unit.source_item_refs) unitBySource.set(ref, unit.learning_unit_id);
  return {
    input_state_reference: request.academicInput.input_state_reference,
    task_mode: 'DEEP_AUDIT',
    execution_stage: EXECUTION_STAGES.WHOLE_CURRICULUM_SYNTHESIS_STAGE,
    audit_scope: { ...request.academicInput.audit_scope, source_walk: [] },
    source_inventory: [],
    topics: [{
      topic_id: 'topic-1',
      title: 'Mechanics',
      source_item_refs: refs,
      subtopics,
    }],
    learning_units: learningUnits,
    assumed_prerequisites: [],
    source_conflicts: [],
    coverage_gaps: [],
    structure_change_proposals: [],
    source_to_unit_reconciliation: {
      required_item_map: refs.map((ref) => ({ source_item_ref: ref, learning_unit_refs: [unitBySource.get(ref)] })),
      unmapped_required_refs: [],
    },
    unresolved_items: [],
    status: 'ok',
    review_required: false,
    review_reasons: [],
    student_facing_summary_candidate: 'The course structure is ready for review.',
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

test('very large TPF-02 audits add bounded curriculum-structure preparation before whole-course synthesis', () => {
  assert.equal(TPF02_PROGRESSIVE_STRUCTURE_SOURCE_COUNT_THRESHOLD, 120);
  assert.equal(shouldUseProgressiveStructure({ sources: sources(120) }), false);
  assert.equal(shouldUseProgressiveStructure({ sources: sources(121) }), true);
  assert.equal(TPF02_STRUCTURE_BATCH_SIZE, 24);
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
  assert.equal(output.learning_units.some((unit) => unit.source_item_refs.includes(excludedRef)), true);

  const result = await request.domainValidator(output);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.value.learning_units.some((unit) => unit.source_item_refs.includes(excludedRef)), false);
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
    subtopic_id: output.topics[0].subtopics[0].subtopic_id,
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

test('staged synthesis turns an omitted required source into an explicit blocking provisional artifact for bounded repair', async () => {
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
  const missingUnit = output.learning_units.find((unit) => unit.source_item_refs.includes(missing));
  missingUnit.source_item_refs = missingUnit.source_item_refs.filter((ref) => ref !== missing);

  const result = await request.domainValidator(output);
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(result.value.source_to_unit_reconciliation.unmapped_required_refs, [missing]);
  assert.equal(result.value.status, 'unresolved');
  assert.equal(result.value.review_required, true);
  assert.equal(result.value.student_facing_summary_candidate, null);
  assert.ok(result.value.unresolved_items.some((item) =>
    item.blocks_responsible_planning === true
    && item.source_item_refs.includes(missing)
    && String(item.unresolved_id).startsWith('runtime-lineage-unmapped:')
  ));
});

test('large staged audit completes omitted required lineage through bounded LEARNING_UNIT_DECOMPOSITION before returning', async () => {
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
        const missingUnit = output.learning_units.find((unit) => unit.source_item_refs.includes(missing));
        missingUnit.source_item_refs = missingUnit.source_item_refs.filter((ref) => ref !== missing);
        const domain = await request.domainValidator(output);
        assert.equal(domain.ok, true, domain.reason);
        assert.deepEqual(domain.value.source_to_unit_reconciliation.unmapped_required_refs, [missing]);
        const provenance = await request.provenanceValidator(domain.value);
        assert.equal(provenance.ok, true, provenance.reason);
        return { accepted: true, validatedResult: { output: domain.value } };
      }

      assert.equal(request.taskMode, 'LEARNING_UNIT_DECOMPOSITION');
      assert.equal(request.academicInput.lineage_repair_context.mode, 'REQUIRED_SOURCE_LINEAGE_COMPLETION');
      assert.equal(request.academicInput.source_items.length, 1);
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

  assert.equal(calls.filter((request) => request.taskMode === 'SOURCE_INVENTORY').length, 3);
  assert.equal(calls.filter((request) => request.taskMode === 'DEEP_AUDIT').length, 1);
  assert.equal(calls.filter((request) => request.taskMode === 'LEARNING_UNIT_DECOMPOSITION').length, 1);

  const output = result.validatedResult.output;
  assert.deepEqual(output.source_to_unit_reconciliation.unmapped_required_refs, []);
  assert.equal(output.source_to_unit_reconciliation.required_item_map.length, 49);
  assert.ok(output.learning_units.length > 1);
  assert.ok(output.learning_units.every((unit) => unit.source_item_refs.length <= 16));
  assert.equal(output.status, 'ok');
  assert.equal(output.review_required, false);
  assert.deepEqual(output.unresolved_items, []);
});

test('49-source under-decomposition is repaired through bounded SPLIT_UNIT before the audit can return', async () => {
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
        const output = coarseSynthesisOutput(request);
        const domain = await request.domainValidator(output);
        assert.equal(domain.ok, true, domain.reason);
        const provenance = await request.provenanceValidator(domain.value);
        assert.equal(provenance.ok, true, provenance.reason);
        return { accepted: true, validatedResult: { output: domain.value } };
      }

      assert.equal(request.taskMode, 'SPLIT_UNIT');
      assert.equal(request.academicInput.decomposition_repair_context.mode, 'DECOMPOSITION_REPAIR');
      assert.equal(request.academicInput.decomposition_repair_context.decomposition_flags.repair_required, true);
      const output = decompositionRepairOutput(request);
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

  assert.equal(calls.filter((request) => request.taskMode === 'DEEP_AUDIT').length, 1);
  assert.equal(calls.filter((request) => request.taskMode === 'SPLIT_UNIT').length, 1);
  const output = result.validatedResult.output;
  assert.ok(output.learning_units.length >= 4);
  assert.ok(output.learning_units.every((unit) => unit.source_item_refs.length <= 16));
  assert.deepEqual(output.source_to_unit_reconciliation.unmapped_required_refs, []);
  assert.equal(output.source_to_unit_reconciliation.required_item_map.length, 49);
});

test('188-source TPF-02 audit uses bounded structure passes while preserving complete raw evidence for decomposition synthesis', async () => {
  const allSources = sources(188).map((source, index) => ({
    ...source,
    content_summary: `Source ${index + 1}: ${'dense academic evidence '.repeat(40)}`,
  }));
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

      if (request.taskMode === 'LEARNING_UNIT_DECOMPOSITION'
        && request.academicInput.structure_pass_context?.mode === 'BOUNDED_CURRICULUM_STRUCTURE') {
        assert.ok(request.academicInput.source_items.length <= TPF02_STRUCTURE_BATCH_SIZE);
        assert.equal(
          request.academicInput.structure_pass_context.canonical_source_inventory.length,
          request.academicInput.source_items.length
        );
        const output = structurePassOutput(request);
        const domain = await request.domainValidator(output);
        assert.equal(domain.ok, true, domain.reason);
        const provenance = await request.provenanceValidator(domain.value);
        assert.equal(provenance.ok, true, provenance.reason);
        return { accepted: true, validatedResult: { output: domain.value } };
      }

      assert.equal(request.taskMode, 'DEEP_AUDIT');
      assert.equal(request.academicInput.execution_stage, EXECUTION_STAGES.WHOLE_CURRICULUM_SYNTHESIS_STAGE);
      assert.equal(request.academicInput.source_items.length, 0);
      assert.equal(request.academicInput.source_evidence_items.length, 188);
      assert.equal(request.academicInput.prepared_source_inventory.length, 188);
      assert.ok(request.academicInput.progressive_structure_candidates.length > 0);
      const serialized = JSON.stringify(request.academicInput);
      assert.ok(
        Buffer.byteLength(serialized, 'utf8') < 1024 * 1024,
        `progressive final academic input exceeded the governed 1 MiB source-census limit: ${Buffer.byteLength(serialized, 'utf8')} bytes`
      );

      const output = synthesisOutput(request);
      output.source_to_unit_reconciliation = { required_item_map: [], unmapped_required_refs: [] };
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

  const inventoryCalls = calls.filter((request) => request.taskMode === 'SOURCE_INVENTORY');
  const structureCalls = calls.filter((request) =>
    request.taskMode === 'LEARNING_UNIT_DECOMPOSITION'
    && request.academicInput.structure_pass_context?.mode === 'BOUNDED_CURRICULUM_STRUCTURE'
  );
  const synthesisCalls = calls.filter((request) => request.taskMode === 'DEEP_AUDIT');

  assert.equal(inventoryCalls.length, 8);
  assert.deepEqual(inventoryCalls.map((request) => request.academicInput.source_items.length), [24,24,24,24,24,24,24,20]);
  assert.equal(structureCalls.length, 8);
  assert.deepEqual(structureCalls.map((request) => request.academicInput.source_items.length), [24,24,24,24,24,24,24,20]);
  assert.equal(synthesisCalls.length, 1);

  const output = result.validatedResult.output;
  assert.equal(output.source_inventory.length, 188);
  assert.equal(output.audit_scope.source_walk.length, 188);
  assert.equal(output.source_to_unit_reconciliation.required_item_map.length, 188);
  assert.deepEqual(output.source_to_unit_reconciliation.unmapped_required_refs, []);
  assert.equal(output.status, 'ok');
  assert.equal(output.review_required, false);
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
