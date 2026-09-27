'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  D06_DECISION_REGISTRY,
  REQUIRED_D06_TASK_IDS,
  assertDecisionRegistryIntegrity,
  getTeachingDecision,
  listTeachingDecisions,
} = require('../../../teaching/policy');

test('D06 registry closes exactly the canonical 27 policy gates', () => {
  const census = assertDecisionRegistryIntegrity();
  assert.equal(REQUIRED_D06_TASK_IDS.length, 27);
  assert.equal(census.total, 27);
  assert.equal(census.decided + census.configured + census.deferred, 27);
  assert.equal(listTeachingDecisions().length, 27);
});

test('unknown or future gate lookup fails closed', () => {
  assert.throws(
    () => getTeachingDecision('TCH-9999'),
    (error) => error.code === 'TEACHING_D06_POLICY_NOT_FOUND'
  );
});

test('returned policy decisions cannot mutate the registry by reference', () => {
  const first = getTeachingDecision('TCH-0072');
  first.decision.global_default_minimum = 99;
  assert.equal(D06_DECISION_REGISTRY.decisions['TCH-0072'].decision.global_default_minimum, null);
});

test('grade and terminal policies avoid invented hidden institutional rules', () => {
  const grade = getTeachingDecision('TCH-0071').decision;
  assert.equal(grade.default_scale, 'KIWI_PERCENTAGE_100_V1');
  assert.equal(grade.default_letter_grade, null);
  assert.equal(grade.default_grade_point, null);
  assert.equal(grade.semester_gpa_enabled_without_grade_point_policy, false);

  const terminal = getTeachingDecision('TCH-0072').decision;
  assert.equal(terminal.global_default_minimum, null);
  assert.equal(terminal.course_or_institution_policy_may_configure, true);
});

test('SKM policy is a learning-evidence state machine rather than Gradebook math', () => {
  const skm = getTeachingDecision('TCH-0074').decision;
  assert.equal(skm.algorithm, 'EVIDENCE_QUALITY_STATE_MACHINE_V1');
  assert.equal(skm.gradebook_marks_are_not_direct_state_assignments, true);
  assert.equal(skm.student_facing_raw_probability_or_weight, false);
  assert.ok(skm.durable_states.includes('SECURE'));
  assert.ok(skm.durable_states.includes('TRANSFERABLE'));
});

test('scheduler and attendance policies preserve authority separation', () => {
  const headroom = getTeachingDecision('TCH-0075').decision;
  assert.equal(headroom.target_headroom_ratio, 0.20);
  assert.equal(headroom.minimum_headroom_ratio, 0.15);
  assert.equal(headroom.required_content_can_be_deleted_to_fit, false);

  const lateness = getTeachingDecision('TCH-0076').decision;
  assert.equal(lateness.authoritative_clock, 'SERVER');
  assert.equal(lateness.absence_inferred_from_lateness_alone, false);

  const concern = getTeachingDecision('TCH-0077').decision;
  assert.equal(concern.subject_mark_reduction, false);
});

test('assessment policy fails closed on eligibility, integrity and moderation', () => {
  const impromptu = getTeachingDecision('TCH-0079').decision;
  assert.equal(impromptu.eligible_content_only, true);
  assert.equal(impromptu.package_must_be_ready_and_validated_before_class, true);

  const moderation = getTeachingDecision('TCH-0080').decision;
  assert.equal(moderation.blind_first_pass_required, true);
  assert.equal(moderation.unresolved_material_disagreement_behavior, 'REVIEW_NEEDED_NO_FINALIZATION');

  const integrity = getTeachingDecision('TCH-0081').decision;
  assert.equal(integrity.signal_or_model_output_can_directly_prove_misconduct, false);
  assert.equal(integrity.automatic_zero_or_failure_from_signal, false);
});

test('course cancellation reuses canonical lifecycle axes', () => {
  const cancellation = getTeachingDecision('TCH-0083').decision;
  assert.deepEqual(cancellation.base_lifecycle_path, [
    'ACTIVE_OR_PAUSED','TEACHING_ENDED','FINALIZING','INCOMPLETE'
  ]);
  assert.equal(cancellation.must_not_be_rewritten_as_completed_or_fail, true);
});

test('all deep KIWI write integrations remain explicitly deferred to D27', () => {
  for (const id of ['TCH-0088','TCH-0089','TCH-0090','TCH-0091','TCH-0092']) {
    const entry = getTeachingDecision(id);
    assert.equal(entry.status, 'EXPLICITLY_DEFERRED');
    assert.equal(entry.decision.write_integration_authorized, false);
    assert.ok(entry.downstream_deliveries.includes('D27'));
  }
});

test('coverage and eligibility gates prevent silent curriculum/assessment expansion', () => {
  const source = getTeachingDecision('TCH-0691').decision;
  assert.equal(source.silent_drop_allowed, false);
  assert.equal(source.ai_classification_directly_authoritative, false);
  assert.equal(Object.keys(source.classes).length, 6);

  const vpk = getTeachingDecision('TCH-0692').decision;
  assert.equal(vpk.student_intake_self_report_is_evidence, false);
  assert.ok(vpk.minimum_independent_verification_opportunities >= 2);

  const completion = getTeachingDecision('TCH-0693').decision;
  assert.equal(completion.planned_end_date_implies_completion, false);
  assert.equal(completion.incomplete_is_fail, false);

  const eligibility = getTeachingDecision('TCH-0694').decision;
  assert.deepEqual(eligibility.first_release_graded_exceptions, []);
  assert.deepEqual(eligibility.graded_content_must_be, ['TAUGHT','VALIDATED_PRIOR_KNOWLEDGE']);
  assert.equal(eligibility.raw_subject_scope_never_implies_eligibility, true);
});

test('D06 preserves D30/D31 holds', () => {
  assert.equal(D06_DECISION_REGISTRY.governance.teaching_ai_routes, 'UNQUALIFIED_UNTIL_D30');
  assert.equal(D06_DECISION_REGISTRY.governance.production_release, 'NOT_AUTHORIZED_UNTIL_D31');
});
