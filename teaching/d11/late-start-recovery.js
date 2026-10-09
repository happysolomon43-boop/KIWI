'use strict';

// A genuinely late but still recoverable scheduled Class may generate a fresh
// validated Blueprint. This NEVER authorizes starting outside its D11 window,
// changing the timetable, inventing a Blueprint or bypassing AI validation.
const MAX_LATE_START_MS=45*60*1000;
const MIN_TEACHING_REMAINING_MS=20*60*1000;

function isRecoverableRouteHeldSession(session) {
  if(!session||session.lifecycle_state!=='INTERRUPTED'
    ||session.instructional_substate!=='INTERRUPTED'
    ||session.lesson_blueprint_id!=null
    ||session.resume_instructional_substate!=null) return false;
  const progress=session.progress_state || {};
  // No objective, segment, answer or evidence was completed. A normally
  // interrupted lesson with academic progress is never treated as route-held.
  return ['completed_segment_refs','completed_objective_refs','evidence_event_refs',
    'independent_evidence_objective_refs'].every(k=>Array.isArray(progress[k])&&progress[k].length===0);
}

function lateStartRecoveryEligibility({classRow,plan=null,session=null,now=new Date()}={}) {
  const t=now instanceof Date?now.getTime():new Date(now).getTime();
  const start=Date.parse(classRow?.scheduled_start_at||'');
  const end=Date.parse(classRow?.scheduled_end_at||'');
  if(!Number.isFinite(t)||!Number.isFinite(start)||!Number.isFinite(end)
     ||end<=start||!classRow) return Object.freeze({allowed:false,reason:'CLASS_WINDOW_OR_SESSION_INVALID'});
  if(session&&!isRecoverableRouteHeldSession(session))
    return Object.freeze({allowed:false,reason:'SESSION_ALREADY_HAS_ACADEMIC_WORK'});
  if(session&&(
    !plan
    ||String(session.course_plan_id||'')!==String(plan.course_plan_id||'')
    ||String(session.source_course_plan_version)!==String(plan.version_no)
    ||String(session.source_course_state_version)!==String(classRow.course_state_version)
    ||String(session.source_class_schedule_version)!==String(classRow.schedule_version)
    ||String(session.source_timetable_version_id||'')!==String(classRow.source_timetable_version_id||'')))
    return Object.freeze({allowed:false,reason:'ROUTE_HELD_AUTHORITY_STALE'});
  if(classRow.lifecycle_state!=='SCHEDULED'
    ||classRow.course_lifecycle_state!=='ACTIVE'
    ||classRow.source_timetable_state!=='APPROVED')
    return Object.freeze({allowed:false,reason:'CLASS_AUTHORITY_INVALID'});
  if(t<start||t>=end)return Object.freeze({allowed:false,reason:'CLASS_NOT_LIVE'});
  if(t-start>MAX_LATE_START_MS)return Object.freeze({allowed:false,reason:'LATE_RECOVERY_WINDOW_EXPIRED'});
  if(end-t<MIN_TEACHING_REMAINING_MS)return Object.freeze({allowed:false,reason:'INSUFFICIENT_TEACHING_TIME'});
  return Object.freeze({allowed:true,reason:null,effectiveStartAt:new Date(t).toISOString(),
    remainingMinutes:Math.floor((end-t)/60000)});
}

module.exports={lateStartRecoveryEligibility,isRecoverableRouteHeldSession,MAX_LATE_START_MS,MIN_TEACHING_REMAINING_MS};
