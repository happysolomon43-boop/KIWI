'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAuditSourceUnitGraph,
  materializeCoursePlanFromTpf03,
} = require('../../../teaching/d08/canonical-plan');
const {
  COVERAGE_HINT_MAX_CHARS,
  buildCoverageObligations,
  validateCoverageTreatmentPlan,
} = require('../../../teaching/d08/coverage-planning');
const { boundedPlanningSignals } = require('../../../teaching/d08/intelligence');

function sources() {
  return [
    { source_content_item_id:'source-id-1', source_ref:'subject:card:1', classification:'ACADEMICALLY_MEANINGFUL', academically_meaningful:true, content_summary:'Communication foundations.' },
    { source_content_item_id:'source-id-2', source_ref:'subject:card:2', classification:'ACADEMICALLY_MEANINGFUL', academically_meaningful:true, content_summary:'Grammar foundations.' },
    { source_content_item_id:'source-id-3', source_ref:'subject:card:3', classification:'ACADEMICALLY_MEANINGFUL', academically_meaningful:true, content_summary:'Academic study methods.' },
  ];
}

function legacyAuditOutput() {
  return {
    source_inventory: [
      { source_item_ref:'source:source-id-1', academic_meaning:'Communication foundations from the validated audit.' },
      { source_item_ref:'source:source-id-2', academic_meaning:'Grammar foundations from the validated audit.' },
      { source_item_ref:'source:source-id-3', academic_meaning:'Academic study methods from the validated audit.' },
    ],
    topics: [
      { topic_id:'topic-1', title:'Communication', source_item_refs:['source:source-id-1'], subtopics:[] },
      { topic_id:'topic-2', title:'Grammar and study', source_item_refs:[], subtopics:[] },
    ],
    learning_units: [
      {
        learning_unit_id:'unit-1', topic_refs:['topic-1'], title:'Communication', intended_competence:'Explain communication.',
        source_item_refs:['source:source-id-1'], prerequisite_refs:[], criticality:'major', proposed_exit_evidence:'Explain the process.',
      },
      {
        learning_unit_id:'unit-2', topic_refs:['topic-2'], title:'Grammar and study', intended_competence:'Apply grammar and study methods.',
        source_item_refs:[], prerequisite_refs:[], criticality:'supporting', proposed_exit_evidence:'Apply the methods.',
      },
    ],
    assumed_prerequisites:[],
  };
}

function v11AuditOutput() {
  const output = legacyAuditOutput();
  output.source_inventory = output.source_inventory.map((item) => ({ ...item, proposed_scope_classification:'required' }));
  output.learning_units[1] = { ...output.learning_units[1], source_item_refs:['source:source-id-2','source:source-id-3'] };
  output.source_to_unit_reconciliation = {
    required_item_map:[
      {source_item_ref:'source:source-id-1',learning_unit_refs:['unit-1']},
      {source_item_ref:'source:source-id-2',learning_unit_refs:['unit-2']},
      {source_item_ref:'source:source-id-3',learning_unit_refs:['unit-2']},
    ],
    unmapped_required_refs:[],
  };
  return output;
}

function output() {
  return {
    status:'ok',
    input_state_reference:{},
    review_required:false,
    review_reasons:[],
    plan_basis:{},
    planning_principles_applied:[],
    course_sequence:[{
      sequence_group:1,
      learning_units:[
        { learning_unit_ref:'unit-1', initial_instruction_status:'teach_full', prerequisite_refs:[], prerequisite_repair_refs:[], follow_up_treatments:[] },
        { learning_unit_ref:'unit-2', initial_instruction_status:'teach_full', prerequisite_refs:[], prerequisite_repair_refs:[], follow_up_treatments:[] },
      ],
    }],
    prerequisite_repairs:[],
    assessment_window_proposals:[],
    coverage_treatment_map:[
      { required_source_or_unit_ref:'subject:card:2', planned_treatment_refs:['unit-2'], mapping_completeness_proposal:'full', coverage_status_claimed:'planned_only' },
      { required_source_or_unit_ref:'subject:card:3', planned_treatment_refs:['unit-2'], mapping_completeness_proposal:'full', coverage_status_claimed:'planned_only' },
    ],
    infeasibility_or_pressure:[],
    unresolved_items:[],
    student_facing_plan_summary_candidate:'Plan ready.',
  };
}

test('legacy D08 repair exposes only genuinely uncovered sources with compact academic hints', () => {
  const audit = legacyAuditOutput();
  const graph = buildAuditSourceUnitGraph(audit, sources());
  const obligations = buildCoverageObligations({ auditOutput:audit, sources:sources(), sourceUnitGraph:graph });
  assert.equal(obligations.length, 2);
  assert.deepEqual(obligations.map((item)=>item.source_ref), ['subject:card:2','subject:card:3']);
  assert.match(obligations[0].academic_hint, /Grammar foundations/);
  assert.equal(Object.hasOwn(obligations[0], 'academic_summary'), false);
  assert.ok(obligations.every((item)=>item.academic_hint.length<=COVERAGE_HINT_MAX_CHARS));
});

