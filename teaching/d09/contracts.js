'use strict';

const crypto = require('node:crypto');
const { assertAcademicTimestamp } = require('../domain/time');
const { getTeachingDecision } = require('../policy');

const AVAILABILITY_KINDS = Object.freeze(['AVAILABLE','RECOVERY_ONLY','HARD_UNAVAILABLE']);
const BLOCK_KINDS = Object.freeze([
  'HARD_UNAVAILABLE','BREAK','HOLIDAY','TRAVEL','PROTECTED_REVISION','PROTECTED_ASSESSMENT',
]);
const DEADLINE_KINDS = Object.freeze(['HARD','FLEXIBLE']);
const RESERVE_KINDS = Object.freeze(['REVISION','ASSESSMENT']);
const TIMETABLE_STATES = Object.freeze(['PROPOSED','EDITED_PROPOSAL','APPROVED','SUPERSEDED','STALE']);
const SLOT_KINDS = Object.freeze(['CLASS','REVISION_RESERVE','ASSESSMENT_RESERVE','RECOVERY']);
const HEADROOM_POLICY = Object.freeze(getTeachingDecision('TCH-0075'));

function fail(message, code='TEACHING_D09_CONTRACT_INVALID', status=400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}
function nonEmpty(value, field, max=500) {
  const text = String(value ?? '').trim();
  if (!text) fail(field + ' is required.');
  if (Buffer.byteLength(text, 'utf8') > max) fail(field + ' is too long.');
  return text;
}
function boundedInt(value, field, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) fail(field + ' must be an integer from ' + min + ' to ' + max + '.');
  return n;
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
function assertIanaTimezone(value, field='timezone') {
  const zone = nonEmpty(value, field, 120);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date(0));
  } catch (_) {
    fail(field + ' must be a valid IANA timezone.', 'TEACHING_D09_TIMEZONE_INVALID');
  }
  return zone;
}
function iso(value, field) {
  return assertAcademicTimestamp(nonEmpty(value, field, 80), field);
}
function localTime(value, field) {
  const text = nonEmpty(value, field, 8);
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text);
  if (!match) fail(field + ' must use HH:MM local wall time.');
  return text;
}
function dateOnly(value, field) {
  if (value == null || value === '') return null;
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text + 'T00:00:00Z'))) {
    fail(field + ' must use YYYY-MM-DD.');
  }
  return text;
}
function normalizeSemester(input={}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('semester must be an object.');
  const startsAt = iso(input.startsAt, 'semester.startsAt');
  const endsAt = iso(input.endsAt, 'semester.endsAt');
  if (Date.parse(endsAt) <= Date.parse(startsAt)) fail('Semester end must be after its start.', 'TEACHING_D09_SEMESTER_RANGE_INVALID');
  return Object.freeze({
    semesterId: input.semesterId == null ? null : nonEmpty(input.semesterId, 'semester.semesterId', 200),
    name: nonEmpty(input.name, 'semester.name', 200),
    startsAt,
    endsAt,
    timezone: assertIanaTimezone(input.timezone, 'semester.timezone'),
  });
}
function normalizeAvailability(items=[]) {
  if (!Array.isArray(items) || !items.length) fail('At least one availability window is required.', 'TEACHING_D09_AVAILABILITY_REQUIRED');
  return Object.freeze(items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('availability['+index+'] must be an object.');
    const kind = nonEmpty(item.kind || 'AVAILABLE', 'availability['+index+'].kind', 40).toUpperCase();
    if (!AVAILABILITY_KINDS.includes(kind)) fail('Unsupported availability kind: ' + kind);
    const startLocal = localTime(item.startLocal, 'availability['+index+'].startLocal');
    const endLocal = localTime(item.endLocal, 'availability['+index+'].endLocal');
    if (endLocal <= startLocal) fail('Availability window must end after it starts.', 'TEACHING_D09_LOCAL_WINDOW_INVALID');
    return Object.freeze({
      dayOfWeek: boundedInt(item.dayOfWeek, 'availability['+index+'].dayOfWeek', 0, 6),
      startLocal,
      endLocal,
      kind,
      preferenceWeight: item.preferenceWeight == null ? 0 : boundedInt(item.preferenceWeight, 'availability['+index+'].preferenceWeight', -100, 100),
      effectiveStartDate: dateOnly(item.effectiveStartDate, 'availability['+index+'].effectiveStartDate'),
      effectiveEndDate: dateOnly(item.effectiveEndDate, 'availability['+index+'].effectiveEndDate'),
      label: item.label == null ? null : nonEmpty(item.label, 'availability['+index+'].label', 200),
    });
  }));
}
function normalizeBlocks(items=[]) {
  if (!Array.isArray(items)) fail('blocks must be an array.');
  return Object.freeze(items.map((item,index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('blocks['+index+'] must be an object.');
    const kind = nonEmpty(item.kind, 'blocks['+index+'].kind', 50).toUpperCase();
    if (!BLOCK_KINDS.includes(kind)) fail('Unsupported schedule block kind: ' + kind);
    const startsAt = iso(item.startsAt, 'blocks['+index+'].startsAt');
    const endsAt = iso(item.endsAt, 'blocks['+index+'].endsAt');
    if (Date.parse(endsAt) <= Date.parse(startsAt)) fail('Schedule block must end after it starts.');
    return Object.freeze({
      courseId: item.courseId == null ? null : nonEmpty(item.courseId, 'blocks['+index+'].courseId', 200),
      kind, startsAt, endsAt,
      label: item.label == null ? null : nonEmpty(item.label, 'blocks['+index+'].label', 300),
      reason: item.reason == null ? null : nonEmpty(item.reason, 'blocks['+index+'].reason', 1000),
    });
  }));
}
function normalizeDeadlines(items=[]) {
  if (!Array.isArray(items)) fail('deadlines must be an array.');
  return Object.freeze(items.map((item,index) => {
    const kind = nonEmpty(item?.kind || 'FLEXIBLE', 'deadlines['+index+'].kind', 20).toUpperCase();
    if (!DEADLINE_KINDS.includes(kind)) fail('Unsupported deadline kind: ' + kind);
    return Object.freeze({
      courseId: item?.courseId == null ? null : nonEmpty(item.courseId, 'deadlines['+index+'].courseId', 200),
      kind,
      deadlineAt: iso(item?.deadlineAt, 'deadlines['+index+'].deadlineAt'),
      label: item?.label == null ? null : nonEmpty(item.label, 'deadlines['+index+'].label', 300),
    });
  }));
}
function normalizeReserves(items=[]) {
  if (!Array.isArray(items)) fail('reserves must be an array.');
  return Object.freeze(items.map((item,index) => {
    const kind = nonEmpty(item?.kind, 'reserves['+index+'].kind', 20).toUpperCase();
    if (!RESERVE_KINDS.includes(kind)) fail('Unsupported reserve kind: ' + kind);
    return Object.freeze({
      courseId: item?.courseId == null ? null : nonEmpty(item.courseId, 'reserves['+index+'].courseId', 200),
      kind,
      minutes: boundedInt(item?.minutes, 'reserves['+index+'].minutes', 0, 100000),
      protectedStartAt: item?.protectedStartAt == null ? null : iso(item.protectedStartAt, 'reserves['+index+'].protectedStartAt'),
      protectedEndAt: item?.protectedEndAt == null ? null : iso(item.protectedEndAt, 'reserves['+index+'].protectedEndAt'),
    });
  }));
}
function normalizePreferences(value={}) {
  if (value == null) return Object.freeze({});
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('preferences must be an object.');
  const preferredStartTimes = Array.isArray(value.preferredStartTimes)
    ? value.preferredStartTimes.slice(0,14).map((v,i)=>localTime(v,'preferences.preferredStartTimes['+i+']'))
    : [];
  return Object.freeze({
    preferredStartTimes: Object.freeze([...new Set(preferredStartTimes)]),
    avoidConsecutiveSameCourseDays: value.avoidConsecutiveSameCourseDays !== false,
    preferredDays: Object.freeze(Array.isArray(value.preferredDays) ? [...new Set(value.preferredDays.map((v,i)=>boundedInt(v,'preferences.preferredDays['+i+']',0,6)))] : []),
  });
}
function normalizeScheduleInputs(input={}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Schedule inputs must be an object.');
  return Object.freeze({
    semester: normalizeSemester(input.semester || {}),
    availability: normalizeAvailability(input.availability || []),
    blocks: normalizeBlocks(input.blocks || []),
    deadlines: normalizeDeadlines(input.deadlines || []),
    reserves: normalizeReserves(input.reserves || []),
    preferences: normalizePreferences(input.preferences || {}),
  });
}
function instructionalMinutes(unit) {
  const treatment = String(unit?.metadata?.instructional_treatment || 'FULL_INSTRUCTION');
  const min = Math.max(0, Number(unit?.instructional_load_min_minutes) || 0);
  const max = Math.max(min, Number(unit?.instructional_load_max_minutes) || min);
  if (treatment === 'VALIDATED_PRIOR_KNOWLEDGE_NO_INITIAL_INSTRUCTION') return Object.freeze({ min:0, max:0, treatment });
  if (treatment === 'COMPRESSED_INSTRUCTION') return Object.freeze({ min, max:min, treatment });
  return Object.freeze({ min, max, treatment });
}
function headroomPolicy() {
  const decision = HEADROOM_POLICY.decision;
  return Object.freeze({
    policyVersion: HEADROOM_POLICY.policy_version,
    targetRatio: Number(decision.target_headroom_ratio),
    minimumRatio: Number(decision.minimum_headroom_ratio),
    coreCapacityCeilingAtTarget: Number(decision.core_work_capacity_ceiling_at_target),
    belowMinimumBehavior: decision.below_minimum_behavior,
  });
}
function assertCurrentCoursePlan(course, plan, scopeChanges=[]) {
  if (!plan) fail('A current Course Plan is required before timetable feasibility can be calculated.', 'TEACHING_D09_CURRENT_COURSE_PLAN_REQUIRED', 409);
  if (String(plan.source_snapshot_ref || '') !== String(course.subject_snapshot_ref || '')) fail('Course Plan source snapshot is stale.', 'TEACHING_D09_COURSE_PLAN_STALE', 409);
  if (String(plan.plan_state) === 'REVIEW_REQUIRED' || String(plan.plan_state) === 'SUPERSEDED') fail('Course Plan requires review before scheduling.', 'TEACHING_D09_COURSE_PLAN_REVIEW_REQUIRED', 409);
  if (scopeChanges.some((row)=>['PENDING_PLAN_UPDATE','ADOPTED_PENDING_AUDIT'].includes(row.status))) {
    fail('A Course scope change is pending re-planning.', 'TEACHING_D09_SCOPE_CHANGE_PENDING', 409);
  }
  return true;
}
function assertSchedulingContextCurrent(expected, current) {
  const stale=[];
  const expectedSemester=expected?.semester, currentSemester=current?.semester;
  if(!expectedSemester || !currentSemester
    || String(expectedSemester.semester_id)!==String(currentSemester.semester_id)
    || Number(expectedSemester.state_version)!==Number(currentSemester.state_version)) {
    stale.push('SEMESTER');
  }
  const expectedProfile=expected?.profile, currentProfile=current?.profile;
  if(!expectedProfile || !currentProfile
    || String(expectedProfile.profile_id)!==String(currentProfile.profile_id)
    || Number(expectedProfile.version_no)!==Number(currentProfile.version_no)
    || Number(expectedProfile.semester_state_version)!==Number(currentProfile.semester_state_version)) {
    stale.push('SCHEDULE_PROFILE');
  }
  const currentCourses=new Map((current?.courses||[]).map((bundle)=>[String(bundle.course?.course_id),bundle]));
  const expectedCourseIds=new Set([
    ...(expected?.courses||[]).map((bundle)=>String(bundle.course?.course_id||'')),
    ...(expected?.unresolvedCourses||[]).map((item)=>String(item.courseId||'')),
  ].filter(Boolean));
  const currentCourseIds=new Set(currentCourses.keys());
  if(expectedCourseIds.size!==currentCourseIds.size
    || [...expectedCourseIds].some((courseId)=>!currentCourseIds.has(courseId))) {
    stale.push('SEMESTER_COURSE_SET');
  }
  for(const bundle of expected?.courses||[]){
    const courseId=String(bundle.course?.course_id||'');
    const now=currentCourses.get(courseId);
    if(!now
      || Number(bundle.course?.state_version)!==Number(now.course?.state_version)
      || String(bundle.course?.semester_id||'')!==String(now.course?.semester_id||'')) {
      stale.push('COURSE:'+courseId);
      continue;
    }
    if(!now.plan
      || String(bundle.plan?.course_plan_id)!==String(now.plan?.course_plan_id)
      || Number(bundle.plan?.version_no)!==Number(now.plan?.version_no)
      || String(bundle.plan?.source_snapshot_ref||'')!==String(now.plan?.source_snapshot_ref||'')
      || ['REVIEW_REQUIRED','SUPERSEDED'].includes(String(now.plan?.plan_state))) {
      stale.push('COURSE_PLAN:'+courseId);
    }
  }
  for(const unresolved of expected?.unresolvedCourses||[]){
    const courseId=String(unresolved.courseId||'');
    const now=currentCourses.get(courseId);
    if(!now
      || (unresolved.stateVersion!=null && Number(unresolved.stateVersion)!==Number(now.course?.state_version))
      || now.plan) {
      stale.push('UNRESOLVED_COURSE:'+courseId);
    }
  }
  if(stale.length){
    const error=new Error('Scheduling inputs changed while the timetable was being calculated. Recalculate from current authoritative state.');
    error.code='TEACHING_D09_STALE_SCHEDULING_CONTEXT';
    error.status=409;
    error.staleRefs=Object.freeze([...new Set(stale)]);
    throw error;
  }
  return true;
}

module.exports = {
  AVAILABILITY_KINDS,BLOCK_KINDS,DEADLINE_KINDS,RESERVE_KINDS,TIMETABLE_STATES,SLOT_KINDS,
  fail,digest,assertIanaTimezone,normalizeSemester,normalizeAvailability,normalizeBlocks,
  normalizeDeadlines,normalizeReserves,normalizePreferences,normalizeScheduleInputs,
  instructionalMinutes,headroomPolicy,assertCurrentCoursePlan,assertSchedulingContextCurrent,
};