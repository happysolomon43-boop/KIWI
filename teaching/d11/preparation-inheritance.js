'use strict';

const {validateLessonBlueprintProposal}=require('./contracts');

// No historical session, attendance or academic state is ever moved.
// This gate decides only whether already-validated *content* may be copied
// into a new Class, which will have fresh authority/version/lineage.
function evaluateLessonInheritance({
  source,target,plan,sourceSlot,targetSlot,sourceBlueprint=null,
  sourcePreparation=null,learningUnits=[],sourceHasSession=false,targetHasSession=false,
  now=new Date(),requestId=null,
}={}){
  const blocked=reason=>Object.freeze({mode:'FRESH_PREPARATION',reason});
  if(!source||!target||!plan)return blocked('INCOMPLETE_AUTHORITY');
  if(sourceHasSession||targetHasSession)return blocked('SESSION_HISTORY_PROTECTED');
  if(source.student_id!==target.student_id||source.course_id!==target.course_id
    ||source.class_id===target.class_id)return blocked('WRONG_CLASS_IDENTITY');
  if(source.lifecycle_state!=='CANCELLED'||target.lifecycle_state!=='SCHEDULED'
    ||target.course_lifecycle_state!=='ACTIVE'||target.source_timetable_state!=='APPROVED')
    return blocked('NOT_CURRENT_APPROVED_REPLACEMENT');
  if(requestId && (String(source.source_request_id||'')!==String(requestId)
    ||String(target.source_request_id||'')!==String(requestId)))
    return blocked('RESCHEDULE_REQUEST_MISMATCH');
  if(String(source.source_timetable_version_id||'')===String(target.source_timetable_version_id||''))
    return blocked('NO_TIMETABLE_REPLACEMENT');
  if(source.course_state_version==null||target.course_state_version==null
    ||String(source.course_state_version)!==String(target.course_state_version))
    return blocked('COURSE_CHANGED');
  if(!sourceSlot||!targetSlot||sourceSlot.slot_kind!=='CLASS'||targetSlot.slot_kind!=='CLASS')
    return blocked('SLOT_AUTHORITY_MISSING');
  if(source.source_timetable_slot_id!==sourceSlot.timetable_slot_id
    ||target.source_timetable_slot_id!==targetSlot.timetable_slot_id)
    return blocked('SLOT_AUTHORITY_CHANGED');
  const units=v=>Array.isArray(v)?[...v].map(String).sort():[];
  const oldUnits=units(sourceSlot.learning_unit_refs),newUnits=units(targetSlot.learning_unit_refs);
  if(JSON.stringify(oldUnits)!==JSON.stringify(newUnits))return blocked('LESSON_SCOPE_CHANGED');
  const start=Date.parse(target.scheduled_start_at),end=Date.parse(target.scheduled_end_at);
  const origStart=Date.parse(source.scheduled_start_at),origEnd=Date.parse(source.scheduled_end_at);
  const tick=now instanceof Date?now.getTime():Date.parse(now);
  if(![start,end,origStart,origEnd,tick].every(Number.isFinite)||start<=tick||end<=start||origEnd<=origStart)
    return blocked('INVALID_OR_ELAPSED_CLASS_WINDOW');
  const payload=sourceBlueprint?.blueprint_payload||sourcePreparation?.payload;
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return blocked('NO_REUSABLE_PREPARATION');
  const candidate=sourceBlueprint||sourcePreparation;
  if(sourceBlueprint){
    if(!['VALIDATED','SUPERSEDED'].includes(candidate.blueprint_state)
      ||candidate.validation_metadata?.deterministic_validation!=='PASS'
      ||String(candidate.course_plan_id||'')!==String(plan.course_plan_id)
      ||String(candidate.source_course_plan_version)!==String(plan.version_no)
      ||String(candidate.source_course_state_version)!==String(source.course_state_version)
      ||String(candidate.source_class_schedule_version)!==String(source.schedule_version)
      ||String(candidate.source_timetable_version_id||'')!==String(source.source_timetable_version_id||''))
      return blocked('BLUEPRINT_PROVENANCE_CHANGED');
  } else {
    const pre=sourcePreparation?.preconditions;
    if(candidate.validity_state!=='CURRENT'||!pre
      ||String(pre.course_plan_id||'')!==String(plan.course_plan_id)
      ||String(pre.course_plan_version)!==String(plan.version_no)
      ||String(pre.course_state_version)!==String(source.course_state_version)
      ||String(pre.class_schedule_version)!==String(source.schedule_version)
      ||String(pre.timetable_version_id||'')!==String(source.source_timetable_version_id||''))
      return blocked('PREPARATION_PROVENANCE_CHANGED');
  }
  const validation=validateLessonBlueprintProposal(payload,{
    learningUnits,scheduledStartAt:target.scheduled_start_at,scheduledEndAt:target.scheduled_end_at,
  });
  if(!validation.ok)return blocked('CONTENT_REVALIDATION_FAILED');
  const sameDuration=(end-start)===(origEnd-origStart);
  return Object.freeze({
    mode:sourceBlueprint&&sameDuration?'INHERIT_VALIDATED_BLUEPRINT':'INHERIT_PREPARATION_CANDIDATE',
    reason:sameDuration?'AUTHORITATIVE_CONTENT_REVALIDATED':'DURATION_CHANGED_REQUIRES_FINAL_AI_RECONCILIATION',
    validatedContent:validation.value,
    originBlueprintId:sourceBlueprint?.lesson_blueprint_id||null,
    originArtifactId:sourcePreparation?.artifact_version_id||null,
    sourceMaturity:sourcePreparation?.maturity_stage||null,
  });
}
module.exports={evaluateLessonInheritance};