test('TPF-03 planning context contains only bounded legacy source obligations and no duplicate source-classification census', () => {
  const audit = { curriculum_audit_id:'audit-1', audit_version:1, subject_snapshot_ref:'snapshot-1', audit_output:legacyAuditOutput() };
  const signals = boundedPlanningSignals({ audit, sources:sources(), vpkDecisions:[] });
  assert.equal(signals.required_source_coverage_obligations.length, 2);
  assert.match(signals.required_source_coverage_obligations[1].academic_hint, /Academic study methods/);
  assert.equal(Object.hasOwn(signals, 'source_classifications'), false);
  assert.equal(JSON.stringify(signals).includes('content_summary'), false);
});

test('a reconciled TPF-02 v1.1 audit sends no source-repair obligations to TPF-03', () => {
  const auditOutput = v11AuditOutput();
  const graph = buildAuditSourceUnitGraph(auditOutput, sources());
  const obligations = buildCoverageObligations({ auditOutput, sources:sources(), sourceUnitGraph:graph });
  assert.deepEqual(obligations, []);
  const checked = validateCoverageTreatmentPlan({ coverage_treatment_map:[] }, { auditOutput, sources:sources(), sourceUnitGraph:graph });
  assert.equal(checked.ok, true);
  assert.equal(checked.lineageReconciled, true);
});

test('D08 fails closed when a TPF-02 v1.1 audit claims reconciliation but required lineage is actually missing', () => {
  const auditOutput = v11AuditOutput();
  auditOutput.learning_units[1] = { ...auditOutput.learning_units[1], source_item_refs:['source:source-id-2'] };
  const graph = buildAuditSourceUnitGraph(auditOutput, sources());
  const checked = validateCoverageTreatmentPlan({ coverage_treatment_map:[] }, { auditOutput, sources:sources(), sourceUnitGraph:graph });
  assert.equal(checked.ok, false);
  assert.equal(checked.reason, 'TEACHING_D08_AUDIT_LINEAGE_INVALID');
});

test('D08 materializes validated TPF-03 proposals only for gaps left by a legacy audit', () => {
  const result = materializeCoursePlanFromTpf03(output(), {
    audit:{ audit_output:legacyAuditOutput() },
    sources:sources(),
    vpkDecisions:[],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.source_mappings, [
    { source_ref:'subject:card:1', learning_unit_keys:['unit-1'] },
    { source_ref:'subject:card:2', learning_unit_keys:['unit-2'] },
    { source_ref:'subject:card:3', learning_unit_keys:['unit-2'] },
  ]);
});

test('legacy D08 bridge still blocks silent curriculum disappearance when TPF-03 omits an uncovered required material', () => {
  const incomplete = output();
  incomplete.coverage_treatment_map = incomplete.coverage_treatment_map.slice(0, 1);
  const graph = buildAuditSourceUnitGraph(legacyAuditOutput(), sources());
  const checked = validateCoverageTreatmentPlan(incomplete, { auditOutput:legacyAuditOutput(), sources:sources(), sourceUnitGraph:graph });
  assert.equal(checked.ok, false);
  assert.equal(checked.reason, 'TEACHING_D08_REQUIRED_SOURCE_UNMAPPED');
});

test('legacy D08 bridge rejects proposed source coverage that points at an invented Learning Unit', () => {
  const invalid = output();
  invalid.coverage_treatment_map[0] = { ...invalid.coverage_treatment_map[0], planned_treatment_refs:['invented-unit'] };
  const graph = buildAuditSourceUnitGraph(legacyAuditOutput(), sources());
  const checked = validateCoverageTreatmentPlan(invalid, { auditOutput:legacyAuditOutput(), sources:sources(), sourceUnitGraph:graph });
  assert.equal(checked.ok, false);
  assert.equal(checked.reason, 'TEACHING_D08_TPF03_COVERAGE_UNIT_INVALID');
});

test('141-source legacy repair context remains bounded even when source summaries are huge', () => {
  const largeSources = Array.from({length:141},(_,index)=>({
    source_content_item_id:`large-${index+1}`,
    source_ref:`subject:large:${index+1}`,
    classification:'ACADEMICALLY_MEANINGFUL',
    academically_meaningful:true,
    content_summary:`Material ${index+1} `+'x'.repeat(4000),
  }));
  const auditOutput={
    source_inventory:largeSources.map((source)=>({source_item_ref:`source:${source.source_content_item_id}`,academic_meaning:`Meaning ${source.source_ref} `+'y'.repeat(4000)})),
    topics:[{topic_id:'topic-1',title:'Course',source_item_refs:[],subtopics:[]}],
    learning_units:[{learning_unit_id:'unit-1',topic_refs:['topic-1'],title:'Course foundations',intended_competence:'Apply the course foundations.',source_item_refs:['source:large-1'],prerequisite_refs:[],criticality:'major',proposed_exit_evidence:'Demonstrate the competence.'}],
    assumed_prerequisites:[],
  };
  const signals=boundedPlanningSignals({audit:{curriculum_audit_id:'audit-large',audit_version:1,subject_snapshot_ref:'snapshot-large',audit_output:auditOutput},sources:largeSources,vpkDecisions:[]});
  const serialized=JSON.stringify(signals);
  assert.equal(signals.required_source_coverage_obligations.length,140);
  assert.ok(Buffer.byteLength(serialized,'utf8')<55_000,Buffer.byteLength(serialized,'utf8'));
  assert.equal(serialized.includes('content_summary'),false);
  assert.equal(serialized.includes('source_classifications'),false);
});
