'use strict';

// A genuinely late but still recoverable scheduled Class may generate a fresh
// validated Blueprint. This NEVER authorizes starting outside its D11 window,
// changing the timetable, inventing a Blueprint or bypassing AI validation.
const MAX_LATE_START_MS=45*60*1000;
const MIN_TEACHING_REMAINING_MS=20*60*1000;

function lateStartRecoveryEligibility({classRow,session=null,now=new Date()}={}) {
  const t=now instanceof Date?now.getTime():new Date(now).getTime();
  const start=Date.parse(classRow?.scheduled_start_at||'');
  const end=Date.parse(classRow?.scheduled_end_at||'');
  if(!Number.isFinite(t)||!Number.isFinite(start)||!Number.isFinite(end)
     ||end<=start||!classRow||session) return Object.freeze({allowed:false,reason:'CLASS_WINDOW_OR_SESSION_INVALID'});
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

module.exports={lateStartRecoveryEligibility,MAX_LATE_START_MS,MIN_TEACHING_REMAINING_MS};
