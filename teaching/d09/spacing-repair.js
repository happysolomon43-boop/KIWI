'use strict';
const {naturalizeScheduleResult}=require('./schedule-naturalizer');
const {assertClassSpacing}=require('./class-spacing');
const {digest}=require('./contracts');
const {buildPeriods,horizonStage}=require('./scheduler');
function hasSpacingViolation(slots,timezone,now){
  try{assertClassSpacing(slots,timezone,{now});return false;}
  catch(error){if(error.code==='TEACHING_D09_INTERCLASS_GAP_VIOLATION')return true;throw error;}
}
function repairSpacing(context,latest,now){
  // Repair only already-approved, unstarted obligations. Do not estimate new
  // work, repeat completed Learning Units, or shorten a Class to make it fit.
  const all=(latest.slots||[]).map(s=>({...s,courseId:s.courseId||s.course_id,kind:s.kind||s.slot_kind,timezone:s.timezone||context.semester.timezone,horizonStage:s.horizonStage||s.horizon_stage,exceptionCodes:s.exceptionCodes||s.exception_codes||[],startsAt:s.startsAt||s.starts_at,endsAt:s.endsAt||s.ends_at,plannedMinutes:Number(s.plannedMinutes||s.planned_minutes),learningUnitIds:s.learningUnitIds||s.learning_unit_refs||[]}));
  const future=all.filter(s=>Date.parse(s.startsAt)>=Date.parse(now));
  const history=all.filter(s=>Date.parse(s.startsAt)<Date.parse(now));
  if(history.some(s=>s.kind==='CLASS'&&Date.parse(s.endsAt)>Date.parse(now)))throw Object.assign(new Error('Repair is deferred until the running Class finishes.'),{code:'TEACHING_D09_SPACING_REPAIR_LIVE_CLASS',status:409});
  const fs=latest.feasibility;
  if(!fs?.capacity_metrics||!fs.headroom_policy_version)throw Object.assign(new Error('Current timetable feasibility evidence is required for spacing repair.'),{code:'TEACHING_D09_SPACING_REPAIR_EVIDENCE_REQUIRED',status:409});
  const minutes=future.reduce((sum,s)=>sum+(Date.parse(s.endsAt)-Date.parse(s.startsAt))/60000,0);
  const capacity=buildPeriods(context).reduce((sum,p)=>sum+p.minutes,0);
  const headroom=capacity?Math.max(0,(capacity-minutes)/capacity):0;
  if(headroom<Number(fs.minimum_headroom_ratio))throw Object.assign(new Error('Repair cannot preserve the required recovery capacity.'),{code:'TEACHING_D09_SPACING_REPAIR_CAPACITY',status:422});
  const metrics={...fs.capacity_metrics,totalCapacityMinutes:capacity,requiredMinutes:minutes,scheduledMinutes:minutes,unscheduledMinutes:Number(fs.capacity_metrics.unscheduledMinutes)||0,headroomRatio:Number(headroom.toFixed(4)),courseCount:new Set(future.map(s=>s.courseId)).size,fixedAuthoritySlotCount:0,stableSlotsRetained:0,spacingRepaired:true};
  const raw={outcome:fs.outcome,schedule:future,metrics,policy:{headroomPolicyVersion:fs.headroom_policy_version,targetHeadroomRatio:Number(fs.target_headroom_ratio),minimumHeadroomRatio:Number(fs.minimum_headroom_ratio)},stateDigest:latest.timetable.state_digest,reasons:fs.reasons||[],alternatives:fs.alternatives||[],courseSummaries:fs.course_summaries||[]};
  const naturalized=naturalizeScheduleResult(context,raw,{source:'SYSTEM_SPACING_REPAIR'});
  const repaired={...naturalized,schedule:naturalized.schedule.map(s=>({...s,horizonStage:horizonStage(s.startsAt,now,context.profile?.settings||{})}))};
  assertClassSpacing(repaired.schedule,context.semester.timezone,{now});
  return Object.freeze({...repaired,schedule:Object.freeze([...history.map(s=>({...s,horizonStage:s.horizonStage||horizonStage(s.startsAt,now,context.profile?.settings||{})})),...repaired.schedule].sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt))),metrics:Object.freeze({...metrics,scheduledMinutes:all.reduce((sum,s)=>sum+(Date.parse(s.endsAt)-Date.parse(s.startsAt))/60000,0),remainingScheduledMinutes:minutes,naturalizedCadence:true}),policy:Object.freeze({...repaired.policy,existingApprovedWorkloadPreserved:true}),stateDigest:digest({prior:latest.timetable.state_digest,repair:'INTERCLASS_GAP',schedule:[...history,...repaired.schedule]})});
}
module.exports={hasSpacingViolation,repairSpacing};
