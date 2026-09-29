'use strict';

const CONTROLLER_LIFECYCLE = Object.freeze({
  ACTIVE: 'ACTIVE',
  INTERRUPTED: 'INTERRUPTED',
  CLOSED: 'CLOSED',
});

const INSTRUCTIONAL_SUBSTATES = Object.freeze([
  'OPENING',
  'DIAGNOSTIC',
  'INSTRUCTION',
  'GUIDED_PRACTICE',
  'INDEPENDENT_PRACTICE',
  'CLASSWORK',
  'REMEDIATION',
  'BREAK',
  'ASSESSMENT',
  'CLOSURE',
  'INTERRUPTED',
]);

const LEARNING_EVIDENCE_DESCRIPTORS = Object.freeze([
  'DEMONSTRATION',
  'GUIDED',
  'INDEPENDENT_FAMILIAR',
  'INDEPENDENT_VARIED',
  'METHOD_SELECTION',
  'DELAYED_RETRIEVAL',
  'INTEGRATION_TRANSFER',
]);

const OBJECTIVE_CRITICALITY = Object.freeze(['CORE','SECONDARY','ENRICHMENT']);
const ASSISTANCE_LEVELS = Object.freeze(['NONE','LIGHT','GUIDED','MODELED']);
const INSTRUCTION_CYCLE_PHASES = Object.freeze(['TEACH','ELICIT_CHECK','DIAGNOSE','RESPOND','VERIFY']);

const PRIORITY_ORDER = Object.freeze([
  'CONCEPTUAL_CORRECTNESS',
  'BLOCKING_PREREQUISITES',
  'CORE_OBJECTIVES',
  'INDEPENDENT_EVIDENCE',
  'TIMING',
  'SECONDARY_OBJECTIVES',
  'ENRICHMENT',
]);

const NORMAL_TEACHING_STATES = Object.freeze(new Set([
  'OPENING','DIAGNOSTIC','INSTRUCTION','GUIDED_PRACTICE',
  'INDEPENDENT_PRACTICE','CLASSWORK','REMEDIATION',
]));

function fail(message, code = 'TEACHING_D11_CONTRACT_INVALID', status = 422) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

function nonEmpty(value, field) {
  const normalized = String(value == null ? '' : value).trim();
  if (!normalized) fail(field + ' is required.', 'TEACHING_D11_FIELD_REQUIRED', 400);
  return normalized;
}

function integer(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    fail(field + ' must be an integer between ' + min + ' and ' + max + '.', 'TEACHING_D11_NUMBER_INVALID', 400);
  }
  return n;
}

function toIso(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) fail(field + ' must be an ISO-compatible timestamp.', 'TEACHING_D11_TIME_INVALID', 400);
  return date.toISOString();
}

function freezeDeep(value) {
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) return Object.freeze(value.map(freezeDeep));
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = freezeDeep(item);
    return Object.freeze(out);
  }
  return value;
}

function normalizeStringArray(value, field, { allowEmpty = true } = {}) {
  if (!Array.isArray(value)) fail(field + ' must be an array.', 'TEACHING_D11_SCHEMA_INVALID');
  const out = value.map((item) => nonEmpty(item, field));
  if (!allowEmpty && out.length === 0) fail(field + ' must not be empty.', 'TEACHING_D11_SCHEMA_INVALID');
  if (new Set(out).size !== out.length) fail(field + ' must not contain duplicates.', 'TEACHING_D11_SCHEMA_INVALID');
  return Object.freeze(out);
}

function normalizeObjective(item, index, allowedUnits) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) fail('Objective entry is invalid.', 'TEACHING_D11_BLUEPRINT_SCHEMA_INVALID');
  const id = nonEmpty(item.id || item.objective_id, 'objective.id');
  const learningUnitRef = nonEmpty(item.learning_unit_ref, 'objective.learning_unit_ref');
  if (allowedUnits && !allowedUnits.has(learningUnitRef)) {
    fail('Lesson objective references a Learning Unit outside the current Course Plan: ' + learningUnitRef, 'TEACHING_D11_BLUEPRINT_SCOPE_INVALID');
  }
  const criticality = String(item.criticality || 'CORE').toUpperCase();
  if (!OBJECTIVE_CRITICALITY.includes(criticality)) fail('Invalid objective criticality.', 'TEACHING_D11_BLUEPRINT_SCHEMA_INVALID');
  return freezeDeep({
    id,
    learning_unit_ref: learningUnitRef,
    label: nonEmpty(item.label || item.title || ('Objective ' + (index + 1)), 'objective.label'),
    criticality,
    minimum_safe_minutes: integer(item.minimum_safe_minutes == null ? 0 : item.minimum_safe_minutes, 'objective.minimum_safe_minutes', { min: 0, max: 240 }),
    prerequisite_refs: normalizeStringArray(item.prerequisite_refs || [], 'objective.prerequisite_refs'),
    evidence_descriptor_targets: normalizeStringArray(item.evidence_descriptor_targets || [], 'objective.evidence_descriptor_targets')
      .map((descriptor) => {
        const normalized = descriptor.toUpperCase();
        if (!LEARNING_EVIDENCE_DESCRIPTORS.includes(normalized)) fail('Unknown learning/evidence descriptor: ' + descriptor, 'TEACHING_D11_DESCRIPTOR_INVALID');
        return normalized;
      }),
    independent_evidence_required: criticality === 'CORE' ? item.independent_evidence_required !== false : item.independent_evidence_required === true,
  });
}

