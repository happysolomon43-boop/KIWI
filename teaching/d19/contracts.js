'use strict';

const D19_CONTRACT_VERSION='d19.measurement.v1';
const IMPROMPTU_TRIGGERS=Object.freeze([
  'DELAYED_RETENTION_VERIFICATION',
  'PREVIOUSLY_STRONG_RETENTION_CHECK',
  'CUMULATIVE_CHECKPOINT',
  'UNCONTROLLED_WORK_INDEPENDENCE_VERIFICATION',
  'PLANNED_GOVERNED_SURPRISE',
]);
const ALLOWED_GRADED_BASES=Object.freeze(new Set(['TAUGHT','VALIDATED_PRIOR_KNOWLEDGE']));
const CUMULATIVE_TYPES=Object.freeze(new Set(['MID_SEMESTER','FINAL_EXAMINATION']));
const MAKE_UP_SOURCE_TYPES=Object.freeze(new Set(['CLASSWORK','IMPROMPTU_TEST','SCHEDULED_TEST','MID_SEMESTER','FINAL_EXAMINATION']));
const PROTECTED_SCOPE_KEYS=Object.freeze(new Set([
  'answer','answers','answer_key','correct_answer','correct_answers','rubric','rubric_key',
  'blueprint','blueprint_payload','candidate','candidate_pool','protected_payload','hidden_validation_trace',
  'question','questions','items','exact_questions','solution','solutions',
]));

const TYPE_PROFILES=Object.freeze({
  DIAGNOSTIC:Object.freeze({purpose:'CURRENT_KNOWLEDGE_DIAGNOSIS',scopeMode:'TARGETED_DIAGNOSTIC',gradebookPosture:'PROHIBITED',gradedRule:'MUST_BE_UNGRADED',announced:true,lockedAfterStart:true,feedbackPosture:'DIAGNOSTIC_LEARNING_FEEDBACK'}),
  CLASSWORK:Object.freeze({purpose:'RECENT_INDEPENDENT_CLASS_EVIDENCE',scopeMode:'RECENT_TAUGHT',gradebookPosture:'CONDITIONAL_IF_DECLARED_GRADED',gradedRule:'OPTIONAL',announced:true,lockedAfterStart:true,feedbackPosture:'COURSE_POLICY_CONTROLLED'}),
  IMPROMPTU_TEST:Object.freeze({purpose:'UNPREPARED_RETENTION_OR_INDEPENDENCE_EVIDENCE',scopeMode:'GOVERNED_SURPRISE_ELIGIBLE',gradebookPosture:'CONDITIONAL_CAPPED_IF_DECLARED_GRADED',gradedRule:'OPTIONAL',announced:false,lockedAfterStart:true,feedbackPosture:'DEFERRED_WHILE_REPLACEMENT_OR_RELEASE_GATES_APPLY'}),
  SCHEDULED_TEST:Object.freeze({purpose:'ANNOUNCED_RECENT_SCOPE_FORMAL_MEASUREMENT',scopeMode:'RECENT_ELIGIBLE',gradebookPosture:'FORMAL_GRADED_INPUT',gradedRule:'MUST_BE_GRADED',announced:true,lockedAfterStart:true,feedbackPosture:'COURSE_POLICY_CONTROLLED'}),
  MID_SEMESTER:Object.freeze({purpose:'CUMULATIVE_CHECKPOINT',scopeMode:'CUMULATIVE_TO_DATE_IMPORTANCE_WEIGHTED',gradebookPosture:'FORMAL_GRADED_INPUT',gradedRule:'MUST_BE_GRADED',announced:true,lockedAfterStart:true,feedbackPosture:'COURSE_POLICY_CONTROLLED'}),
  FINAL_EXAMINATION:Object.freeze({purpose:'TERMINAL_CUMULATIVE_COURSE_MEASUREMENT',scopeMode:'WHOLE_ELIGIBLE_COURSE_STRATEGIC_SAMPLE',gradebookPosture:'FORMAL_GRADED_INPUT',gradedRule:'MUST_BE_GRADED',announced:true,lockedAfterStart:true,feedbackPosture:'COURSE_POLICY_CONTROLLED'}),
  MAKE_UP:Object.freeze({purpose:'EQUIVALENT_REPLACEMENT_FOR_LEGITIMATELY_MISSED_OR_INVALIDATED_WORK',scopeMode:'SOURCE_BLUEPRINT_EQUIVALENT',gradebookPosture:'INHERIT_SOURCE_POSTURE',gradedRule:'INHERIT_SOURCE',announced:true,lockedAfterStart:true,feedbackPosture:'SOURCE_ANSWERS_BLOCKED_WHILE_REPLACEMENT_LIVE'}),
  RESIT:Object.freeze({purpose:'NEW_FORMAL_ATTEMPT_AFTER_VALID_FAILURE',scopeMode:'FUTURE_D21_OWNER',gradebookPosture:'FUTURE_D20_D21_CONTRACT',gradedRule:'FUTURE_OWNER',announced:true,lockedAfterStart:true,feedbackPosture:'FUTURE_OWNER'}),
  VERIFICATION:Object.freeze({purpose:'TARGETED_CONTROLLED_REDEMONSTRATION',scopeMode:'TARGETED_TAUGHT_OR_VALIDATED',gradebookPosture:'NON_GRADEBOOK_VERIFICATION_EVIDENCE',gradedRule:'MUST_BE_UNGRADED',announced:true,lockedAfterStart:true,feedbackPosture:'VERIFICATION_DECISION_CONTROLLED'}),
});

