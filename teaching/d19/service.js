'use strict';

const {
  D19_CONTRACT_VERSION,TYPE_PROFILES,normalizeDefinition,profileFor,assertTypeBlueprint,assertImpromptuBudget,
  classTimeContract,missedDisposition,makeUpLineage,blueprintInputFromRow,markReviewHandoff,retentionEvidenceHandoff,fail,
}=require('./contracts');

function createD19AssessmentTypeService({d17Service,d17Repository,d08Repository=null,d11Repository=null,d14Service=null,policy=null,clock=()=>new Date()}={}){
  if(!d17Service||typeof d17Service.createDefinition!=='function')throw new TypeError('D19 requires the accepted D17 Assessment service.');
  if(!d17Repository||typeof d17Repository.requireAssessment!=='function')throw new TypeError('D19 requires the accepted D17 Assessment repository.');
  if(!policy||typeof policy.getTeachingDecision!=='function')throw new TypeError('D19 requires the accepted D06 policy registry.');
  const impromptuPolicy=policy.getTeachingDecision('TCH-0079');
  const eligibilityPolicy=policy.getTeachingDecision('TCH-0694');
  const sid=(user)=>{if(!user?.id)fail('Authenticated student is required.','TEACHING_D19_AUTH_REQUIRED',401);return String(user.id);};
  const now=()=>{const v=clock();return v instanceof Date?v:new Date(v);};
  const typeOf=(a)=>String(a?.assessment_type||a?.assessmentType||'').toUpperCase();
  const measurementOf=(a)=>a?.source_lineage?.d19_measurement||a?.sourceLineage?.d19_measurement||null;

  async function classContext(studentId,classId){
    if(!d11Repository||typeof d11Repository.getClassContext!=='function')fail('D11 Class authority is unavailable.','TEACHING_D19_CLASS_OWNER_UNAVAILABLE',503);
    const ctx=await d11Repository.getClassContext(studentId,classId);
    if(!ctx?.classRow)fail('Teaching Class not found.','TEACHING_D19_CLASS_NOT_FOUND',404);
    return ctx;
  }
  async function allClasses(user,courseId){
    if(!d14Service||typeof d14Service.listClasses!=='function')fail('D14 Class listing authority is unavailable.','TEACHING_D19_CLASS_LIST_OWNER_UNAVAILABLE',503);
    const result=await d14Service.listClasses(user,courseId);return Array.isArray(result?.classes)?result.classes:[];
  }
  async function annotateClasses(user,courseId,targetClassId=null,completedWindow=4){
    const classes=(await allClasses(user,courseId)).sort((a,b)=>new Date(a.scheduled_start_at)-new Date(b.scheduled_start_at));
    const targetIndex=targetClassId?classes.findIndex(c=>String(c.class_id)===String(targetClassId)):classes.length;
    if(targetClassId&&targetIndex<0)fail('Target Class does not belong to this Course.','TEACHING_D19_CLASS_COURSE_MISMATCH',409);
    let closedSeen=0;
    for(let i=Math.min(targetIndex-1,classes.length-1);i>=0&&closedSeen<completedWindow;i--){
      const ctx=await classContext(String(user.id),classes[i].class_id);
      classes[i]={...classes[i],completed:ctx.session?.lifecycle_state==='CLOSED'};
      if(classes[i].completed)closedSeen+=1;
    }
    if(targetClassId){const ctx=await classContext(String(user.id),targetClassId);classes[targetIndex]={...classes[targetIndex],completed:ctx.session?.lifecycle_state==='CLOSED'};}
    return classes.map(c=>({...c,completed:c.completed===true}));
  }
  async function recentLearningUnits(user,courseId,count=2){
    const classes=(await allClasses(user,courseId)).filter(c=>new Date(c.scheduled_start_at)<now()).sort((a,b)=>new Date(b.scheduled_start_at)-new Date(a.scheduled_start_at));
    const ids=[];let closed=0;
    for(const row of classes){if(closed>=count)break;const ctx=await classContext(String(user.id),row.class_id);if(ctx.session?.lifecycle_state!=='CLOSED')continue;closed+=1;for(const id of ctx.blueprint?.planned_learning_unit_refs||[])ids.push(String(id));}
    return [...new Set(ids)];
  }
  async function planLearningUnits(studentId,courseId){
    if(!d08Repository||typeof d08Repository.getPlanReview!=='function')return [];
    const setup=await d08Repository.getPlanReview(studentId,courseId);return Array.isArray(setup?.learningUnits)?setup.learningUnits:[];
  }
  async function measurementContext(user,assessment,blueprint,{includeClassScope=true}={}){
    const studentId=sid(user),eligibilityRows=await d17Repository.currentEligibility(studentId,assessment.course_id),planUnits=await planLearningUnits(studentId,assessment.course_id),recent=await recentLearningUnits(user,assessment.course_id);
    let classScope=[];const m=measurementOf(assessment);
    if(includeClassScope&&m?.intended_class_id){const ctx=await classContext(studentId,m.intended_class_id);classScope=Array.isArray(ctx.blueprint?.planned_learning_unit_refs)?ctx.blueprint.planned_learning_unit_refs.map(String):[];}
    return {eligibilityRows,planLearningUnits:planUnits,recentLearningUnitIds:recent,classLearningUnitIds:classScope};
  }
  function requirementsFor(assessment){
    const type=typeOf(assessment),profile=profileFor(type),m=measurementOf(assessment)||{};
    return Object.freeze({contract_version:D19_CONTRACT_VERSION,assessment_type:type,purpose:profile.purpose,scope_mode:profile.scopeMode,gradebook_posture:profile.gradebookPosture,locked_standard_after_start:true,anti_recency:CUMULATIVE(type),formal_graded_bases:['TAUGHT','VALIDATED_PRIOR_KNOWLEDGE'],student_visibility:m.student_visibility||'ANNOUNCED',d20_marks_owner:true,d21_progression_owner:true});
  }
  function CUMULATIVE(type){return ['MID_SEMESTER','FINAL_EXAMINATION'].includes(String(type));}

  async function createDefinition(user,input={}){
    const normalized=normalizeDefinition(input,{impromptuPolicy,eligibilityPolicy});
    let sourceLineage=normalized.sourceLineage;
    if(['CLASSWORK','IMPROMPTU_TEST'].includes(normalized.assessmentType)){
      const ctx=await classContext(sid(user),normalized.measurement.intended_class_id);
      if(String(ctx.classRow.course_id)!==String(normalized.courseId))fail('Assessment Class and Course do not match.','TEACHING_D19_CLASS_COURSE_MISMATCH',409);
      sourceLineage={...sourceLineage,d19_measurement:{...normalized.measurement,intended_class_scheduled_start_at:ctx.classRow.scheduled_start_at,intended_class_scheduled_end_at:ctx.classRow.scheduled_end_at,intended_class_schedule_version:Number(ctx.classRow.schedule_version)}};
      if(normalized.assessmentType==='IMPROMPTU_TEST'){
        const classes=await annotateClasses(user,normalized.courseId,normalized.measurement.intended_class_id,Number(impromptuPolicy.decision.maximum_graded_impromptu_per_completed_classes?.window||3)+1);
        const prior=await d17Service.list(user,{courseId:normalized.courseId,limit:500});
        assertImpromptuBudget({policyDecision:impromptuPolicy.decision,classes,priorAssessments:prior,targetClassId:normalized.measurement.intended_class_id,trigger:normalized.measurement.academic_trigger,graded:normalized.graded});
      }
    }
    return d17Service.createDefinition(user,{...normalized,sourceLineage});
  }

  async function list(user,filters={}){
    const rows=await d17Service.list(user,filters),at=now().getTime();
    return rows.filter(row=>{
      if(typeOf(row)!=='IMPROMPTU_TEST')return true;
      const end=measurementOf(row)?.intended_class_scheduled_end_at;
      return end?at>=new Date(end).getTime():false;
    }).map(row=>row);
  }

  async function getMeasurementPolicy(user,assessmentId){
    const assessment=await d17Repository.requireAssessment(sid(user),assessmentId),m=measurementOf(assessment),profile=profileFor(typeOf(assessment));
    return Object.freeze({contractVersion:D19_CONTRACT_VERSION,assessmentId:assessment.assessment_id,assessmentType:assessment.assessment_type,purpose:profile.purpose,graded:Boolean(assessment.graded),gradebookPosture:profile.gradebookPosture,scopeMode:profile.scopeMode,studentVisibility:m?.student_visibility||'ANNOUNCED',feedbackPosture:profile.feedbackPosture,lockedStandardAfterStart:true,officialMarksOwner:'D20',progressionOwner:'D21',promptMutation:false,modelRouteQualification:'UNQUALIFIED_UNTIL_D30'});
  }

  async function prepareBlueprint(user,assessmentId,input={}){
    const assessment=await d17Repository.requireAssessment(sid(user),assessmentId),requirements=requirementsFor(assessment);
    const result=await d17Service.prepareBlueprint(user,assessmentId,{...input,measurementRequirements:{...(input.measurementRequirements||{}),...requirements},sourceStateVersions:{...(input.sourceStateVersions||{}),d19_contract_version:D19_CONTRACT_VERSION,d19_policy_version:assessment.policy_version}});
    const blueprint=result?.blueprint||await d17Repository.latestBlueprint(sid(user),assessmentId);
    const context=await measurementContext(user,assessment,blueprint);
    assertTypeBlueprint({assessment,blueprint,...context});
    return {...result,measurementAudit:{contractVersion:D19_CONTRACT_VERSION,accepted:true,type:assessment.assessment_type}};
  }

  async function reconcileAndLock(user,assessmentId,input={}){
    const studentId=sid(user),assessment=await d17Repository.requireAssessment(studentId,assessmentId),blueprint=input.blueprintId?await d17Repository.blueprint(studentId,input.blueprintId):await d17Repository.latestBlueprint(studentId,assessmentId);
    if(!blueprint)fail('Assessment Blueprint is required before D19 final measurement validation.','TEACHING_D19_BLUEPRINT_REQUIRED',409);
    const context=await measurementContext(user,assessment,blueprint);assertTypeBlueprint({assessment,blueprint,...context});
    if(typeOf(assessment)==='IMPROMPTU_TEST'){
      const m=measurementOf(assessment),classes=await annotateClasses(user,assessment.course_id,m.intended_class_id,Number(impromptuPolicy.decision.maximum_graded_impromptu_per_completed_classes?.window||3)+1),prior=await d17Service.list(user,{courseId:assessment.course_id,limit:500});
      assertImpromptuBudget({policyDecision:impromptuPolicy.decision,classes,priorAssessments:prior.filter(a=>String(a.assessment_id)!==String(assessmentId)),targetClassId:m.intended_class_id,durationMinutes:Number(blueprint.duration_minutes),trigger:m.academic_trigger,graded:Boolean(assessment.graded)});
    }
    const locked=await d17Service.reconcileAndLock(user,assessmentId,input);
    return {...locked,measurementAudit:{contractVersion:D19_CONTRACT_VERSION,type:assessment.assessment_type,policyVersion:assessment.policy_version,coverageValidated:true}};
  }

  async function startAttempt(user,assessmentId,input={}){
    const studentId=sid(user),assessment=await d17Repository.requireAssessment(studentId,assessmentId);
    if(typeOf(assessment)==='IMPROMPTU_TEST'){
      const m=measurementOf(assessment),ctx=await classContext(studentId,m?.intended_class_id),pack=await d17Repository.packageById(studentId,input.packageId);
      if(!pack||pack.package_state!=='LOCKED')fail('Impromptu exposure requires the pre-existing locked D17 Package.','TEACHING_D19_IMPROMPTU_LOCKED_PACKAGE_REQUIRED',409);
      const classes=await annotateClasses(user,assessment.course_id,m.intended_class_id,Number(impromptuPolicy.decision.maximum_graded_impromptu_per_completed_classes?.window||3)+1),prior=await d17Service.list(user,{courseId:assessment.course_id,limit:500});
      assertImpromptuBudget({policyDecision:impromptuPolicy.decision,classes,priorAssessments:prior.filter(a=>String(a.assessment_id)!==String(assessmentId)),targetClassId:m.intended_class_id,durationMinutes:Number(pack.duration_minutes),trigger:m.academic_trigger,graded:Boolean(assessment.graded)});
      const time=classTimeContract({classRow:ctx.classRow,session:ctx.session,durationMinutes:Number(pack.duration_minutes),serverNow:now()});
      const result=await d17Service.startAttempt(user,assessmentId,input);return {...result,classTimeContract:time,surpriseExposure:'NOW_EXPOSED'};
    }
    return d17Service.startAttempt(user,assessmentId,input);
  }

  async function resolveMissed(user,assessmentId,{reason,systemFailure=false}={}){
    const assessment=await d17Repository.requireAssessment(sid(user),assessmentId);return Object.freeze({assessmentId,assessmentType:assessment.assessment_type,...missedDisposition({assessmentType:assessment.assessment_type,graded:Boolean(assessment.graded),reason,systemFailure}),preservesOriginalHistory:true,resit:false});
  }

  async function createMakeUp(user,sourceAssessmentId,{authorityRef,reason,idempotencyKey=null}={}){
    const studentId=sid(user),source=await d17Repository.requireAssessment(studentId,sourceAssessmentId),disposition=missedDisposition({assessmentType:source.assessment_type,graded:Boolean(source.graded),reason,systemFailure:String(reason||'').toUpperCase()==='SYSTEM_PROTECTED'});
    if(!['EQUIVALENT_REPLACEMENT','EQUIVALENT_REPLACEMENT_OR_FAIR_RECOVERY','MAKE_UP_OR_INCOMPLETE'].includes(disposition.nextAction)&&!(disposition.nextAction==='EQUIVALENT_REPLACEMENT' || (disposition.nextAction==='EQUIVALENT_REPLACEMENT'&&source.graded)))fail('Authoritative missed-work state does not permit a Make-Up replacement.','TEACHING_D19_MAKE_UP_NOT_AUTHORIZED',409,{disposition});
    const sourceBlueprint=await d17Repository.latestBlueprint(studentId,sourceAssessmentId),lineage=makeUpLineage({sourceAssessment:source,sourceBlueprint,authorityRef,reason});
    const key=String(idempotencyKey||`d19-makeup:${sourceAssessmentId}:${authorityRef}`);
    const created=await d17Service.createDefinition(user,{courseId:source.course_id,assessmentType:'MAKE_UP',purpose:`Equivalent replacement: ${source.purpose}`,title:`Make-Up — ${source.title}`,graded:Boolean(source.graded),definitionState:'PLANNED',announcedScope:{scope_kind:'SOURCE_BLUEPRINT_EQUIVALENT',source_assessment_id:sourceAssessmentId,exact_questions_hidden:true},policyVersion:`${D19_CONTRACT_VERSION}|make-up|${source.policy_version}`,sourceLineage:lineage,idempotencyKey:key});
    const target=created.assessment;
    const blueprint=await d17Service.prepareBlueprint(user,target.assessment_id,{blueprint:blueprintInputFromRow(sourceBlueprint),maturity:'PRE_LOCK_READY',sourceStateVersions:{d19_contract_version:D19_CONTRACT_VERSION,source_assessment_id:sourceAssessmentId,source_blueprint_id:sourceBlueprint.assessment_blueprint_id,source_blueprint_version:Number(sourceBlueprint.version_no)},provenanceRefs:[String(authorityRef),`assessment:${sourceAssessmentId}`,`blueprint:${sourceBlueprint.assessment_blueprint_id}`],idempotencyKey:`${key}:blueprint`});
    return Object.freeze({assessment:created.assessment,blueprint:blueprint.blueprint,idempotent:Boolean(created.idempotent&&blueprint.idempotent),sourceAssessmentId,sourceBlueprintId:sourceBlueprint.assessment_blueprint_id,freshCandidateGenerationRequired:true,sourceCandidateReuseForbidden:true,answerReleaseBlockedWhileReplacementLive:true,preservesOriginalHistory:true});
  }

  async function getMarkReviewHandoff(user,attemptId){const studentId=sid(user),attempt=await d17Repository.requireAttempt(studentId,attemptId),assessment=await d17Repository.requireAssessment(studentId,attempt.assessment_id);if(!['SUBMITTED','EXPIRED'].includes(String(attempt.attempt_state)))fail('D20 handoff requires a finalized student Attempt.','TEACHING_D19_D20_HANDOFF_ATTEMPT_NOT_FINAL',409);return markReviewHandoff({assessment,attempt});}
  async function getRetentionEvidenceHandoff(user,attemptId,resultRef){const studentId=sid(user),attempt=await d17Repository.requireAttempt(studentId,attemptId),assessment=await d17Repository.requireAssessment(studentId,attempt.assessment_id);return retentionEvidenceHandoff({assessment,attemptId,resultRef});}

  return Object.freeze({...d17Service,createDefinition,list,prepareBlueprint,reconcileAndLock,startAttempt,getMeasurementPolicy,resolveMissed,createMakeUp,getMarkReviewHandoff,getRetentionEvidenceHandoff,contractVersion:D19_CONTRACT_VERSION,typeProfiles:TYPE_PROFILES});
}
module.exports={createD19AssessmentTypeService};