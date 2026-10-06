'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAuditSourceUnitGraph,
  materializeCoursePlanFromTpf03,
} = require('../../../teaching/d08/canonical-plan');

function sources() {
  return [
    { source_content_item_id: 'source-id-1', source_ref: 'subject:card:1' },
    { source_content_item_id: 'source-id-2', source_ref: 'subject:card:2' },
    { source_content_item_id: 'source-id-3', source_ref: 'subject:card:3' },
  ];
}

function audit() {
  return {
    source_inventory: [
      { source_item_ref: 'source:source-id-1' },
      { source_item_ref: 'source:source-id-2' },
      { source_item_ref: 'source:source-id-3' },
    ],
    source_accounting: [
      { source_ref: 'subject:card:3', learning_unit_ids: ['unit-1'] },
    ],
    topics: [
      {
        topic_id: 'topic-1',
        title: 'Topic 1',
        source_item_refs: ['source:source-id-1', 'source:source-id-2'],
        subtopics: [],
      },
    ],
    learning_units: [
      {
        learning_unit_id: 'unit-1',
        title: 'Unit 1',
        intended_competence: 'Demonstrate the topic competence.',
        source_item_refs: ['source:source-id-1'],
        topic_refs: ['topic-1'],
        prerequisite_refs: [],
        criticality: 'major',
        proposed_exit_evidence: 'Solve representative problems independently.',
      },
    ],
    assumed_prerequisites: [],
  };
}

function tpf03Output() {
  return {
    status: 'ok',
    input_state_reference: {},
    review_required: false,
    review_reasons: [],
    plan_basis: {},
    planning_principles_applied: [],
    course_sequence: [{
      sequence_group: 1,
      learning_units: [{
        learning_unit_ref: 'unit-1',
        initial_instruction_status: 'teach_full',
        prerequisite_refs: [],
        prerequisite_repair_refs: [],
        follow_up_treatments: [],
      }],
    }],
    prerequisite_repairs: [],
    assessment_window_proposals: [],
    coverage_treatment_map: [],
    infeasibility_or_pressure: [],
    unresolved_items: [],
    student_facing_plan_summary_candidate: 'Plan ready.',
  };
}

test('D08 closes the validated source graph across direct, topic and legacy accounting edges', () => {
  const graph = buildAuditSourceUnitGraph(audit(), sources());
  assert.deepEqual(graph.get('subject:card:1'), ['unit-1']);
  assert.deepEqual(graph.get('subject:card:2'), ['unit-1']);
  assert.deepEqual(graph.get('subject:card:3'), ['unit-1']);
});

test('D08 Course Plan materialization preserves topic-level source provenance as Learning Unit coverage', () => {
  const result = materializeCoursePlanFromTpf03(tpf03Output(), {
    audit: { audit_output: audit() },
    sources: sources(),
    vpkDecisions: [],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.value.source_mappings.map((row) => [row.source_ref, row.learning_unit_keys]),
    [
      ['subject:card:1', ['unit-1']],
      ['subject:card:2', ['unit-1']],
      ['subject:card:3', ['unit-1']],
    ]
  );
});

test('D08 does not invent source coverage when no authoritative graph path reaches a Learning Unit', () => {
  const detached = audit();
  detached.topics = [{ ...detached.topics[0], source_item_refs: ['source:source-id-1'] }];
  detached.source_accounting = [];
  const graph = buildAuditSourceUnitGraph(detached, sources());
  assert.deepEqual(graph.get('subject:card:2'), []);
  assert.deepEqual(graph.get('subject:card:3'), []);
});