function fail(message,code='TEACHING_D19_CONTRACT_INVALID',status=409,details=null){const e=new Error(message);e.code=code;e.status=status;if(details)e.details=details;throw e;}
function upper(value){return String(value||'').trim().toUpperCase();}
function asObject(value){return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}
function asArray(value){return Array.isArray(value)?value:[];}
function idList(value){return [...new Set(asArray(value).map(String).filter(Boolean))].sort();}
function profileFor(type){const key=upper(type),profile=TYPE_PROFILES[key];if(!profile)fail('Unknown D19 Assessment type.','TEACHING_D19_ASSESSMENT_TYPE_INVALID',400,{type});return profile;}

function assertNoProtectedScope(value,path='announcedScope'){
  if(Array.isArray(value)){value.forEach((v,i)=>assertNoProtectedScope(v,`${path}[${i}]`));return true;}
  if(!value||typeof value!=='object')return true;
  for(const [key,child] of Object.entries(value)){
    if(PROTECTED_SCOPE_KEYS.has(String(key).toLowerCase()))fail('Student-facing Assessment scope cannot contain protected question/answer/Blueprint material.','TEACHING_D19_SCOPE_PROTECTED_CONTENT',400,{path:`${path}.${key}`});
    assertNoProtectedScope(child,`${path}.${key}`);
  }
  return true;
}

function sanitizeAnnouncedScope(type,input={}){
  const assessmentType=upper(type),profile=profileFor(assessmentType);
  const source=structuredClone(asObject(input));
  assertNoProtectedScope(source);
  if(assessmentType==='IMPROMPTU_TEST')return Object.freeze({visibility:'HIDDEN_UNTIL_EXPOSURE',scope_kind:'PREVIOUSLY_TAUGHT_OR_VALIDATED',exact_questions_hidden:true,hidden_blueprint_exposed:false});
  return Object.freeze({...source,visibility:profile.announced?'ANNOUNCED':'HIDDEN_UNTIL_EXPOSURE',scope_kind:source.scope_kind||profile.scopeMode,exact_questions_hidden:true,hidden_blueprint_exposed:false});
}

function policyVersion({impromptuPolicy,eligibilityPolicy}={}){
  const a=impromptuPolicy?.policy_version||'impromptu-policy-unresolved';
  const b=eligibilityPolicy?.policy_version||'eligibility-policy-unresolved';
  return `${D19_CONTRACT_VERSION}|${a}|${b}`;
}

