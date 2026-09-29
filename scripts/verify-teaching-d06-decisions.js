'use strict';

const fs = require('node:fs');
const path = require('node:path');
const policy = require('../teaching/policy');
const registry = policy.D06_DECISION_REGISTRY;

function fail(message) {
  console.error('[Teaching D06 verify] FAIL:', message);
  process.exitCode = 1;
  throw new Error(message);
}
function assert(condition, message) { if (!condition) fail(message); }
function read(rel) { return fs.readFileSync(path.join(process.cwd(), rel), 'utf8'); }

const census = policy.assertDecisionRegistryIntegrity();
assert(census.total === 27, 'D06 must close exactly 27 gates.');
assert(census.decided + census.configured + census.deferred === 27, 'Every D06 gate must have one closed disposition.');

const expected = [
  ...Array.from({ length: 23 }, (_, index) => `TCH-${String(71 + index).padStart(4, '0')}`),
  ...Array.from({ length: 4 }, (_, index) => `TCH-${String(691 + index).padStart(4, '0')}`),
];
assert(JSON.stringify(Object.keys(registry.decisions).sort()) === JSON.stringify(expected.sort()), 'D06 TCH census drifted.');

assert(registry.decisions['TCH-0071'].decision.default_scale === 'KIWI_PERCENTAGE_100_V1', 'Default grade scale must be explicit.');
assert(registry.decisions['TCH-0071'].decision.default_grade_point === null, 'D06 must not invent a default grade-point scale.');
assert(registry.decisions['TCH-0072'].decision.global_default_minimum === null, 'D06 must not invent a global terminal minimum.');

const topic = registry.decisions['TCH-0073'].decision;
assert(topic.minimum_grade_contributing_events >= 3 && topic.minimum_distinct_assessment_contexts >= 2, 'Topic sufficiency must require repeated/diverse evidence.');
assert(topic.controlled_independent_evidence_required === true, 'Topic finality needs controlled independent evidence.');

const skm = registry.decisions['TCH-0074'].decision;
assert(skm.algorithm === 'EVIDENCE_QUALITY_STATE_MACHINE_V1', 'SKM v1 algorithm must be pinned.');
assert(skm.gradebook_marks_are_not_direct_state_assignments === true, 'SKM cannot copy Gradebook truth.');
assert(skm.time_alone_may_reduce_certainty_but_not_decree_knowledge_loss === true, 'Time alone cannot decree forgetting.');

const schedule = registry.decisions['TCH-0075'].decision;
assert(schedule.target_headroom_ratio === 0.20 && schedule.minimum_headroom_ratio === 0.15, 'Recovery-headroom calibration must be explicit.');
assert(schedule.hard_constraints_can_be_violated === false && schedule.required_content_can_be_deleted_to_fit === false, 'Headroom cannot bypass hard constraints or coverage.');

const lateness = registry.decisions['TCH-0076'].decision;
assert(lateness.authoritative_clock === 'SERVER', 'Lateness must use server time.');
assert(lateness.absence_inferred_from_lateness_alone === false, 'Lateness and absence must remain separate.');

const attendance = registry.decisions['TCH-0077'].decision;
assert(attendance.attendance_concern_first_release === true, 'Attendance Concern first-release posture must be closed.');
assert(attendance.attendance_probation_first_release === false, 'Attendance Probation must remain out of first release.');
assert(attendance.subject_mark_reduction === false, 'Attendance cannot directly reduce subject marks.');

const correction = registry.decisions['TCH-0078'].decision;
assert(correction.default_mark_recovery === 'NONE', 'Default correction recovery must be explicit.');
assert(correction.original_attempt_and_mark_preserved === true, 'Correction must preserve original history.');

const impromptu = registry.decisions['TCH-0079'].decision;
assert(impromptu.default_course_grade_weight_cap === 0.10, 'Impromptu default category weight must remain bounded.');
assert(impromptu.eligible_content_only === true && impromptu.package_must_be_ready_and_validated_before_class === true, 'Impromptu assessment must preserve eligibility/validation.');

