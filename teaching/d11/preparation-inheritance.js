'use strict';

const {validateLessonBlueprintProposal,reserveBounds}=require('./contracts');

// This never publishes a Blueprint. It is merely a conservative re-timing
// of previously validated content for D11's new PPL workspace. Preserve the
// learning objectives, academic examples, evidence and minimum-safe loads.
// The final model reconciliation is still mandatory for the new duration.
function retimeCompatibleDraft(payload,{source,target,learningUnits}){
  const before=validateLessonBlueprintProposal(payload,{
    learningUnits,scheduledStartAt:source.scheduled_start_at,scheduledEndAt:source.scheduled_end_at,
  });
  if(!before.ok)return null;
  const duration=Math.floor((Date.parse(target.scheduled_end_at)-Date.parse(target.scheduled_start_at))/60000);
  if(duration<1)return null;
  const bounds=reserveBounds(duration),reserve=bounds.target_minutes;
  const original=before.value.segments;
  const minimum=original.map(s=>Math.max(1,s.minimum_safe_minutes));
  const capacity=duration-reserve;
  const required=minimum.reduce((n,m)=>n+m,0);
  if(capacity<required)return null;
  const available=Math.max(0,capacity-required);
  const extras=original.map((s,i)=>Math.max(0,s.planned_minutes-minimum[i]));
  const plan=[...minimum],priority=[...original.keys()].sort((a,b)=>{
    const aCore=original[a].criticality==='CORE'?0:1;
    const bCore=original[b].criticality==='CORE'?0:1;
    return aCore-bCore||a-b;
  });
  let left=available;
  for(const i of priority){
    if(left<=0)break;
    const more=Math.min(left,extras[i]);
    plan[i]+=more;left-=more;
  }
  const draft={...payload,adaptive_reserve_minutes:reserve,
    segments:original.map((segment,i)=>({...segment,planned_minutes:plan[i]}))};
  const validated=validateLessonBlueprintProposal(draft,{
    learningUnits,scheduledStartAt:target.scheduled_start_at,scheduledEndAt:target.scheduled_end_at,
  });
  return validated.ok?validated.value:null;
}

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
  const sameDuration=(end-start)===(origEnd-origStart);
  const validation=validateLessonBlueprintProposal(payload,{
    learningUnits,scheduledStartAt:target.scheduled_start_at,scheduledEndAt:target.scheduled_end_at,
  });
  // Domain-invalid content is never accepted on inheritance. Only a
  // source-validated draft may be conservatively re-timed for the NEW PPL;
  // even then it is explicitly provisional, never an owner-committed Blueprint.
  const candidateContent=validation.ok?validation.value:
    !sameDuration&&['TEACHING_D11_BLUEPRINT_DURATION_OVERFLOW','TEACHING_D11_NUMBER_INVALID']
      .includes(validation.reason)
      ?retimeCompatibleDraft(payload,{source,target,learningUnits})
      :null;
  if(!candidateContent)return blocked('CONTENT_REVALIDATION_FAILED');
  return Object.freeze({
    mode:sourceBlueprint&&sameDuration?'INHERIT_VALIDATED_BLUEPRINT':'INHERIT_PREPARATION_CANDIDATE',
    reason:sameDuration?'AUTHORITATIVE_CONTENT_REVALIDATED':
      validation.ok?'DURATION_CHANGED_REQUIRES_FINAL_AI_RECONCILIATION':
      'DURATION_RETIMED_REQUIRES_FINAL_AI_RECONCILIATION',
    validatedContent:candidateContent,
    originBlueprintId:sourceBlueprint?.lesson_blueprint_id||null,
    originArtifactId:sourcePreparation?.artifact_version_id||null,
    sourceMaturity:sourceBlueprint?'CANDIDATE':sourcePreparation?.maturity_stage||null,
  });
}
module.exports={evaluateLessonInheritance,retimeCompatibleDraft};
