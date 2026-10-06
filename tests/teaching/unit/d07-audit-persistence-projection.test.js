'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createD07CourseIntakeRepository,
  projectionText,
} = require('../../../teaching/repositories/d07-course-intake');

function candidateOutput() {
  return {
    input_state_reference: 'teaching_course:course-1:state:1',
    task_mode: 'DEEP_AUDIT',
    execution_stage: 'SINGLE_PASS',
    audit_scope: {
      subject_or_course: 'Biology',
      source_refs: ['source:source-1'],
      trusted_scope_version: 'subject:biology:v1',
      source_walk: [{ source_item_ref: 'source:source-1', analysis_status: 'complete', note: null }],
    },
    source_inventory: [{
      source_item_ref: 'source:source-1',
      provenance: 'runtime-owned source',
      academic_meaning: 'Foundational cell-cycle material.',
      proposed_scope_classification: 'required',
      scope_classification_basis: 'Directly required by the Course.',
      duplicate_of_ref: null,
      content_validity_status: 'current_supported',
      content_validity_basis: null,
      confidence: 'high',
    }],
    topics: [],
    learning_units: [{
      learning_unit_id: 'LU-01',
      title: 'Cell cycle foundations',
      intended_competence: 'Explain the stages of the cell cycle.',
      source_item_refs: ['source:source-1'],
      topic_refs: [],
      prerequisite_refs: [],
      dependency_type_notes: null,
      criticality: 'foundational',
      criticality_basis: 'Required for later cellular biology.',
      proposed_exit_evidence: 'Accurately explain and sequence the stages.',
      gap_refs: [],
      uncertainties: [],
    }],
    assumed_prerequisites: [],
    source_conflicts: [],
    coverage_gaps: [],
    structure_change_proposals: [],
    source_to_unit_reconciliation: {
      required_item_map: [{ source_item_ref: 'source:source-1', learning_unit_refs: ['LU-01'] }],
      unmapped_required_refs: [],
    },
    unresolved_items: [],
    status: 'ok',
    review_required: false,
    review_reasons: [],
    student_facing_summary_candidate: 'Ready.',
  };
}

test('D07 child-table projections normalize contract-null optional text without changing canonical audit JSON', async () => {
  assert.equal(projectionText(null), '');
  assert.equal(projectionText(undefined), '');
  assert.equal(projectionText('kept'), 'kept');

  const statements = [];
  const tx = async (sql, params = []) => {
    statements.push({ sql, params });
    if (/select coalesce\(max\(audit_version\)/i.test(sql)) return { rows: [{ v: 1 }] };
    if (/insert into public\.teaching_curriculum_audits/i.test(sql)) {
      return { rows: [{ curriculum_audit_id: 'audit-1' }] };
    }
    return { rows: [] };
  };

  const repository = createD07CourseIntakeRepository({
    query: async () => ({ rows: [] }),
    withTransaction: async (work) => work(tx),
    randomUUID: () => 'audit-1',
  });

  const output = candidateOutput();
  await repository.saveAudit({
    studentId: 'student-1',
    courseId: 'course-1',
    subjectSnapshotRef: 'subject:biology:v1',
    inventoryDigest: 'digest-1',
    output,
    provenanceRefs: ['source:source-1'],
    validationMetadata: { domain_validated: true },
  });

  const parentInsert = statements.find(({ sql }) => /insert into public\.teaching_curriculum_audits/i.test(sql));
  assert.ok(parentInsert);
  assert.equal(JSON.parse(parentInsert.params[6]).source_inventory[0].content_validity_basis, null);
  assert.equal(JSON.parse(parentInsert.params[6]).learning_units[0].dependency_type_notes, null);

  const inventoryInsert = statements.find(({ sql }) => /insert into public\.teaching_curriculum_audit_source_inventory/i.test(sql));
  assert.ok(inventoryInsert);
  assert.equal(inventoryInsert.params[10], '');

  const unitInsert = statements.find(({ sql }) => /insert into public\.teaching_curriculum_audit_learning_units/i.test(sql));
  assert.ok(unitInsert);
  assert.equal(unitInsert.params[10], '');
});