const moderation = registry.decisions['TCH-0080'].decision;
assert(moderation.blind_first_pass_required === true, 'High-stakes moderation must be blind-first.');
assert(moderation.generator_or_initial_marker_cannot_be_sole_moderator === true, 'Generation/marking independence must remain intact.');
assert(moderation.unresolved_material_disagreement_behavior === 'REVIEW_NEEDED_NO_FINALIZATION', 'Moderation conflict must fail closed.');

const integrity = registry.decisions['TCH-0081'].decision;
assert(integrity.signal_or_model_output_can_directly_prove_misconduct === false, 'Integrity signals cannot prove misconduct.');
assert(integrity.automatic_zero_or_failure_from_signal === false, 'Integrity signal cannot create automatic penalty.');

const accommodations = registry.decisions['TCH-0082'].decision;
assert(accommodations.student_may_self_approve_academic_standard_or_time_changes === false, 'Student cannot self-approve academic accommodations.');
assert(accommodations.teacher_personality_may_override === false, 'Teacher personality cannot override accommodations.');

const cancel = registry.decisions['TCH-0083'].decision;
assert(cancel.base_lifecycle_path.join('>') === 'ACTIVE_OR_PAUSED>TEACHING_ENDED>FINALIZING>INCOMPLETE', 'Cancellation must reuse canonical Course lifecycle.');
assert(cancel.must_not_be_rewritten_as_completed_or_fail === true, 'Cancellation cannot become Completed/Fail by convenience.');

const retention = registry.decisions['TCH-0084'];
assert(retention.status === 'EXPLICITLY_DEFERRED' && /D28/.test(retention.defer_prerequisite), 'Exact retention periods must be explicitly deferred to D28.');
assert(retention.decision.interim_contract.teaching_specific_automatic_destructive_deletion_authorized === false, 'No destructive Teaching retention job may ship before D28.');

assert(registry.decisions['TCH-0085'].status === 'EXPLICITLY_DEFERRED', 'Voice/avatar must be explicitly post-release.');
assert(registry.decisions['TCH-0085'].decision.core_teaching_may_depend_on_voice_or_avatar === false, 'Core Teaching must not depend on voice/avatar.');

const renderers = registry.decisions['TCH-0086'].decision;
for (const required of ['MCQ','SHORT_CONSTRUCTED_TEXT','EXTENDED_TEXT_OR_ESSAY','NUMERIC_WITH_UNIT','MATHEMATICAL_WORKING_AND_FINAL','SOURCE_SUPPORTED_CONSTRUCTED_RESPONSE']) {
  assert(renderers.first_release.includes(required), `First-release renderer decision missing ${required}`);
}
assert(renderers.not_first_release.includes('CODE_EXECUTION_RESPONSE'), 'Executable code response must remain deferred in first release.');

const exams = registry.decisions['TCH-0087'].decision;
assert(exams.reuse_existing_exam_cbt_renderer_technology === true, 'Teaching must reuse shared Exam/CBT technology.');
assert(exams.teaching_formal_assessments_appear_as_separate_global_exam_records_in_first_release === false, 'D06 must not create duplicate global Exam truth.');
assert(exams.duplicate_exam_truth_store_allowed === false, 'Duplicate assessment truth is prohibited.');

for (const id of ['TCH-0088','TCH-0089','TCH-0090','TCH-0091','TCH-0092']) {
  const entry = registry.decisions[id];
  assert(entry.status === 'EXPLICITLY_DEFERRED', `${id} must remain explicitly deferred.`);
  assert(entry.decision.write_integration_authorized === false, `${id} must not authorize writes.`);
  assert(entry.downstream_deliveries.includes('D27'), `${id} must name D27 as contract owner.`);
}

assert(registry.decisions['TCH-0093'].status === 'EXPLICITLY_DEFERRED', 'Final visual-system freeze must wait for anchor validation.');

const source = registry.decisions['TCH-0691'].decision;
assert(Object.keys(source.classes).length === 6 && source.silent_drop_allowed === false, 'Source meaningfulness must close all six categories with no silent drop.');
assert(source.ai_classification_directly_authoritative === false, 'Source-classification AI cannot be authority.');

