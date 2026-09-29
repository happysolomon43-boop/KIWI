'use strict';

const { assertAcademicTimestamp } = require('../domain/time');

const COURSE_LIFECYCLE = Object.freeze([
  'DRAFT','READY','ACTIVE','PAUSED','TEACHING_ENDED','FINALIZING','INCOMPLETE','COMPLETED','ARCHIVED',
]);

const COURSE_TRANSITIONS = Object.freeze({
  DRAFT: Object.freeze(['READY']),
  READY: Object.freeze(['ACTIVE']),
  ACTIVE: Object.freeze(['PAUSED','TEACHING_ENDED']),
  PAUSED: Object.freeze(['ACTIVE','TEACHING_ENDED']),
  TEACHING_ENDED: Object.freeze(['FINALIZING']),
  FINALIZING: Object.freeze(['INCOMPLETE','COMPLETED']),
  INCOMPLETE: Object.freeze(['FINALIZING']),
  COMPLETED: Object.freeze(['ARCHIVED']),
  ARCHIVED: Object.freeze([]),
});

const COURSE_STATUS_OVERLAYS = Object.freeze([
  'SCHEDULE_AT_RISK','ATTENDANCE_CONCERN','RECOVERY_CAPACITY_LOW','ASSESSMENT_PENDING','COURSE_SCOPE_UPDATE_PENDING',
]);

const PROGRESSION_OUTCOMES = Object.freeze([
  'PASS','PASS_REMEDIATION_REQUIRED','RESIT_REQUIRED','RECOVERY_REQUIRED','REPEAT_REQUIRED','INCOMPLETE',
]);

const REQUEST_STATES = Object.freeze([
  'DRAFT','SUBMITTED','REVIEWING','APPROVED','APPROVED_WITH_ADJUSTMENT','ALTERNATIVE_PROPOSED','REJECTED','WITHDRAWN','APPLIED','CLOSED',
]);

const REQUEST_TRANSITIONS = Object.freeze({
  DRAFT: Object.freeze(['SUBMITTED','WITHDRAWN']),
  SUBMITTED: Object.freeze(['REVIEWING','WITHDRAWN']),
  REVIEWING: Object.freeze(['APPROVED','APPROVED_WITH_ADJUSTMENT','ALTERNATIVE_PROPOSED','REJECTED','WITHDRAWN']),
  APPROVED: Object.freeze(['APPLIED','CLOSED']),
  APPROVED_WITH_ADJUSTMENT: Object.freeze(['APPLIED','CLOSED']),
  ALTERNATIVE_PROPOSED: Object.freeze(['APPROVED_WITH_ADJUSTMENT','CLOSED','WITHDRAWN']),
  REJECTED: Object.freeze(['CLOSED']),
  WITHDRAWN: Object.freeze(['CLOSED']),
  APPLIED: Object.freeze(['CLOSED']),
  CLOSED: Object.freeze([]),
});

const REQUEST_TYPES = Object.freeze({
  SINGLE_CLASS_RESCHEDULE: Object.freeze({ owner:'scheduler', target:'CLASS', implementedOwner:true }),
  PERMANENT_AVAILABILITY_CHANGE: Object.freeze({ owner:'scheduler', target:'COURSE', implementedOwner:true }),
  ACADEMIC_BREAK: Object.freeze({ owner:'scheduler', target:'COURSE', implementedOwner:true }),
  EMERGENCY_ABSENCE: Object.freeze({ owner:'attendance', target:'CLASS', implementedOwner:false, emergency:true }),
  COURSE_PAUSE: Object.freeze({ owner:'course_lifecycle', target:'COURSE', implementedOwner:true }),
  COURSE_RESUME: Object.freeze({ owner:'course_lifecycle', target:'COURSE', implementedOwner:true }),
  REDUCED_LOAD_WEEK: Object.freeze({ owner:'scheduler', target:'COURSE', implementedOwner:false, releaseDecision:'UNRESOLVED' }),
  TEACHER_CHANGE: Object.freeze({ owner:'teacher_identity', target:'COURSE', implementedOwner:true }),
  ASSIGNMENT_EXTENSION: Object.freeze({ owner:'work', target:'ASSIGNMENT', implementedOwner:false }),
  EARLY_DISMISSAL: Object.freeze({ owner:'attendance', target:'CLASS', implementedOwner:false }),
  ATTENDANCE_REVIEW_CORRECTION: Object.freeze({ owner:'attendance', target:'CLASS', implementedOwner:false }),
  COURSE_CANCELLATION: Object.freeze({ owner:'course_lifecycle', target:'COURSE', implementedOwner:true }),
});