function normalizeDefinition(input,{impromptuPolicy,eligibilityPolicy}={}){
  const assessmentType=upper(input?.assessmentType),profile=profileFor(assessmentType),graded=Boolean(input?.graded);
  if(profile.gradedRule==='MUST_BE_UNGRADED'&&graded)fail(`${assessmentType} cannot contribute official Gradebook truth.`,`TEACHING_D19_${assessmentType}_GRADED_PROHIBITED`,409);
  if(profile.gradedRule==='MUST_BE_GRADED'&&!graded)fail(`${assessmentType} is a formal graded Assessment type.`,`TEACHING_D19_${assessmentType}_MUST_BE_GRADED`,409);
  if(assessmentType==='MAKE_UP')fail('Make-Up Assessment definitions must be created from an authoritative source Assessment lineage.','TEACHING_D19_MAKE_UP_SOURCE_REQUIRED',409);
  if(assessmentType==='RESIT')fail('Resit creation remains owned by the later Progression/Resit delivery.','TEACHING_D19_RESIT_FUTURE_OWNER',409,{owner:'D21'});
  const intendedClassId=input?.intendedClassId?String(input.intendedClassId):null;
  if(['CLASSWORK','IMPROMPTU_TEST'].includes(assessmentType)&&!intendedClassId)fail(`${assessmentType} requires its authoritative Class reference.`,`TEACHING_D19_${assessmentType}_CLASS_REQUIRED`,400);
  const trigger=assessmentType==='IMPROMPTU_TEST'?upper(input?.academicTrigger):null;
  if(assessmentType==='IMPROMPTU_TEST'&&!IMPROMPTU_TRIGGERS.includes(trigger))fail('Impromptu Test requires a legitimate governed academic trigger.','TEACHING_D19_IMPROMPTU_TRIGGER_INVALID',409,{allowed:IMPROMPTU_TRIGGERS});
  const impDecision=impromptuPolicy?.decision||{};
  const eligibilityDecision=eligibilityPolicy?.decision||{};
  const measurement=Object.freeze({
    contract_version:D19_CONTRACT_VERSION,
    assessment_type:assessmentType,
    purpose:profile.purpose,
    scope_mode:profile.scopeMode,
    gradebook_posture:profile.gradebookPosture,
    locked_standard_after_start:true,
    student_visibility:profile.announced?'ANNOUNCED':'HIDDEN_UNTIL_EXPOSURE',
    feedback_posture:profile.feedbackPosture,
    intended_class_id:intendedClassId,
    academic_trigger:trigger,
    impromptu_grade_weight_cap:assessmentType==='IMPROMPTU_TEST'&&graded?Number(impDecision.default_course_grade_weight_cap??0):null,
    allowed_graded_eligibility_bases:Object.freeze([...(eligibilityDecision.graded_content_must_be||['TAUGHT','VALIDATED_PRIOR_KNOWLEDGE'])]),
    d06_policy_versions:Object.freeze({impromptu:impromptuPolicy?.policy_version||null,eligibility:eligibilityPolicy?.policy_version||null}),
    d20_official_marks_owner:true,
    d21_progression_owner:true,
  });
  return Object.freeze({
    ...input,
    assessmentType,
    graded,
    purpose:String(input?.purpose||profile.purpose),
    announcedScope:sanitizeAnnouncedScope(assessmentType,input?.announcedScope),
    policyVersion:policyVersion({impromptuPolicy,eligibilityPolicy}),
    sourceLineage:Object.freeze({...asObject(input?.sourceLineage),d19_measurement:measurement}),
    measurement,
  });
}

function requiredUnitIds(blueprint){
  const payload=blueprint?.blueprint_payload||blueprint?.blueprintPayload||{};
  return idList(asArray(payload.slots||blueprint?.slots).flatMap(slot=>slot.learning_unit_ids||slot.learningUnitIds||[]));
}
function slotsOf(blueprint){const payload=blueprint?.blueprint_payload||blueprint?.blueprintPayload||{};return asArray(payload.slots||blueprint?.slots);}

