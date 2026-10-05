'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const contracts = require('../../../teaching/d08/contracts');
const canonical = require('../../../teaching/d08/canonical-plan');

function sources() {
  return [{
    source_content_item_id: 's1',
    source_ref: 'source:1',
    source_kind: 'PRIMARY_KIWI_SUBJECT',
    classification: 'ACADEMICALLY_MEANINGFUL',
    academically_meaningful: true,
  }];
}

function audit(criticality) {
  return {
    curriculum_audit_id: 'audit-1',
    audit_version: 1,
    subject_snapshot_ref: 'snapshot:1',
    audit_output: {
      source_inventory: [{ source_item_ref: 'source:s1' }],
      topics: [{
        topic_id: 'topic-1',
        title: 'Biochemistry',
        source_item_refs: ['source:s1'],
        subtopics: ['Carbohydrates'],
      }],
      learning_units: [{
        learning_unit_id: 'lu_polysaccharides',
        title: 'Polysaccharides and Energy Storage',
        intended_competence: 'Explain how polysaccharide structure supports energy storage and use.',
        source_item_refs: ['source:s1'],
        topic_refs: ['topic-1'],
        prerequisite_refs: [],
        dependency_type_notes: '',
        criticality,
        criticality_basis: 'Validated curriculum importance.',
        proposed_exit_evidence: 'Explain the relationship independently using a novel example.',
        uncertainties: [],
      }],
      assumed_prerequisites: [],
    },
  };
}

function tpf03Output() {
  return {
    status: 'ok',
    input_state_reference: { aggregate_type: 'teaching_course', aggregate_id: 'course-1', state_version: '1' },
    review_required: false,
    review_reasons: [],
    plan_basis: {
      course_scope_version: 'snapshot:1',
      curriculum_artifact_version: 'audit-1',
      evidence_state_version: 'evidence-1',
      policy_refs: [],
      capacity_or_deadline_facts_used: [],
    },
    planning_principles_applied: ['Preserve validated curriculum scope.'],
    course_sequence: [{
      sequence_group: 1,
      topic_or_phase: 'Biochemistry',
      learning_units: [{
        learning_unit_ref: 'lu_polysaccharides',
        required_scope: true,
        initial_instruction_status: 'teach_full',
        initial_treatment_basis: 'Validated curriculum scope.',
        prerequisite_repair_refs: [],
        follow_up_treatments: [],
        prerequisite_refs: [],
        instructional_emphasis: 'high',
        emphasis_basis: 'Curriculum importance.',
        evidence_goal: 'Independent explanation.',
        review_or_retention_notes: null,
        student_intake_accommodation_notes: null,
      }],
    }],
    prerequisite_repairs: [],
    assessment_window_proposals: [],
    coverage_treatment_map: [{
      required_source_or_unit_ref: 'source:1',
      planned_treatment_refs: ['lu_polysaccharides'],
      mapping_completeness_proposal: 'full',
      coverage_status_claimed: 'planned_only',
    }],
    infeasibility_or_pressure: [],
    unresolved_items: [],
    student_facing_plan_summary_candidate: 'Validated course plan.',
  };
}

test('canonical TPF-02 major criticality materializes into the D08 Course Plan contract', () => {
  const sourceRows = sources();
  const materialized = canonical.materializeCoursePlanFromTpf03(tpf03Output(), {
    audit: audit('major'),
    sources: sourceRows,
  });

  assert.equal(materialized.ok, true);
  assert.equal(materialized.value.learning_units[0].key, 'lu_polysaccharides');
  assert.equal(materialized.value.learning_units[0].criticality, 'HIGH');

  const validated = contracts.validateCoursePlanProposal(materialized.value, { sources: sourceRows });
  assert.equal(validated.ok, true);
  assert.equal(validated.value.learning_units[0].criticality, 'HIGH');
});

test('all resolved frozen TPF-02 criticality values translate deterministically', () => {
  const expected = new Map([
    ['foundational', 'FOUNDATIONAL'],
    ['major', 'HIGH'],
    ['supporting', 'MEDIUM'],
    ['enrichment', 'LOW'],
  ]);

  for (const [criticality, planCriticality] of expected) {
    const materialized = canonical.materializeCoursePlanFromTpf03(tpf03Output(), {
      audit: audit(criticality),
      sources: sources(),
    });
    assert.equal(materialized.ok, true, criticality);
    assert.equal(materialized.value.learning_units[0].criticality, planCriticality, criticality);
  }
});

test('unresolved curriculum criticality fails closed instead of defaulting', () => {
  const materialized = canonical.materializeCoursePlanFromTpf03(tpf03Output(), {
    audit: audit('unresolved'),
    sources: sources(),
  });

  assert.equal(materialized.ok, false);
  assert.equal(materialized.reason, 'TEACHING_D08_CRITICALITY_UNRESOLVED');
});