function normalizeSegment(item, index, objectiveIds) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) fail('Lesson segment entry is invalid.', 'TEACHING_D11_BLUEPRINT_SCHEMA_INVALID');
  const criticality = String(item.criticality || 'SECONDARY').toUpperCase();
  if (!OBJECTIVE_CRITICALITY.includes(criticality)) fail('Invalid segment criticality.', 'TEACHING_D11_BLUEPRINT_SCHEMA_INVALID');
  const descriptor = item.learning_evidence_descriptor == null ? null : String(item.learning_evidence_descriptor).toUpperCase();
  if (descriptor && !LEARNING_EVIDENCE_DESCRIPTORS.includes(descriptor)) fail('Invalid segment learning/evidence descriptor.', 'TEACHING_D11_DESCRIPTOR_INVALID');
  const assistance = String(item.assistance_level || 'NONE').toUpperCase();
  if (!ASSISTANCE_LEVELS.includes(assistance)) fail('Invalid assistance level.', 'TEACHING_D11_ASSISTANCE_INVALID');
  const objectiveRefs = normalizeStringArray(item.objective_refs || [], 'segment.objective_refs');
  if (objectiveRefs.some((ref) => !objectiveIds.has(ref))) fail('Lesson segment references an unknown objective.', 'TEACHING_D11_BLUEPRINT_OBJECTIVE_REF_INVALID');
  const planned = integer(item.planned_minutes, 'segment.planned_minutes', { min: 1, max: 240 });
  const minimumSafe = integer(item.minimum_safe_minutes == null ? planned : item.minimum_safe_minutes, 'segment.minimum_safe_minutes', { min: 0, max: planned });
  const optional = item.optional === true;
  if (criticality === 'CORE' && optional) fail('Core lesson segments cannot be marked optional.', 'TEACHING_D11_CORE_OPTIONAL_FORBIDDEN');
  return freezeDeep({
    id: nonEmpty(item.id || item.segment_id || ('segment-' + (index + 1)), 'segment.id'),
    kind: nonEmpty(item.kind || 'INSTRUCTION', 'segment.kind').toUpperCase(),
    objective_refs: objectiveRefs,
    planned_minutes: planned,
    minimum_safe_minutes: minimumSafe,
    criticality,
    optional,
    learning_evidence_descriptor: descriptor,
    assistance_level: assistance,
    representation: item.representation == null ? null : String(item.representation).trim(),
    stopping_condition: item.stopping_condition == null ? null : String(item.stopping_condition).trim(),
  });
}

