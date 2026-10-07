'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TPF02_SOURCE_INVENTORY_BATCH_SIZE,
  TPF02_STAGED_SOURCE_COUNT_THRESHOLD,
  TPF02_PROGRESSIVE_STRUCTURE_SOURCE_COUNT_THRESHOLD,
  TPF02_STRUCTURE_BATCH_SIZE,
  TPF02_DECOMPOSITION_REPAIR_SOURCE_BATCH_SIZE,
  sourceInventoryRequest,
  curriculumSynthesisRequest,
  shouldStageCurriculumAudit,
  shouldUseProgressiveStructure,
  structurePassRequest,
  decompositionRepairRequest,
  createD07Intelligence,
} = require('../../../teaching/d07/intelligence');
const {
  EXECUTION_STAGES,
  TPF02_DECOMPOSITION_PATCH_SCHEMA_ID,
  TPF02_DECOMPOSITION_PATCH_FIELDS,
  TPF02_DECOMPOSITION_PATCH_UNIT_FIELDS,
  buildTpf02AcademicInput,
  validateTpf02Domain,
  validateTpf02DecompositionPatchSchema,
  decompositionRepairState,
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
function coarseStructurePassOutput(request) {
  const refs = request.academicInput.source_items.map((item) => item.source_item_ref);
  const batchIndex = Number(request.academicInput.structure_pass_context?.batch_index || 0);
  const topicId = `coarse-batch-topic-${batchIndex}`;
  const subtopicId = `coarse-batch-subtopic-${batchIndex}`;
  return {
    input_state_reference: request.academicInput.input_state_reference,
    task_mode: 'LEARNING_UNIT_DECOMPOSITION',
    execution_stage: EXECUTION_STAGES.SINGLE_PASS,
    audit_scope: { ...request.academicInput.audit_scope, source_walk: [] },
    source_inventory: [],
    topics: [{
      topic_id: topicId,
      title: `Coarse bounded batch ${batchIndex + 1}`,
      source_item_refs: refs,
      subtopics: [{ subtopic_id: subtopicId, title: `Coarse bounded area ${batchIndex + 1}` }],
    }],
    learning_units: [{
      learning_unit_id: `coarse-batch-unit-${batchIndex}`,
      title: `Apply coarse bounded capability ${batchIndex + 1}`,
      intended_competence: 'Apply the combined capability represented by this provisional source batch.',
      source_item_refs: refs,
      topic_refs: [topicId],
      subtopic_id: subtopicId,
      prerequisite_refs: [],
      dependency_type_notes: null,
      criticality: 'major',
      criticality_basis: 'This is deliberately coarse provisional structure for the regression.',
      proposed_exit_evidence: 'Demonstrate the provisional combined capability.',
      gap_refs: [],
      uncertainties: [],
    }],
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
  const context = request.academicInput.decomposition_repair_context;
  const target = context.current_learning_unit;
  const repairRefs = [...context.repair_scope.repair_source_refs];
  const untouchedRefs = [...context.repair_scope.untouched_source_refs];
  const continuityRepairRefs = untouchedRefs.length ? [] : repairRefs.slice(0, 1);
  const splitRefs = untouchedRefs.length ? repairRefs : repairRefs.slice(1);
  const groups = [];
  for (let index = 0; index < splitRefs.length; index += 12) groups.push(splitRefs.slice(index, index + 12));
  const suffix = String(repairRefs[0] || 'repair').replace(/[^a-zA-Z0-9]+/g, '-');

  const continuity = {
    learning_unit_id: target.learning_unit_id,
    title: target.title,
    intended_competence: target.intended_competence,
    source_item_refs: continuityRepairRefs,
    prerequisite_refs: [],
    dependency_type_notes: target.dependency_type_notes,
    criticality: target.criticality,
    criticality_basis: 'Continuity unit retained after bounded T1-T5 decomposition repair.',
    proposed_exit_evidence: target.proposed_exit_evidence,
    uncertainties: [],
  };
  const additions = groups.map((sourceRefs, index) => ({
    learning_unit_id: `${target.learning_unit_id}-split-${suffix}-${index + 1}`,
    title: `${target.title} — capability ${index + 1}`,
    intended_competence: `Independently demonstrate bounded capability ${index + 1} from the selected evidence.`,
    source_item_refs: sourceRefs,
    prerequisite_refs: [],
    dependency_type_notes: null,
    criticality: target.criticality,
    criticality_basis: 'Bounded T1-T5 decomposition repair.',
    proposed_exit_evidence: 'Independently demonstrate this split capability.',
    uncertainties: [],
  }));
  return {
    input_state_reference: request.academicInput.input_state_reference,
    task_mode: 'SPLIT_UNIT',
    execution_stage: EXECUTION_STAGES.SINGLE_PASS,
    target_unit_id: target.learning_unit_id,
    decision: 'split',
    resulting_units: [continuity, ...additions],
    split_reason: 'T1-T5 decomposition requires independently teachable and verifiable capability boundaries.',
    unit_justification: null,
    course_ratio_justification: null,
    unresolved_reason: null,
    required_next_input_or_review: null,
    review_required: false,
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
  const excludedRef = preparedInventory[1].source_item_ref;
  preparedInventory[1] = {
    ...preparedInventory[1],
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
  const excludedRef = preparedInventory[1].source_item_ref;
  preparedInventory[1] = {
    ...preparedInventory[1],
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
  assert.match(result.reason, /^TPF02_LEARNING_UNIT_INVALID:/);
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
  const missing = fullInput.audit_scope.source_refs[1];
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
        const missing = request.academicInput.audit_scope.source_refs[1];
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
      assert.equal(request.academicInput.decomposition_repair_context.repair_scope.target_unit_id, 'unit-coarse');
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
  const repairCalls = calls.filter((request) => request.taskMode === 'SPLIT_UNIT');
  assert.equal(repairCalls.length, 2);
  assert.ok(repairCalls.every((request) => request.academicInput.source_items.length <= TPF02_DECOMPOSITION_REPAIR_SOURCE_BATCH_SIZE));
  assert.ok(repairCalls.every((request) => request.academicInput.decomposition_repair_context.current_learning_unit));
  const output = result.validatedResult.output;
  assert.ok(output.learning_units.length >= 4);
  assert.ok(output.learning_units.every((unit) => unit.source_item_refs.length <= 16));
  assert.deepEqual(output.source_to_unit_reconciliation.unmapped_required_refs, []);
  assert.equal(output.source_to_unit_reconciliation.required_item_map.length, 49);
});

test('decomposition repair stays bounded instead of resending and regenerating the whole large Course graph', () => {
  const allSources = sources(130);
  const fullInput = buildTpf02AcademicInput({
    course: course(),
    sources: allSources,
    taskMode: 'DEEP_AUDIT',
    executionStage: EXECUTION_STAGES.WHOLE_CURRICULUM_SYNTHESIS_STAGE,
  });
  const preparedInventory = fullInput.source_items.map(inventoryItem);
  const baseOutput = coarseSynthesisOutput({ academicInput: fullInput });
  baseOutput.source_inventory = preparedInventory;
  baseOutput.audit_scope.source_walk = fullInput.source_items.map(sourceWalk);
  const inventoryByRef = new Map(preparedInventory.map((item) => [item.source_item_ref, item]));
  const state = decompositionRepairState(baseOutput, inventoryByRef, {
    decompositionLimits: fullInput.constraints.decomposition_limits,
  });
  assert.equal(state.repair_required, true);

  const request = decompositionRepairRequest({
    course: course(),
    sources: allSources,
    baseOutput,
    preparedInventory,
    preparedSourceWalk: baseOutput.audit_scope.source_walk,
    decompositionState: state,
  });

  assert.equal(request.taskMode, 'SPLIT_UNIT');
  assert.equal(request.outputSchema.id, TPF02_DECOMPOSITION_PATCH_SCHEMA_ID);
  assert.deepEqual(request.outputSchema.declared_fields, [...TPF02_DECOMPOSITION_PATCH_FIELDS]);
  assert.equal(request.academicInput.source_items.length, TPF02_DECOMPOSITION_REPAIR_SOURCE_BATCH_SIZE);
  assert.equal(request.academicInput.decomposition_repair_context.repair_scope.repair_source_refs.length, TPF02_DECOMPOSITION_REPAIR_SOURCE_BATCH_SIZE);
  assert.equal(request.academicInput.decomposition_repair_context.current_learning_unit.source_item_refs.length, 130);
  assert.equal(request.academicInput.decomposition_repair_context.all_unit_outline.length, 1);
  assert.equal(request.contextSpec.provenance_refs.length + request.contextSpec.untrusted_refs.length, TPF02_DECOMPOSITION_REPAIR_SOURCE_BATCH_SIZE);
  assert.ok(Buffer.byteLength(JSON.stringify(request.academicInput), 'utf8') < 128 * 1024);
});

test('decomposition repair patch omits inherited canonical fields and the server reconstructs valid Learning Units', async () => {
  const allSources = sources(49);
  const fullInput = buildTpf02AcademicInput({
    course: course(),
    sources: allSources,
    taskMode: 'DEEP_AUDIT',
    executionStage: EXECUTION_STAGES.WHOLE_CURRICULUM_SYNTHESIS_STAGE,
  });
  const preparedInventory = fullInput.source_items.map(inventoryItem);
  const baseOutput = coarseSynthesisOutput({ academicInput: fullInput });
  baseOutput.source_inventory = preparedInventory;
  baseOutput.audit_scope.source_walk = fullInput.source_items.map(sourceWalk);
  const state = decompositionRepairState(
    baseOutput,
    new Map(preparedInventory.map((item) => [item.source_item_ref, item])),
    { decompositionLimits: fullInput.constraints.decomposition_limits }
  );
  const request = decompositionRepairRequest({
    course: course(),
    sources: allSources,
    baseOutput,
    preparedInventory,
    preparedSourceWalk: baseOutput.audit_scope.source_walk,
    decompositionState: state,
  });
  const patch = decompositionRepairOutput(request);

  assert.equal(validateTpf02DecompositionPatchSchema(patch).ok, true);
  assert.deepEqual(Object.keys(patch).sort(), [...TPF02_DECOMPOSITION_PATCH_FIELDS].sort());
  for (const unit of patch.resulting_units) {
    assert.deepEqual(Object.keys(unit).sort(), [...TPF02_DECOMPOSITION_PATCH_UNIT_FIELDS].sort());
    assert.equal(Object.hasOwn(unit, 'topic_refs'), false);
    assert.equal(Object.hasOwn(unit, 'subtopic_id'), false);
    assert.equal(Object.hasOwn(unit, 'gap_refs'), false);
  }

  const domain = await request.domainValidator(patch);
  assert.equal(domain.ok, true, domain.reason);
  const rebuilt = domain.value;
  const continuity = rebuilt.learning_units.find((unit) => unit.learning_unit_id === patch.target_unit_id);
  assert.ok(continuity);
  assert.deepEqual(continuity.topic_refs, ['topic-coarse']);
  assert.equal(continuity.subtopic_id, 'subtopic-coarse');
  assert.ok(continuity.source_item_refs.length > 0);
  assert.ok(rebuilt.learning_units.every((unit) => Object.hasOwn(unit, 'gap_refs')));
});

test('decomposition keep patch records justification without restating the canonical Learning Unit', async () => {
  const allSources = sources(17);
  const fullInput = buildTpf02AcademicInput({
    course: course(),
    sources: allSources,
    taskMode: 'DEEP_AUDIT',
    executionStage: EXECUTION_STAGES.WHOLE_CURRICULUM_SYNTHESIS_STAGE,
  });
  const preparedInventory = fullInput.source_items.map(inventoryItem);
  const baseOutput = coarseSynthesisOutput({ academicInput: fullInput });
  baseOutput.source_inventory = preparedInventory;
  baseOutput.audit_scope.source_walk = fullInput.source_items.map(sourceWalk);
  const state = decompositionRepairState(
    baseOutput,
    new Map(preparedInventory.map((item) => [item.source_item_ref, item])),
    { decompositionLimits: fullInput.constraints.decomposition_limits }
  );
  const request = decompositionRepairRequest({
    course: course(),
    sources: allSources,
    baseOutput,
    preparedInventory,
    preparedSourceWalk: baseOutput.audit_scope.source_walk,
    decompositionState: state,
  });
  const patch = {
    input_state_reference: request.academicInput.input_state_reference,
    task_mode: 'SPLIT_UNIT',
    execution_stage: EXECUTION_STAGES.SINGLE_PASS,
    target_unit_id: request.repairScope.target_unit_id,
    decision: 'keep',
    resulting_units: [],
    split_reason: null,
    unit_justification: 'DECOMPOSITION_JUSTIFICATION: the supplied evidence forms one inseparable competence under T1-T5.',
    course_ratio_justification: 'DECOMPOSITION_JUSTIFICATION: the Course has few broad but independently assessable competence boundaries.',
    unresolved_reason: null,
    required_next_input_or_review: null,
    review_required: true,
  };
  const domain = await request.domainValidator(patch);
  assert.equal(domain.ok, true, domain.reason);
  const rebuilt = domain.value;
  assert.equal(rebuilt.learning_units.length, 1);
  assert.ok(rebuilt.learning_units[0].uncertainties.includes(patch.unit_justification));
  assert.ok(rebuilt.review_reasons.includes(patch.course_ratio_justification));
  assert.equal(rebuilt.review_required, true);
});

test('decomposition repair may fail closed as an unresolved audit without rewriting the canonical unit', async () => {
  const allSources = sources(17);
  const fullInput = buildTpf02AcademicInput({
    course: course(),
    sources: allSources,
    taskMode: 'DEEP_AUDIT',
    executionStage: EXECUTION_STAGES.WHOLE_CURRICULUM_SYNTHESIS_STAGE,
  });
  const preparedInventory = fullInput.source_items.map(inventoryItem);
  const baseOutput = coarseSynthesisOutput({ academicInput: fullInput });
  baseOutput.source_inventory = preparedInventory;
  baseOutput.audit_scope.source_walk = fullInput.source_items.map(sourceWalk);
  const state = decompositionRepairState(
    baseOutput,
    new Map(preparedInventory.map((item) => [item.source_item_ref, item])),
    { decompositionLimits: fullInput.constraints.decomposition_limits }
  );
  const request = decompositionRepairRequest({
    course: course(),
    sources: allSources,
    baseOutput,
    preparedInventory,
    preparedSourceWalk: baseOutput.audit_scope.source_walk,
    decompositionState: state,
  });
  const patch = {
    input_state_reference: request.academicInput.input_state_reference,
    task_mode: 'SPLIT_UNIT',
    execution_stage: EXECUTION_STAGES.SINGLE_PASS,
    target_unit_id: request.repairScope.target_unit_id,
    decision: 'unresolved',
    resulting_units: [],
    split_reason: null,
    unit_justification: null,
    course_ratio_justification: null,
    unresolved_reason: 'The bounded evidence does not distinguish the competence boundary responsibly.',
    required_next_input_or_review: 'Review the source material with fuller academic context before splitting.',
    review_required: true,
  };
  const domain = await request.domainValidator(patch);
  assert.equal(domain.ok, true, domain.reason);
  const rebuilt = domain.value;
  assert.equal(rebuilt.status, 'unresolved');
  assert.equal(rebuilt.review_required, true);
  assert.equal(rebuilt.student_facing_summary_candidate, null);
  assert.equal(rebuilt.learning_units.length, 1);
  assert.equal(rebuilt.unresolved_items.at(-1).blocks_responsible_planning, true);
  assert.deepEqual(rebuilt.unresolved_items.at(-1).source_item_refs, request.repairScope.repair_source_refs);
});

test('progressive structure pass does not abort a large audit merely because its provisional batch triggers G11', async () => {
  const allSources = sources(130);
  const request = structurePassRequest({
    course: course(),
    sources: allSources.slice(0, TPF02_STRUCTURE_BATCH_SIZE),
    preparedInventory: allSources.slice(0, TPF02_STRUCTURE_BATCH_SIZE).map((source) => ({
      source_item_ref: `source:${source.source_content_item_id}`,
      provenance: 'fixture',
      academic_meaning: source.content_summary,
      proposed_scope_classification: 'required',
      scope_classification_basis: 'fixture',
      duplicate_of_ref: null,
      content_validity_status: 'current_supported',
      content_validity_basis: null,
      confidence: 'high',
    })),
    batchIndex: 0,
  });
  const output = coarseStructurePassOutput(request);
  const domain = await request.domainValidator(output);
  assert.equal(domain.ok, true, domain.reason);
  assert.equal(domain.value.learning_units.length, 1);
  assert.equal(domain.value.learning_units[0].source_item_refs.length, TPF02_STRUCTURE_BATCH_SIZE);
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