function assertEligibility({assessment,blueprint,eligibilityRows=[]}){
  const type=upper(assessment?.assessment_type||assessment?.assessmentType),required=requiredUnitIds(blueprint),map=new Map(asArray(eligibilityRows).map(r=>[String(r.learning_unit_id),upper(r.eligibility_basis)]));
  if(type==='DIAGNOSTIC'&&!Boolean(assessment?.graded))return Object.freeze({allowed:true,diagnosticProbe:true,required});
  const failures=required.filter(id=>!ALLOWED_GRADED_BASES.has(map.get(id))).map(id=>({learningUnitId:id,basis:map.get(id)||'NOT_ELIGIBLE'}));
  if(failures.length)fail('D19 formal measurement scope contains content that is not taught or validated prior knowledge.','TEACHING_D19_FORMAL_SCOPE_INELIGIBLE',409,{failures});
  return Object.freeze({allowed:true,diagnosticProbe:false,required});
}

function assertIntegratedLineage(blueprint){
  for(const slot of slotsOf(blueprint)){
    const ids=idList(slot.learning_unit_ids||slot.learningUnitIds||[]);if(ids.length<2)continue;
    const criteria=asArray(slot.rubric_contract?.criteria||slot.rubricContract?.criteria);
    const rubricCovered=new Set(criteria.flatMap(c=>c.learning_unit_ids||c.learningUnitIds||[]).map(String));
    const demandLineage=asArray(slot.measurement_demand?.learning_unit_lineage||slot.measurementDemand?.learning_unit_lineage).map(String);
    const demandCovered=new Set(demandLineage);
    const missing=ids.filter(id=>!rubricCovered.has(id)&&!demandCovered.has(id));
    if(missing.length)fail('Integrated Assessment items must preserve decomposable Learning Unit/rubric lineage.','TEACHING_D19_INTEGRATED_LINEAGE_REQUIRED',409,{slotId:slot.slot_id||slot.slotId,missing});
  }
  return true;
}

function cumulativeCoverageAudit({assessmentType,blueprint,eligibilityRows=[],planLearningUnits=[],recentLearningUnitIds=[]}={}){
  const type=upper(assessmentType);if(!CUMULATIVE_TYPES.has(type))return Object.freeze({pass:true,findings:Object.freeze([])});
  const eligible=new Set(asArray(eligibilityRows).map(r=>String(r.learning_unit_id)));
  const selected=new Set(requiredUnitIds(blueprint));
  const recent=new Set(idList(recentLearningUnitIds));
  const planMap=new Map(asArray(planLearningUnits).map(u=>[String(u.learning_unit_id),u]));
  const findings=[];
  const older=[...eligible].filter(id=>!recent.has(id));
  if(older.length&&selected.size&&[...selected].every(id=>recent.has(id)))findings.push('RECENCY_ONLY_SELECTION');
  const priority=[...eligible].filter(id=>['HIGH','FOUNDATIONAL'].includes(upper(planMap.get(id)?.criticality)));
  if(priority.length&&!priority.some(id=>selected.has(id)))findings.push('NO_HIGH_OR_FOUNDATIONAL_REPRESENTATION');
  if(type==='FINAL_EXAMINATION'){
    const eligibleTopics=new Set([...eligible].map(id=>planMap.get(id)?.topic_id).filter(Boolean).map(String));
    const selectedTopics=new Set([...selected].map(id=>planMap.get(id)?.topic_id).filter(Boolean).map(String));
    if(eligibleTopics.size>1&&selectedTopics.size<2)findings.push('FINAL_TOPIC_REPRESENTATION_TOO_NARROW');
  }
  return Object.freeze({pass:findings.length===0,findings:Object.freeze(findings),selectedCount:selected.size,eligibleCount:eligible.size,olderEligibleCount:older.length,priorityEligibleCount:priority.length});
}

function assertCumulativeCoverage(input){const audit=cumulativeCoverageAudit(input);if(!audit.pass)fail('Cumulative Assessment coverage failed deterministic Course Plan/anti-recency audit.','TEACHING_D19_CUMULATIVE_COVERAGE_INVALID',409,{findings:audit.findings});return audit;}