function normalizeLessonBlueprintProposal(output, { learningUnits = [], scheduledStartAt, scheduledEndAt, minimumReserveMinutes = 1 } = {}) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) fail('Lesson Blueprint output must be an object.', 'TEACHING_D11_BLUEPRINT_SCHEMA_INVALID');
  const status = String(output.status || 'OK').toUpperCase();
  if (!['OK','REVIEW_NEEDED','INSUFFICIENT_EVIDENCE','UNRESOLVED_CONFLICT'].includes(status)) {
    fail('Lesson Blueprint status is invalid.', 'TEACHING_D11_BLUEPRINT_SCHEMA_INVALID');
  }
  const allowedUnits = new Set((learningUnits || []).map((unit) => String(unit.learning_unit_id || unit.id || unit.learning_unit_ref)));
  const objectivesRaw = Array.isArray(output.objectives)
    ? output.objectives
    : [...(output.primary_objectives || []), ...(output.secondary_objectives || [])];
  if (!objectivesRaw.length) fail('Lesson Blueprint requires at least one objective.', 'TEACHING_D11_BLUEPRINT_OBJECTIVE_REQUIRED');
  const objectives = objectivesRaw.map((item, index) => normalizeObjective(item, index, allowedUnits));
  const objectiveIds = new Set(objectives.map((item) => item.id));
  if (objectiveIds.size !== objectives.length) fail('Lesson objective identifiers must be unique.', 'TEACHING_D11_BLUEPRINT_OBJECTIVE_DUPLICATE');
  if (!objectives.some((item) => item.criticality === 'CORE')) fail('Lesson Blueprint requires at least one CORE objective.', 'TEACHING_D11_BLUEPRINT_CORE_REQUIRED');

  const segmentsRaw = Array.isArray(output.segments) ? output.segments : (output.planned_segments || []);
  if (!segmentsRaw.length) fail('Lesson Blueprint requires planned segments.', 'TEACHING_D11_BLUEPRINT_SEGMENTS_REQUIRED');
  const segments = segmentsRaw.map((item, index) => normalizeSegment(item, index, objectiveIds));
  const segmentIds = new Set(segments.map((item) => item.id));
  if (segmentIds.size !== segments.length) fail('Lesson segment identifiers must be unique.', 'TEACHING_D11_BLUEPRINT_SEGMENT_DUPLICATE');

  const scheduledMinutes = Math.max(0, Math.floor((new Date(scheduledEndAt).getTime() - new Date(scheduledStartAt).getTime()) / 60000));
  if (!Number.isFinite(scheduledMinutes) || scheduledMinutes <= 0) fail('Authoritative Class duration is invalid.', 'TEACHING_D11_CLASS_DURATION_INVALID');
  const minimumReserve = integer(minimumReserveMinutes, 'minimumReserveMinutes', { min: 1, max: scheduledMinutes });
  const adaptiveReserveMinutes = integer(output.adaptive_reserve_minutes, 'adaptive_reserve_minutes', { min: minimumReserve, max: scheduledMinutes });
  const plannedMinutes = segments.reduce((sum, item) => sum + item.planned_minutes, 0);
  const minimumSafeMinutes = segments.filter((item) => item.criticality === 'CORE').reduce((sum, item) => sum + item.minimum_safe_minutes, 0);
  if (plannedMinutes + adaptiveReserveMinutes > scheduledMinutes) {
    fail('Lesson Blueprint exceeds the authoritative Class duration.', 'TEACHING_D11_BLUEPRINT_DURATION_OVERFLOW');
  }
  if (minimumSafeMinutes > scheduledMinutes) fail('Core minimum safe load exceeds the Class duration.', 'TEACHING_D11_MINIMUM_SAFE_LOAD_INFEASIBLE');

  const reviewRequired = output.review_required === true || status !== 'OK';
  return freezeDeep({
    status,
    review_required: reviewRequired,
    review_reasons: normalizeStringArray(output.review_reasons || [], 'review_reasons'),
    objectives,
    segments,
    adaptive_reserve_minutes: adaptiveReserveMinutes,
    minimum_reserve_minutes: minimumReserve,
    planned_minutes: plannedMinutes,
    minimum_safe_core_minutes: minimumSafeMinutes,
    scheduled_minutes: scheduledMinutes,
    stopping_conditions: normalizeStringArray(output.stopping_conditions || [], 'stopping_conditions'),
    prerequisite_checks: freezeDeep(Array.isArray(output.prerequisite_checks) ? output.prerequisite_checks : []),
    likely_misconceptions: freezeDeep(Array.isArray(output.likely_misconceptions) ? output.likely_misconceptions : []),
    homework_candidates: freezeDeep(Array.isArray(output.homework_candidates) ? output.homework_candidates : []),
    unresolved_items: freezeDeep(Array.isArray(output.unresolved_items) ? output.unresolved_items : []),
    priority_order: PRIORITY_ORDER,
    descriptors_are_planning_evidence_labels_not_skm_states: true,
    assistance_is_separate_dimension: true,
  });
}

function validateLessonBlueprintProposal(output, context) {
  try {
    const value = normalizeLessonBlueprintProposal(output, context);
    if (value.review_required) return { ok: false, reason: 'TEACHING_D11_BLUEPRINT_REVIEW_REQUIRED', value };
    return { ok: true, value };
  } catch (error) {
    return { ok: false, reason: error.code || 'TEACHING_D11_BLUEPRINT_INVALID', message: error.message };
  }
}