const ADMISSION_POLICY = Object.freeze({
  policyVersion:'four-course-launch.v1',
  maximumConcurrentCourses:4,
  countedLifecycleStates:Object.freeze(['READY','ACTIVE','PAUSED','INCOMPLETE']),
  excludedLifecycleStates:Object.freeze(['DRAFT','COMPLETED','ARCHIVED']),
  unresolvedIncompleteCounts:true,
  schemaMaximum:false,
  oneStudentIdentity:true,
});

const DEFAULT_GRADING_POLICY = Object.freeze({
  policyKind:'KIWI_DEFAULT',
  policyVersionRef:'kiwi-default-grading.v1',
  categoryWeights:Object.freeze({
    CLASSWORK:0.10,
    HOMEWORK:0.05,
    GRADED_IMPROMPTU:0.10,
    SCHEDULED_TESTS:0.15,
    MID_SEMESTER:0.20,
    FINAL_EXAMINATION:0.40,
  }),
  rules:Object.freeze({
    fixedCategoryBudgets:true,
    onlyExplicitlyGradedActivityCounts:true,
    calculationOwner:'GRADEBOOK_D20',
    d10Posture:'DECLARATION_AND_ACTIVATION_LOCK_ONLY',
  }),
});

function fail(message, code, status=422, details=null) {
  const error = new Error(message);
  error.code=code;
  error.status=status;
  if(details) error.details=details;
  return error;
}

function normalizeLifecycle(value) {
  const state=String(value||'').trim().toUpperCase().replaceAll(' ','_');
  if(!COURSE_LIFECYCLE.includes(state)) throw fail('Unsupported Course lifecycle state.','TEACHING_D10_COURSE_STATE_INVALID');
  return state;
}

function assertCourseTransition(from,to) {
  const current=normalizeLifecycle(from);
  const next=normalizeLifecycle(to);
  if(!COURSE_TRANSITIONS[current].includes(next)) throw fail(
    `Course lifecycle cannot transition from ${current} to ${next}.`,
    'TEACHING_D10_COURSE_TRANSITION_INVALID',409,{from:current,to:next}
  );
  return Object.freeze({from:current,to:next});
}

function normalizeRequestState(value) {
  const state=String(value||'').trim().toUpperCase().replaceAll(' ','_');
  if(!REQUEST_STATES.includes(state)) throw fail('Unsupported Request lifecycle state.','TEACHING_D10_REQUEST_STATE_INVALID');
  return state;
}

function assertRequestTransition(from,to) {
  const current=normalizeRequestState(from);
  const next=normalizeRequestState(to);
  if(!REQUEST_TRANSITIONS[current].includes(next)) throw fail(
    `Request cannot transition from ${current} to ${next}.`,
    'TEACHING_D10_REQUEST_TRANSITION_INVALID',409,{from:current,to:next}
  );
  return Object.freeze({from:current,to:next});
}

function requestDefinition(type) {
  const normalized=String(type||'').trim().toUpperCase();
  const definition=REQUEST_TYPES[normalized];
  if(!definition) throw fail('Unsupported Teaching Request type.','TEACHING_D10_REQUEST_TYPE_INVALID',400);
  if(definition.releaseDecision==='UNRESOLVED') throw fail(
    'Reduced Load Week is not enabled because the frozen release-policy decision remains unresolved.',
    'TEACHING_D10_REDUCED_LOAD_WEEK_NOT_RETAINED',409
  );
  return Object.freeze({type:normalized,...definition});
}

function object(value, field) {
  if(value==null) return {};
  if(typeof value!=='object'||Array.isArray(value)) throw fail(`${field} must be an object.`,'TEACHING_D10_REQUEST_PAYLOAD_INVALID',400);
  return {...value};
}
function string(value, field, {required=true,max=500}={}) {
  const out=String(value??'').trim();
  if(required&&!out) throw fail(`${field} is required.`,'TEACHING_D10_REQUEST_PAYLOAD_INVALID',400);
  if(out.length>max) throw fail(`${field} is too long.`,'TEACHING_D10_REQUEST_PAYLOAD_INVALID',400);
  return out||null;
}

