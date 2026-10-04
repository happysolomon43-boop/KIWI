'use strict';

const D27_CONFLICT_POLICIES = Object.freeze({
  TEACHING_STRONG_FSRS_WEAK: Object.freeze({
    authoritativeOwner:'TEACHING_SKM_FOR_TEACHING_KNOWLEDGE_STATE',
    externalOwner:'KIWI_STUDY_FSRS_FOR_CARD_REVIEW_STATE',
    resolution:'KEEP_TRUTHS_SEPARATE; FSRS_WEAKNESS_MAY_REQUEST_REVIEW_BUT_CANNOT_DOWNGRADE_SKM_OR_GRADEBOOK',
    automaticAcademicMutation:false,
  }),
  FSRS_DUE_VS_TEACHING_TIMETABLE: Object.freeze({
    authoritativeOwner:'D09_SCHEDULER_FOR_COURSE_TIME',
    externalOwner:'KIWI_STUDY_FSRS_FOR_CARD_DUE_STATE',
    resolution:'COURSE_TIMETABLE_WINS_COURSE_TIME; CARD_OWNER_MAY_REPLAN_REVIEW_WITHOUT_MOVING_FORMAL_CLASS_OR_DEADLINE',
    automaticAcademicMutation:false,
  }),
  MASTERY_DEADLINE_VS_TEACHING_TIMETABLE: Object.freeze({
    authoritativeOwner:'D09_SCHEDULER_FOR_COURSE_TIME',
    externalOwner:'KIWI_MASTERY_BUBBLES_FOR_EXAM_GOAL_TRAJECTORY',
    resolution:'SURFACE_TRAJECTORY_PRESSURE; DO_NOT_OVERRIDE_TEACHING_HARD_CONSTRAINTS_OR_DUPLICATE_SCHEDULE',
    automaticAcademicMutation:false,
  }),
  OUT_OF_ORDER_OR_STALE_EVENT: Object.freeze({
    authoritativeOwner:'SOURCE_DOMAIN_CURRENT_VERSION',
    resolution:'REVALIDATE_CURRENT_SOURCE_BEFORE_CONSEQUENTIAL_WRITE; HISTORICAL_FACT_REPLAY_MUST_REMAIN_IDEMPOTENT',
    automaticAcademicMutation:false,
  }),
  TARGET_OWNER_REJECTION: Object.freeze({
    authoritativeOwner:'TARGET_DOMAIN_FOR_TARGET_COMMIT',
    resolution:'AUDIT_REJECTION; DO_NOT_FABRICATE_SUCCESS_OR_ROLL_BACK_VALID_SOURCE_TRUTH',
    automaticAcademicMutation:false,
  }),
  KIWI_INTEGRATION_OUTAGE: Object.freeze({
    authoritativeOwner:'SOURCE_DOMAIN_REMAINS_AVAILABLE',
    resolution:'KEEP_INTENT_REPLAYABLE; NO_STUDENT_PENALTY_OR_FALSE_TARGET_SUCCESS',
    automaticAcademicMutation:false,
  }),
  DELETED_CARD_REFERENCE: Object.freeze({
    authoritativeOwner:'KIWI_STUDY_FSRS_FOR_CARD_DELETION',
    resolution:'REFERENCE_BECOMES_STALE_OR_MISSING; TEACHING_NEVER_RECREATES_OR_DELETES_SOURCE_CARD_IMPLICITLY',
    automaticAcademicMutation:false,
  }),
  COURSE_COMPLETION_LATE_REPLAY: Object.freeze({
    authoritativeOwner:'COURSE_PROGRESSION_OWNER_FOR_COMPLETION_FACT',
    resolution:'PRESERVE_HISTORICAL_SOURCE_VERSION_AND_IDEMPOTENCY; DO_NOT_DUPLICATE_DOWNSTREAM_CONSEQUENCE',
    automaticAcademicMutation:false,
  }),
});

function conflictPolicy(name) {
  const key=String(name||'').trim().toUpperCase();
  const policy=D27_CONFLICT_POLICIES[key];
  if(!policy) throw new RangeError(`Unknown D27 conflict policy: ${key}`);
  return policy;
}

module.exports={D27_CONFLICT_POLICIES,conflictPolicy};