function assertTransitionAllowed({ lifecycleState, fromState, toState, resumeState = null } = {}) {
  const lifecycle = nonEmpty(lifecycleState, 'lifecycleState').toUpperCase();
  const from = nonEmpty(fromState, 'fromState').toUpperCase();
  const to = nonEmpty(toState, 'toState').toUpperCase();
  if (!INSTRUCTIONAL_SUBSTATES.includes(from) || !INSTRUCTIONAL_SUBSTATES.includes(to)) fail('Unknown instructional substate.', 'TEACHING_D11_SUBSTATE_INVALID');
  if (lifecycle === CONTROLLER_LIFECYCLE.CLOSED || from === 'CLOSURE') fail('Closed/CLOSURE Controller state is terminal.', 'TEACHING_D11_CONTROLLER_TERMINAL', 409);
  if (from === 'BREAK') {
    if (to !== String(resumeState || '').toUpperCase()) fail('Break may resume only to its recorded pre-break instructional state.', 'TEACHING_D11_BREAK_RESUME_TARGET_INVALID', 409);
    return true;
  }
  if (from === 'INTERRUPTED') {
    if (![String(resumeState || '').toUpperCase(), 'CLOSURE'].includes(to)) fail('Interrupted Class may resume only to its recorded prior state or Closure.', 'TEACHING_D11_INTERRUPTION_RESUME_TARGET_INVALID', 409);
    return true;
  }
  if (to === 'BREAK' || to === 'INTERRUPTED' || to === 'CLOSURE') return true;
  if (from === 'ASSESSMENT') {
    if (!['CLOSURE','INTERRUPTED'].includes(to)) fail('Assessment mode cannot transition into assisted teaching states.', 'TEACHING_D11_ASSESSMENT_ASSISTANCE_BOUNDARY', 409);
    return true;
  }
  if (!NORMAL_TEACHING_STATES.has(from) || !NORMAL_TEACHING_STATES.has(to)) fail('Illegal instructional transition.', 'TEACHING_D11_TRANSITION_FORBIDDEN', 409);
  return true;
}

function classTimeEnvelope({ scheduledStartAt, scheduledEndAt, overtimeCeilingAt = null, serverNow = new Date() } = {}) {
  const start = new Date(toIso(scheduledStartAt, 'scheduledStartAt'));
  const end = new Date(toIso(scheduledEndAt, 'scheduledEndAt'));
  const now = new Date(toIso(serverNow, 'serverNow'));
  if (end <= start) fail('Class schedule is invalid.', 'TEACHING_D11_CLASS_DURATION_INVALID');
  let ceiling = end;
  if (overtimeCeilingAt != null) {
    const requestedCeiling = new Date(toIso(overtimeCeilingAt, 'overtimeCeilingAt'));
    const absolute = new Date(end.getTime() + 15 * 60_000);
    if (requestedCeiling > absolute) fail('Overtime may never exceed fifteen minutes.', 'TEACHING_D11_OVERTIME_CEILING_EXCEEDED', 409);
    if (requestedCeiling > end) ceiling = requestedCeiling;
  }
  const remainingMs = Math.max(0, ceiling.getTime() - now.getTime());
  return freezeDeep({
    scheduled_start_at: start.toISOString(),
    scheduled_end_at: end.toISOString(),
    authoritative_end_at: ceiling.toISOString(),
    server_now: now.toISOString(),
    before_start: now < start,
    scheduled_time_elapsed: now >= end,
    absolute_overtime_ceiling_at: new Date(end.getTime() + 15 * 60_000).toISOString(),
    remaining_minutes: Math.ceil(remainingMs / 60000),
    time_authority: 'SERVER',
  });
}

function computeOvertimeCeiling({ scheduledEndAt, requestedMinutes, serverNow = new Date() } = {}) {
  const end = new Date(toIso(scheduledEndAt, 'scheduledEndAt'));
  const now = new Date(toIso(serverNow, 'serverNow'));
  const minutes = integer(requestedMinutes, 'requestedMinutes', { min: 1, max: 15 });
  if (now > new Date(end.getTime() + 15 * 60_000)) fail('Class overtime window has already expired.', 'TEACHING_D11_OVERTIME_WINDOW_EXPIRED', 409);
  return new Date(end.getTime() + minutes * 60_000).toISOString();
}

