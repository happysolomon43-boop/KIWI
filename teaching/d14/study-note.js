'use strict';

const { getCapability } = require('../capability-registry');
const CAPABILITY = 'teaching.study.class_grounded_note_generation';
const FAMILY = 'TPF-20';
function fail(code){throw Object.assign(new Error(code),{code,status:409});}
function ids(list){return new Set((list||[]).map(String));}
function refSet(list){return new Set((list||[]).map((item)=>String(item.ref||item.id||item)));}
function bindingFrom({context,cardSet,closure=null,summary=null,sourceSnapshot}){
  if(!context?.blueprint||context.blueprint.blueprint_state!=='VALIDATED'||!context.plan||!sourceSnapshot?.ref)fail('TEACHING_D14_APPROVED_PLAN_SOURCE_REQUIRED');
  if(!cardSet?.ref||!Array.isArray(cardSet.cards)||cardSet.cards.some((card)=>!card.cardId||!card.version||!card.learningUnitId||!card.validated))fail('TEACHING_D14_VALIDATED_CARD_SET_REQUIRED');
  return Object.freeze({
    courseRef:`${context.classRow.course_id}@${context.classRow.course_state_version}`,
    classRef:`${context.classRow.class_id}@${context.classRow.schedule_version}`,
    lessonPlanRef:`${context.blueprint.lesson_blueprint_id}@${context.blueprint.version_no}`,
    sourceSnapshotRef:sourceSnapshot.ref, cardSetRef:cardSet.ref,
    closureRef:closure?`${closure.closure_fact_id}@${closure.controller_version}`:null,
    summaryRef:summary?`${summary.class_summary_id}@${summary.version_no}`:null,
  });
}
function validateStageOutput({output,stage,binding,plannedLearningUnits,actualTaughtLearningUnits=[],sourceRefs=[],cardSet,priorNote=null}){
  if(!output||output.prompt_family!==FAMILY||output.prompt_version!=='1.0'||output.capability_id!==CAPABILITY)fail('TEACHING_D14_NOTE_PROMPT_CONTRACT');
  const expectedMode=stage==='PRE_CLASS'?'PRE_CLASS_NOTE_PREPARATION':'POST_CLASS_NOTE_RECONCILIATION';
  const expectedStatus=stage==='PRE_CLASS'?'PREPARED_NOT_PUBLISHABLE':'DRAFT_READY_FOR_VALIDATION';
  if(output.task_mode!==expectedMode||output.status!==expectedStatus)fail('TEACHING_D14_NOTE_STAGE_INVALID');
  if(!output.source_binding||!output.note||!Array.isArray(output.note.sections)||!Array.isArray(output.claim_provenance)||!output.coverage||!output.checks)fail('TEACHING_D14_NOTE_SCHEMA_INVALID');
  const supplied=output.source_binding;
  const aliases={course_ref:'courseRef',class_ref:'classRef',lesson_plan_ref:'lessonPlanRef',course_source_snapshot_ref:'sourceSnapshotRef',class_study_card_set_ref:'cardSetRef',class_closure_ref:'closureRef',class_summary_ref:'summaryRef'};
  for(const [key,field] of Object.entries(aliases))if(String(supplied[key]||'')!==String(binding[field]||''))fail('TEACHING_D14_NOTE_STALE_BINDING');
  const planned=ids(plannedLearningUnits),actual=ids(actualTaughtLearningUnits),sources=refSet(sourceRefs);
  const cards=new Set((cardSet?.cards||[]).map((c)=>`${c.cardId}@${c.version}`));
  if(stage==='POST_CLASS'&&(!binding.closureRef||!binding.summaryRef||!priorNote))fail('TEACHING_D14_NOTE_CLOSURE_REQUIRED');
  for(const claim of output.claim_provenance){
    if(!claim.claim_id||!claim.claim_text||!Array.isArray(claim.planned_learning_unit_refs)||!Array.isArray(claim.approved_source_refs)||!Array.isArray(claim.card_refs))fail('TEACHING_D14_NOTE_CLAIM_SCHEMA');
    if(claim.planned_learning_unit_refs.some((id)=>!planned.has(String(id)))||claim.approved_source_refs.some((id)=>!sources.has(String(id)))||claim.card_refs.some((id)=>!cards.has(String(id))))fail('TEACHING_D14_NOTE_UNGROUNDED_CLAIM');
    if(stage==='POST_CLASS'&&(!Array.isArray(claim.actually_taught_learning_unit_refs)||claim.actually_taught_learning_unit_refs.some((id)=>!actual.has(String(id)))))fail('TEACHING_D14_NOTE_UNTAUGHT_CLAIM');
  }
  if(stage==='POST_CLASS'){
    const sections=output.note.sections;
    if(sections.some((s)=>!Array.isArray(s.learning_unit_refs)||s.learning_unit_refs.some((id)=>!actual.has(String(id)))))fail('TEACHING_D14_NOTE_UNTAUGHT_SECTION');
    if((output.coverage.removed_untaught_learning_unit_refs||[]).some((id)=>!planned.has(String(id))||actual.has(String(id))))fail('TEACHING_D14_NOTE_REMOVAL_INVALID');
    if(output.reconciliation?.provisional_note_ref!==priorNote.note_version_id||output.reconciliation.actual_class_delta_applied!==true)fail('TEACHING_D14_NOTE_RECONCILIATION_REQUIRED');
    const required=['all_substantive_claims_traceable','actual_taught_scope_only_for_publication','source_and_card_versions_aligned','final_card_set_accounted_for','corrections_applied','protected_content_excluded','no_mastery_grade_or_schedule_decision','no_invented_teacher_memory','publishable_only_after_reconciliation'];
    if(required.some((k)=>output.checks[k]!==true))fail('TEACHING_D14_NOTE_CHECK_FAILED');
  }
  const forbidden=/answer[_ -]?key|hidden[_ -]?prompt|chain[_ -]?of[_ -]?thought|mastery[_ -]?state|official[_ -]?mark/i;
  if(forbidden.test(JSON.stringify(output.note)))fail('TEACHING_D14_NOTE_PROTECTED_CONTENT');
  return Object.freeze({valid:true,publishable:false,requiresD27CardOwner:true,routeQualification:'UNQUALIFIED_UNTIL_D30'});
}
function noteRequest({stage,context,cardSet,sourceSnapshot,closure,summary,priorNote,plannedLearningUnits,actualTaughtLearningUnits}){
  const capability=getCapability(CAPABILITY);
  if(capability.prompt_family_id && capability.prompt_family_id!==FAMILY)fail('TEACHING_D14_CAPABILITY_BINDING_INVALID');
  const binding=bindingFrom({context,cardSet,sourceSnapshot,closure,summary});
  return Object.freeze({capabilityId:CAPABILITY,promptFamily:FAMILY,taskMode:stage==='PRE_CLASS'?'PRE_CLASS_NOTE_PREPARATION':'POST_CLASS_NOTE_RECONCILIATION',declaredAuthorityLevel:'T3',commit:false,binding,
    academicInput:Object.freeze({binding,plannedLearningUnits,actualTaughtLearningUnits,approvedSources:sourceSnapshot.spans,cardSet:cardSet.cards,closure:closure?.fact_pack||null,summary:summary?.summary_payload||null,provisionalNote:priorNote?.note_payload||null}),
  });
}
module.exports={bindingFrom,validateStageOutput,noteRequest};