function normalizeRequestedChange(type,input={}) {
  const def=requestDefinition(type);
  const raw=object(input,'requestedChange');
  const change={};
  if(def.target==='CLASS') change.classId=string(raw.classId,'requestedChange.classId');
  if(def.target==='ASSIGNMENT') {
    change.assignmentRef=string(raw.assignmentRef,'requestedChange.assignmentRef');
    change.assignmentVersion=string(raw.assignmentVersion,'requestedChange.assignmentVersion',{required:false,max:120});
  }
  switch(def.type){
    case 'SINGLE_CLASS_RESCHEDULE':
      change.startsAt=assertAcademicTimestamp(raw.startsAt,'requestedChange.startsAt');
      change.endsAt=assertAcademicTimestamp(raw.endsAt,'requestedChange.endsAt');
      if(Date.parse(change.endsAt)<=Date.parse(change.startsAt)) throw fail('Requested Class end must be after start.','TEACHING_D10_REQUEST_RANGE_INVALID',400);
      break;
    case 'PERMANENT_AVAILABILITY_CHANGE':
      change.scheduleInputs=object(raw.scheduleInputs,'requestedChange.scheduleInputs');
      break;
    case 'ACADEMIC_BREAK':
      change.startsAt=assertAcademicTimestamp(raw.startsAt,'requestedChange.startsAt');
      change.endsAt=assertAcademicTimestamp(raw.endsAt,'requestedChange.endsAt');
      if(Date.parse(change.endsAt)<=Date.parse(change.startsAt)) throw fail('Academic Break end must be after start.','TEACHING_D10_REQUEST_RANGE_INVALID',400);
      break;
    case 'EMERGENCY_ABSENCE':
      change.note=string(raw.note,'requestedChange.note',{required:false,max:1000});
      change.proofRequired=false;
      change.behaviorPenaltyAutomatic=false;
      break;
    case 'TEACHER_CHANGE':
      change.teacherIdentityId=string(raw.teacherIdentityId,'requestedChange.teacherIdentityId');
      break;
    case 'ASSIGNMENT_EXTENSION':
      change.requestedDeadlineAt=assertAcademicTimestamp(raw.requestedDeadlineAt,'requestedChange.requestedDeadlineAt');
      break;
    case 'EARLY_DISMISSAL':
      change.requestedLeaveAt=assertAcademicTimestamp(raw.requestedLeaveAt,'requestedChange.requestedLeaveAt');
      break;
    case 'ATTENDANCE_REVIEW_CORRECTION':
      change.requestedOutcome=string(raw.requestedOutcome,'requestedChange.requestedOutcome',{max:120});
      change.explanation=string(raw.explanation,'requestedChange.explanation',{required:false,max:1500});
      break;
    case 'COURSE_PAUSE':
    case 'COURSE_RESUME':
    case 'COURSE_CANCELLATION':
      change.reason=string(raw.reason,'requestedChange.reason',{required:false,max:1000});
      break;
    default: break;
  }
  return Object.freeze(change);
}

function normalizeCreateRequest(input={}) {
  const definition=requestDefinition(input.type);
  const requestedChange=normalizeRequestedChange(definition.type,input.requestedChange||{});
  let effectiveAt=null;
  if(input.effectiveAt!=null) effectiveAt=assertAcademicTimestamp(input.effectiveAt,'effectiveAt');
  return Object.freeze({
    definition,
    requestedChange,
    effectiveAt,
    explanation:string(input.explanation,'explanation',{required:false,max:1500}),
  });
}

function admissionCountsState(state,{hasIncompleteClosure=false}={}) {
  const normalized=normalizeLifecycle(state);
  if(normalized==='INCOMPLETE' && hasIncompleteClosure) return false;
  return ADMISSION_POLICY.countedLifecycleStates.includes(normalized);
}

module.exports={
  COURSE_LIFECYCLE,COURSE_TRANSITIONS,COURSE_STATUS_OVERLAYS,PROGRESSION_OUTCOMES,
  REQUEST_STATES,REQUEST_TRANSITIONS,REQUEST_TYPES,ADMISSION_POLICY,DEFAULT_GRADING_POLICY,
  normalizeLifecycle,assertCourseTransition,normalizeRequestState,assertRequestTransition,
  requestDefinition,normalizeRequestedChange,normalizeCreateRequest,admissionCountsState,fail,
};