function validateLiveReplanProposal(output, { blueprintContext, remainingMinutes, completedObjectiveRefs = [] } = {}) {
  const base = normalizeLessonBlueprintProposal(output, blueprintContext);
  if (base.planned_minutes + base.adaptive_reserve_minutes > Number(remainingMinutes)) {
    fail('Live replan does not fit the remaining authoritative Class time.', 'TEACHING_D11_REPLAN_TIME_OVERFLOW');
  }
  const completed = new Set((completedObjectiveRefs || []).map(String));
  const unresolvedCore = (blueprintContext.currentBlueprint?.objectives || [])
    .filter((objective) => objective.criticality === 'CORE' && !completed.has(String(objective.id)));
  const nextIds = new Set(base.objectives.map((objective) => objective.id));
  const droppedCore = unresolvedCore.filter((objective) => !nextIds.has(String(objective.id)));
  if (droppedCore.length) fail('Live replanning cannot silently remove unfinished CORE objectives.', 'TEACHING_D11_REPLAN_CORE_DROPPED');
  return base;
}

function nextInstructionCyclePhase(current) {
  const normalized = String(current || 'TEACH').toUpperCase();
  const index = INSTRUCTION_CYCLE_PHASES.indexOf(normalized);
  if (index < 0) fail('Unknown instruction cycle phase.', 'TEACHING_D11_CYCLE_PHASE_INVALID');
  return INSTRUCTION_CYCLE_PHASES[(index + 1) % INSTRUCTION_CYCLE_PHASES.length];
}

function buildClosureFactPack({ session, classRow, blueprint, progressState = {}, evidenceEvents = [], history = [], serverNow = new Date(), reason } = {}) {
  const completedSegments = Array.isArray(progressState.completed_segment_refs) ? progressState.completed_segment_refs.map(String) : [];
  const completedObjectives = Array.isArray(progressState.completed_objective_refs) ? progressState.completed_objective_refs.map(String) : [];
  const evidenceRefs = evidenceEvents.map((row) => String(row.evidence_event_id));
  const blueprintPayload = blueprint?.blueprint_payload || {};
  const objectives = Array.isArray(blueprintPayload.objectives) ? blueprintPayload.objectives : [];
  const unfinishedCore = objectives
    .filter((objective) => String(objective.criticality).toUpperCase() === 'CORE' && !completedObjectives.includes(String(objective.id)))
    .map((objective) => String(objective.id));
  return freezeDeep({
    schema_version: 'd11.class-fact-pack.v1',
    class_id: classRow.class_id,
    class_session_id: session.class_session_id,
    course_id: classRow.course_id,
    lesson_blueprint_id: blueprint?.lesson_blueprint_id || null,
    lesson_blueprint_version: blueprint?.version_no == null ? null : Number(blueprint.version_no),
    scheduled_start_at: toIso(classRow.scheduled_start_at, 'scheduled_start_at'),
    scheduled_end_at: toIso(classRow.scheduled_end_at, 'scheduled_end_at'),
    actual_started_at: session.started_at == null ? null : toIso(session.started_at, 'started_at'),
    actual_ended_at: toIso(serverNow, 'serverNow'),
    closure_reason: nonEmpty(reason || 'CONTROLLER_CLOSURE', 'closure_reason'),
    completed_segment_refs: Object.freeze(completedSegments),
    completed_objective_refs: Object.freeze(completedObjectives),
    unfinished_core_objective_refs: Object.freeze(unfinishedCore),
    evidence_event_refs: Object.freeze(evidenceRefs),
    independent_evidence_objective_refs: Object.freeze((progressState.independent_evidence_objective_refs || []).map(String)),
    cycle_phase_at_close: session.cycle_phase || null,
    learning_evidence_descriptor_at_close: session.current_learning_evidence_descriptor || null,
    assistance_level_at_close: session.current_assistance_level || null,
    interruption_count: history.filter((entry) => entry.to_state === 'INTERRUPTED').length,
    break_count: history.filter((entry) => entry.to_state === 'BREAK').length,
    overtime_used: Boolean(session.overtime_started_at),
    overtime_ceiling_at: session.overtime_ceiling_at == null ? null : toIso(session.overtime_ceiling_at, 'overtime_ceiling_at'),
    official_marks_included: false,
    mastery_claim_included: false,
    attendance_outcome_included: false,
    uncertainty_preserved: true,
  });
}

module.exports = {
  CONTROLLER_LIFECYCLE,
  INSTRUCTIONAL_SUBSTATES,
  LEARNING_EVIDENCE_DESCRIPTORS,
  OBJECTIVE_CRITICALITY,
  ASSISTANCE_LEVELS,
  INSTRUCTION_CYCLE_PHASES,
  PRIORITY_ORDER,
  normalizeLessonBlueprintProposal,
  validateLessonBlueprintProposal,
  validateLiveReplanProposal,
  assertTransitionAllowed,
  classTimeEnvelope,
  computeOvertimeCeiling,
  nextInstructionCyclePhase,
  buildClosureFactPack,
  freezeDeep,
  toIso,
};
