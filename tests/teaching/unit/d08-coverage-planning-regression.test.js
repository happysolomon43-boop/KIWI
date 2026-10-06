'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAuditSourceUnitGraph,
  materializeCoursePlanFromTpf03,
} = require('../../../teaching/d08/canonical-plan');
const {
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

function auditOutput() {
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

test('D08 exposes every required source obligation with academic meaning and existing deterministic mappings', () => {
  const audit = auditOutput();
  const graph = buildAuditSourceUnitGraph(audit, sources());
  const obligations = buildCoverageObligations({ auditOutput:audit, sources:sources(), sourceUnitGraph:graph });
  assert.equal(obligations.length, 3);
  assert.deepEqual(obligations[0].existing_learning_unit_refs, ['unit-1']);
  assert.equal(obligations[0].requires_planner_mapping, false);
  assert.equal(obligations[1].requires_planner_mapping, true);
  assert.match(obligations[1].academic_summary, /Grammar foundations/);
});

test('TPF-03 planning context contains bounded source coverage obligations instead of opaque source ids only', () => {
  const audit = { curriculum_audit_id:'audit-1', audit_version:1, subject_snapshot_ref:'snapshot-1', audit_output:auditOutput() };
  const signals = boundedPlanningSignals({ audit, sources:sources(), vpkDecisions:[] });
  assert.equal(signals.required_source_coverage_obligations.length, 3);
  assert.equal(signals.required_source_coverage_obligations.filter((item)=>item.requires_planner_mapping).length, 2);
  assert.match(signals.required_source_coverage_obligations[2].academic_summary, /Academic study methods/);
});

test('D08 materializes validated TPF-03 source treatment proposals only for gaps left by deterministic audit lineage', () => {
  const result = materializeCoursePlanFromTpf03(output(), {
    audit:{ audit_output:auditOutput() },
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

test('D08 still blocks silent curriculum disappearance when TPF-03 omits an uncovered required material', () => {
  const incomplete = output();
  incomplete.coverage_treatment_map = incomplete.coverage_treatment_map.slice(0, 1);
  const graph = buildAuditSourceUnitGraph(auditOutput(), sources());
  const checked = validateCoverageTreatmentPlan(incomplete, { auditOutput:auditOutput(), sources:sources(), sourceUnitGraph:graph });
  assert.equal(checked.ok, false);
  assert.equal(checked.reason, 'TEACHING_D08_REQUIRED_SOURCE_UNMAPPED');
});

test('D08 rejects proposed source coverage that points at an invented Learning Unit', () => {
  const invalid = output();
  invalid.coverage_treatment_map[0] = { ...invalid.coverage_treatment_map[0], planned_treatment_refs:['invented-unit'] };
  const graph = buildAuditSourceUnitGraph(auditOutput(), sources());
  const checked = validateCoverageTreatmentPlan(invalid, { auditOutput:auditOutput(), sources:sources(), sourceUnitGraph:graph });
  assert.equal(checked.ok, false);
  assert.equal(checked.reason, 'TEACHING_D08_TPF03_COVERAGE_UNIT_INVALID');
});