function assertTypeBlueprint({assessment,blueprint,eligibilityRows=[],planLearningUnits=[],recentLearningUnitIds=[],classLearningUnitIds=[]}={}){
  const type=upper(assessment?.assessment_type||assessment?.assessmentType);profileFor(type);assertEligibility({assessment,blueprint,eligibilityRows});assertIntegratedLineage(blueprint);
  const selected=requiredUnitIds(blueprint);
  if(type==='CLASSWORK'){
    const allowed=new Set(idList(classLearningUnitIds));
    if(!allowed.size)fail('Classwork requires authoritative recently taught Class scope.','TEACHING_D19_CLASSWORK_SCOPE_REQUIRED',409);
    const outside=selected.filter(id=>!allowed.has(id));if(outside.length)fail('Classwork may measure only the intended Class/recent taught scope.','TEACHING_D19_CLASSWORK_SCOPE_EXPANSION',409,{outside});
  }
  if(CUMULATIVE_TYPES.has(type))assertCumulativeCoverage({assessmentType:type,blueprint,eligibilityRows,planLearningUnits,recentLearningUnitIds});
  return true;
}

function assertImpromptuBudget({policyDecision,classes=[],priorAssessments=[],targetClassId,durationMinutes=null,trigger,graded=false}={}){
  const p=asObject(policyDecision);if(!p.academic_trigger_required||!p.package_must_be_ready_and_validated_before_class)fail('Configured Impromptu policy is incomplete.','TEACHING_D19_IMPROMPTU_POLICY_INVALID',503);
  const academicTrigger=upper(trigger);if(!IMPROMPTU_TRIGGERS.includes(academicTrigger))fail('Impromptu Test trigger is not legitimate.','TEACHING_D19_IMPROMPTU_TRIGGER_INVALID',409);
  const ordered=[...classes].sort((a,b)=>new Date(a.scheduled_start_at)-new Date(b.scheduled_start_at));
  const targetIndex=ordered.findIndex(c=>String(c.class_id)===String(targetClassId));if(targetIndex<0)fail('Impromptu Test target Class is not authoritative for this Course.','TEACHING_D19_IMPROMPTU_CLASS_INVALID',409);
  const target=ordered[targetIndex];
  if(durationMinutes!=null){const classMinutes=Math.max(0,(new Date(target.scheduled_end_at)-new Date(target.scheduled_start_at))/60000),cap=classMinutes*Number(p.maximum_class_time_ratio||0);if(!(classMinutes>0)||Number(durationMinutes)>cap+1e-9)fail('Impromptu Test exceeds the configured fraction of the existing Class block.','TEACHING_D19_IMPROMPTU_CLASS_TIME_BUDGET_EXCEEDED',409,{durationMinutes,classMinutes,maximumClassTimeRatio:p.maximum_class_time_ratio});}
  if(graded){
    const completedBefore=ordered.slice(0,targetIndex).filter(c=>c.completed===true);
    const window=Number(p.maximum_graded_impromptu_per_completed_classes?.window||0),count=Number(p.maximum_graded_impromptu_per_completed_classes?.count||0);
    if(!(window>0)||!(count>=0))fail('Configured graded Impromptu frequency policy is invalid.','TEACHING_D19_IMPROMPTU_FREQUENCY_POLICY_INVALID',503);
    const recentIds=new Set(completedBefore.slice(-window).map(c=>String(c.class_id)));
    const prior=priorAssessments.filter(a=>Boolean(a.graded)&&upper(a.assessment_type)==='IMPROMPTU_TEST');
    const recentCount=prior.filter(a=>recentIds.has(String(a.source_lineage?.d19_measurement?.intended_class_id||''))).length;
    if(recentCount>=count)fail('Configured Impromptu frequency budget is exhausted.','TEACHING_D19_IMPROMPTU_FREQUENCY_EXHAUSTED',409,{recentCount,count,window});
    if(p.consecutive_scheduled_classes_allowed===false&&completedBefore.length){const previousClassId=String(completedBefore.at(-1).class_id);if(prior.some(a=>String(a.source_lineage?.d19_measurement?.intended_class_id||'')===previousClassId))fail('Consecutive scheduled Classes cannot contain graded Impromptu Assessments.','TEACHING_D19_IMPROMPTU_CONSECUTIVE_FORBIDDEN',409);}
  }
  return Object.freeze({allowed:true,academicTrigger,gradeWeightCap:graded?Number(p.default_course_grade_weight_cap||0):null,classTimeRatioCap:Number(p.maximum_class_time_ratio||0),hiddenUntilExposure:true});
}