const vpk = registry.decisions['TCH-0692'].decision;
assert(vpk.student_intake_self_report_is_evidence === false, 'Student Intake cannot become VPK evidence.');
assert(vpk.minimum_independent_verification_opportunities >= 2, 'VPK needs repeated independent verification.');

const incomplete = registry.decisions['TCH-0693'].decision;
assert(incomplete.planned_end_date_implies_completion === false, 'Planned end cannot imply completion.');
assert(incomplete.incomplete_is_fail === false, 'Incomplete must remain distinct from Fail.');

const eligibility = registry.decisions['TCH-0694'].decision;
assert(Array.isArray(eligibility.first_release_graded_exceptions) && eligibility.first_release_graded_exceptions.length === 0, 'First release must have no graded eligibility loophole.');
assert(eligibility.raw_subject_scope_never_implies_eligibility === true, 'Raw Subject scope cannot imply eligibility.');
assert(eligibility.ungraded_diagnostic_may_probe_untaught_or_unvalidated_prerequisite === true, 'Non-graded Diagnostic boundary must remain explicit.');

const doc = read('docs/teaching/d06-academic-product-decision-gates.md');
const sourceResolution = read('docs/teaching/change-control/KIWI_Teaching_D06_Source_Resolution_v1.0.md');
for (const id of expected) assert(doc.includes(id), `D06 architecture doc does not account for ${id}`);
assert(sourceResolution.includes('cb7d567ab413b67c6c51502bbeef1dc28d02cc72'), 'D06 starting live main must be recorded.');
assert(sourceResolution.includes('20260926180811_teaching_d05_orchestration_service_rls'), 'D06 must record inspected Supabase migration head.');
assert(sourceResolution.includes('adds no migration'), 'D06 must explicitly record the no-migration decision.');

const d05Source = read('docs/teaching/change-control/KIWI_Teaching_D05_Authority_Source_Resolution_v1.0.md');
assert(d05Source.includes('v1.2_PPL'), 'D06 must preserve accepted D05 authority-source provenance.');

const promptControl = require('../teaching/prompt-runtime').createTeachingPromptControlPlane();
const promptStatus = promptControl.status();
assert(promptStatus.routeQualification === 'UNQUALIFIED', 'D06 must not qualify Teaching AI routes.');
assert(promptStatus.productionModelExecutionAuthorized === false, 'D06 must not authorize Teaching model execution.');

const capabilityRegistry = require('../teaching/capability-registry');
const capabilityCensus = capabilityRegistry.assertRegistryIntegrity();
assert(
  capabilityCensus.total === 170 &&
  capabilityCensus.modelEligible === 148 &&
  capabilityCensus.t0Promptless === 22 &&
  capabilityCensus.promptFamilies === 20,
  'D06 must preserve the current D03 successor 170/148/22/20 intelligence baseline.'
);
const tpf20 = capabilityRegistry.getCapability('teaching.study.class_grounded_note_generation');
assert(
  tpf20.execution_class === 'DIRECT-AI' &&
  tpf20.authority_ceiling === 'T3' &&
  tpf20.prompt_family_id === 'TPF-20',
  'D06 must preserve the late D03 TPF-20 successor capability without changing D06 policy ownership.'
);

const repoPolicySource = [
  read('teaching/policy/index.js'),
  read('teaching/policy/d06-decision-registry.json'),
].join('\n');
assert(!/(supabase|pg\.|pool\.query|INSERT\s+INTO|UPDATE\s+teaching_|DELETE\s+FROM)/i.test(repoPolicySource), 'D06 policy registry must not become a database mutation path.');
assert(!/(google-generativeai|@google\/generative-ai|openai|anthropic|gemini)/i.test(repoPolicySource), 'D06 policy code must not call a model/provider.');

console.log(`[Teaching D06 verify] PASS — 27 gates closed (${census.decided} decided, ${census.configured} configured, ${census.deferred} explicitly deferred); no new academic truth owner or cross-system write introduced.`);