function classTimeContract({classRow,session,durationMinutes,serverNow=new Date()}={}){
  if(!classRow||!session)fail('In-Class Impromptu Assessment requires current authoritative Class/Controller state.','TEACHING_D19_ACTIVE_CLASS_REQUIRED',409);
  if(String(session.lifecycle_state)!=='ACTIVE'||String(session.instructional_substate)!=='ASSESSMENT')fail('Controller must explicitly enter ASSESSMENT state before an Impromptu Attempt starts.','TEACHING_D19_CONTROLLER_ASSESSMENT_STATE_REQUIRED',409);
  const now=new Date(serverNow),scheduledEnd=new Date(classRow.scheduled_end_at),remaining=Math.max(0,(scheduledEnd-now)/60000),duration=Number(durationMinutes||0);
  if(!(duration>0)||duration>remaining+1e-9)fail('Impromptu Assessment must fit inside the remaining scheduled Class block.','TEACHING_D19_IMPROMPTU_REMAINING_TIME_INSUFFICIENT',409,{durationMinutes:duration,remainingMinutes:remaining});
  return Object.freeze({scheduledClassEndAt:scheduledEnd.toISOString(),assessmentDurationMinutes:duration,remainingAfterAssessmentMinutes:Math.max(0,remaining-duration),scheduleExtensionMinutes:0,schedulerMutation:false,controllerReplanRequired:true});
}

function missedDisposition({assessmentType,graded=true,reason,systemFailure=false}={}){
  const type=upper(assessmentType),r=upper(reason);
  if(systemFailure||r==='SYSTEM_PROTECTED')return Object.freeze({historyState:'SYSTEM_PROTECTED',academicFailure:false,nextAction:'EQUIVALENT_REPLACEMENT_OR_FAIR_RECOVERY'});
  if(r==='INVALIDATED')return Object.freeze({historyState:'INVALIDATED',academicFailure:false,nextAction:'EQUIVALENT_REPLACEMENT'});
  if(['APPROVED_MISSED','EXCUSED_ABSENCE','APPROVED_LEAVE'].includes(r)){
    if(type==='FINAL_EXAMINATION')return Object.freeze({historyState:'INCOMPLETE',academicFailure:false,nextAction:'MAKE_UP_OR_INCOMPLETE'});
    if(['CLASSWORK','SCHEDULED_TEST','IMPROMPTU_TEST','MID_SEMESTER'].includes(type))return Object.freeze({historyState:'NOT_ATTEMPTED_APPROVED',academicFailure:false,nextAction:graded?'EQUIVALENT_REPLACEMENT':'NO_GRADE_PENALTY'});
  }
  return Object.freeze({historyState:'NOT_ATTEMPTED_UNRESOLVED',academicFailure:false,nextAction:'AUTHORITATIVE_POLICY_REVIEW'});
}

function makeUpLineage({sourceAssessment,sourceBlueprint,authorityRef,reason}={}){
  const sourceType=upper(sourceAssessment?.assessment_type);if(!MAKE_UP_SOURCE_TYPES.has(sourceType))fail('This Assessment type does not use the D19 Make-Up replacement path.','TEACHING_D19_MAKE_UP_TYPE_INVALID',409,{sourceType});
  if(!sourceBlueprint?.assessment_blueprint_id)fail('Make-Up requires the source intended Blueprint.','TEACHING_D19_MAKE_UP_BLUEPRINT_REQUIRED',409);
  if(!String(authorityRef||'').trim())fail('Make-Up requires authoritative approved-miss/invalidation/system-protection provenance.','TEACHING_D19_MAKE_UP_AUTHORITY_REQUIRED',409);
  return Object.freeze({
    d19_measurement:Object.freeze({
      contract_version:D19_CONTRACT_VERSION,
      assessment_type:'MAKE_UP',
      purpose:'EQUIVALENT_REPLACEMENT_FOR_LEGITIMATELY_MISSED_OR_INVALIDATED_WORK',
      gradebook_posture:'INHERIT_SOURCE_POSTURE',
      source_assessment_id:sourceAssessment.assessment_id,
      source_assessment_type:sourceType,
      source_blueprint_id:sourceBlueprint.assessment_blueprint_id,
      source_blueprint_version:Number(sourceBlueprint.version_no),
      source_authority_ref:String(authorityRef),
      source_history_reason:upper(reason),
      fresh_candidate_generation_required:true,
      source_candidate_reuse_forbidden:true,
      source_answers_release:'BLOCKED_WHILE_REPLACEMENT_LIVE',
      d20_official_marks_owner:true,
      d21_resit_owner:true,
    }),
  });
}

function blueprintInputFromRow(row){
  if(!row)fail('Source Blueprint is required.','TEACHING_D19_SOURCE_BLUEPRINT_REQUIRED',409);
  return Object.freeze({
    slots:structuredClone(asArray(row.blueprint_payload?.slots)),
    totalMarks:Number(row.total_marks),durationMinutes:Number(row.duration_minutes),timerModel:row.timer_model,
    responseFormArchitecture:structuredClone(asObject(row.response_form_architecture)),resourcePolicy:structuredClone(asObject(row.resource_policy)),
    accommodationPolicy:structuredClone(asObject(row.accommodation_policy)),singleModeJustification:row.single_mode_justification||null,
    minimumReviewMinutes:0,maturity:'PRE_LOCK_READY',
  });
}

function markReviewHandoff({assessment,attempt}={}){
  if(!assessment||!attempt)fail('Mark/review handoff requires an Assessment and terminal Attempt.','TEACHING_D19_D20_HANDOFF_INVALID',409);
  return Object.freeze({owner:'D20',state:'AWAITING_D20_MARKING',assessmentId:assessment.assessment_id,attemptId:attempt.assessment_attempt_id,assessmentType:assessment.assessment_type,officialMark:null,gradebookMutation:false,d19MayMark:false,d19MayReviewRubricCredit:false});
}
function retentionEvidenceHandoff({assessment,attemptId,resultRef}={}){
  if(upper(assessment?.assessment_type)!=='IMPROMPTU_TEST'||!resultRef)fail('Retention evidence handoff requires a resolved Impromptu result reference.','TEACHING_D19_RETENTION_HANDOFF_INVALID',409);
  return Object.freeze({owner:'D13',kind:'RETENTION_EVIDENCE_CANDIDATE',assessmentId:assessment.assessment_id,attemptId:String(attemptId),resultRef:String(resultRef),directSkmMutation:false,progressionDecision:false,oneWeakResultErasesHistory:false});
}

module.exports=Object.freeze({
  D19_CONTRACT_VERSION,TYPE_PROFILES,IMPROMPTU_TRIGGERS,ALLOWED_GRADED_BASES,CUMULATIVE_TYPES,MAKE_UP_SOURCE_TYPES,
  profileFor,sanitizeAnnouncedScope,policyVersion,normalizeDefinition,requiredUnitIds,slotsOf,assertEligibility,
  assertIntegratedLineage,cumulativeCoverageAudit,assertCumulativeCoverage,assertTypeBlueprint,assertImpromptuBudget,
  classTimeContract,missedDisposition,makeUpLineage,blueprintInputFromRow,markReviewHandoff,retentionEvidenceHandoff,fail,
});