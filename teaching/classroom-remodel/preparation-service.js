'use strict';
const c=require('./contracts');const {validateAuthor,validatePresenter}=require('./mode-schemas');
const {validateGuide,validateDepth}=require('./academic-artifacts');
const {resolveCandidateFamily}=require('./candidate-registry');
const {evaluateFinalizationReadiness}=require('../preparation/t0-handlers');
const {createPreparationWorkflowPlan}=require('../preparation/workflow');
const {shouldDeferPreparation}=require('../d11/preparation-window');
const VERSION='classroom-preparation.v1';
function preparationWorkflow(profile){return createPreparationWorkflowPlan({profile,stages:[
 {stage:'Seed',capabilityId:'teaching.lesson.pre_class_lesson_planning',routePosture:'strong_design',reviewPurpose:'Complete chapter authoring and exact continuation'},
 {stage:'Shape',capabilityId:'teaching.lesson.pre_class_lesson_planning',routePosture:'strong_design',reviewPurpose:'Feasible plan and D11 Blueprint binding'},
 {stage:'Candidate Development',capabilityId:'teaching.pedagogy.subject_sensitive_instructional_strategy',routePosture:'strong_design',reviewPurpose:'Source-bound guidance and bounded opening'},
 {stage:'Independent Validation',capabilityId:'teaching.crosscutting.model_output_schema_domain_validation',independent:true,reviewPurpose:'Require independently produced review receipts; deterministic receipt validation is not the review itself'},
 {stage:'Whole-Artifact Review',capabilityId:'teaching.crosscutting.model_output_schema_domain_validation',independent:true,reviewPurpose:'Required profile-level whole-artifact review'},
 {stage:'Final Revalidation',capabilityId:'teaching.preparation.finalization_readiness_gate',reviewPurpose:'Re-read current authority, dependencies, assets and PPL findings'},
 {stage:'Handoff',capabilityId:'teaching.preparation.workspace_state_transition',reviewPurpose:'Existing D11/PPL finalization and private prepared opening only'},
]});}
function createClassroomPreparationService({repository,d11Repository,preparationRepository,intelligence,reviewArtifact,reviewWholeArtifact,getRequirements,acceptBlueprint,finalizePpl,releaseGate,currentDependencyVersion,assetReadiness,clock=()=>new Date()}={}){
 for(const [value,method]of [[repository,'saveCandidate'],[d11Repository,'getClassContext'],[preparationRepository,'getWorkspaceSnapshot']])if(typeof value?.[method]!=='function')throw new TypeError('Classroom preparation requires existing repositories');
 async function gate(){const result=typeof releaseGate==='function'?await releaseGate():null;return result?.delivery1GatePassed===true&&result?.routesQualified===true?result:{delivery1GatePassed:false,routesQualified:false,reason:'CLASSROOM_CONTRACT_OR_ROUTE_NOT_QUALIFIED'};}
 function producer(kind){const familyId={chapter:'TPF-05',plan:'TPF-05',guide:'TPF-21',opening:'TPF-08'}[kind];const family=resolveCandidateFamily(familyId);return {familyId,capabilityId:{chapter:'teaching.lesson.pre_class_lesson_planning',plan:'teaching.lesson.pre_class_lesson_planning',guide:'teaching.pedagogy.subject_sensitive_instructional_strategy',opening:'teaching.pedagogy.natural_teacher_explanation_generation'}[kind],mode:{chapter:'pre_class_lesson_blueprint',plan:'pre_class_lesson_blueprint',guide:'prepare_guidance',opening:'natural_teacher_instruction'}[kind],schemaVersion:c.VERSION,promptSha256:family.sha256};}
 async function dependenciesCurrent(studentId,ids){
  const stale=[];for(const id of ids){const own=await repository.loadArtifact(studentId,id);if(!own||own.validity_state!=='CURRENT')stale.push(id);for(const d of await repository.getDependencies(studentId,id)){
   let current;if(d.dependency_artifact_version_id){const a=await repository.loadArtifact(studentId,d.dependency_artifact_version_id);current=a?.validity_state==='CURRENT'?a.logical_version:null;}else current=typeof currentDependencyVersion==='function'?await currentDependencyVersion(d):null;
   if(current==null||String(current)!==d.version_ref)stale.push(d.aggregate_ref);
  }}return stale;
 }
 async function prepare(user,classId,{operationKey,parentChapterId=null}={}){
  c.string(user?.id,'student identity');c.string(operationKey,'operation key');const authorization=await gate();if(!authorization.delivery1GatePassed)return {prepared:false,published:false,hold:authorization.reason};
  for(const f of [reviewArtifact,reviewWholeArtifact,getRequirements,acceptBlueprint,finalizePpl,assetReadiness])if(typeof f!=='function')c.fail('CLASSROOM_PREPARATION_OWNER_UNAVAILABLE');
  if(!intelligence||['author','coordinator','presenter'].some(role=>typeof intelligence[role]!=='function'))c.fail('CLASSROOM_PREPARATION_INTELLIGENCE_UNAVAILABLE');
  const context=await d11Repository.getClassContext(String(user.id),classId);if(!context)c.fail('CLASSROOM_CLASS_NOT_FOUND');
  if(shouldDeferPreparation(context.classRow.scheduled_start_at,clock()))return {prepared:false,published:false,hold:'EXISTING_D11_PREPARATION_WINDOW',deferred:true};
  const requirements=await getRequirements(context);const workflow=preparationWorkflow(requirements.profile);
  const workspace=await d11Repository.ensurePreparationWorkspace({studentId:String(user.id),classId});if(!workspace?.workspace)c.fail('CLASSROOM_PPL_WORKSPACE_UNAVAILABLE');
  const parent=parentChapterId?await repository.loadArtifact(String(user.id),parentChapterId):null;
  if(parentChapterId&&(!parent||parent.class_id!==classId||parent.artifact_kind!=='chapter'))c.fail('CLASSROOM_CONTINUATION_PARENT_INVALID');
  const cachedChapter=await repository.loadOperation(String(user.id),classId,'chapter',operationKey+':chapter');
  if(cachedChapter&&cachedChapter.validity_state!=='CURRENT')c.fail('CLASSROOM_PREPARATION_OPERATION_STALE');
  const output=cachedChapter?cachedChapter.generation_context:await intelligence.author({context,requirements,previousChapter:parent?.payload||null,producer:producer('chapter'),workflow});validateAuthor(output,{mode:'pre_class_lesson_blueprint'});
  if(output.artifacts.chapter)validateDepth(output.artifacts.chapter,requirements.depth);
  if(!output.artifacts.chapter)return {prepared:false,published:false,hold:output.status};
  const base={studentId:String(user.id),classId,coursePlanId:context.plan.course_plan_id,workspaceId:workspace.workspace.workspace_id,inputBundleId:workspace.workspace.current_authoritative_input_bundle_ref,expectedScheduleVersion:context.classRow.schedule_version,expectedPlanVersion:context.plan.version_no};
  const rootDeps=requirements.dependencies;const dep=(kind,a)=>({kind,ref:a.logical_id,version:a.logical_version,artifactId:a.artifact_version_id});
  const chapter=cachedChapter||await repository.saveCandidate({...base,operationKey:operationKey+':chapter',logicalId:output.artifacts.chapter.id,logicalVersion:output.artifacts.chapter.version,kind:'chapter',payload:output.artifacts.chapter,producer:producer('chapter'),context:requirements.depth,dependencies:rootDeps,parentId:parentChapterId,generationContext:output});
  if(chapter.completeness!=='complete')return {prepared:false,published:false,hold:'PARTIAL_CHAPTER',chapterArtifactId:chapter.artifact_version_id,continuation:chapter.payload.continuation};
  if(output.status!=='ok'||output.completion.teaching_plan!=='complete')return {prepared:false,published:false,hold:'PLAN_INCOMPLETE',chapterArtifactId:chapter.artifact_version_id};
  const plan=await repository.saveCandidate({...base,operationKey:operationKey+':plan',logicalId:output.artifacts.teaching_plan.id,logicalVersion:output.artifacts.teaching_plan.version,kind:'plan',payload:output.artifacts.teaching_plan,producer:producer('plan'),context:{chapter:chapter.payload},dependencies:[...rootDeps,dep('chapter',chapter),{kind:'schedule',ref:classId,version:String(base.expectedScheduleVersion),artifactId:null}]});
  const cachedGuide=await repository.loadOperation(String(user.id),classId,'guide',operationKey+':guide');
  if(cachedGuide&&cachedGuide.validity_state!=='CURRENT')c.fail('CLASSROOM_PREPARATION_OPERATION_STALE');
  const guidance=cachedGuide?cachedGuide.generation_context:await intelligence.coordinator({context,chapter:chapter.payload,plan:plan.payload,producer:producer('guide'),requirements});c.validateCoordinator(guidance,{mode:'prepare_guidance',chapter:chapter.payload});
  if(!guidance.artifacts.explanation_guides)return {prepared:false,published:false,hold:'GUIDANCE_INCOMPLETE',chapterArtifactId:chapter.artifact_version_id,planArtifactId:plan.artifact_version_id};
  validateGuide(guidance.artifacts.explanation_guides,{chapter:chapter.payload,essentialAnchors:guidance.status==='complete'?requirements.essentialAnchors:[]});
  const guide=cachedGuide||await repository.saveCandidate({...base,operationKey:operationKey+':guide',logicalId:plan.logical_id+':guide',logicalVersion:plan.logical_version,kind:'guide',payload:guidance.artifacts.explanation_guides,producer:producer('guide'),context:{chapter:chapter.payload,essentialAnchors:requirements.essentialAnchors,declaredCompleteness:guidance.status},dependencies:[dep('chapter',chapter),dep('plan',plan)],generationContext:guidance});
  if(guide.completeness!=='complete'||guidance.issues.some(i=>!i.can_safely_continue))return {prepared:false,published:false,hold:'GUIDANCE_INCOMPLETE',guideArtifactId:guide.artifact_version_id};
  const directive=c.bindDirective({action:'continue'},requirements.openingDirective).directive;
  const cachedOpening=await repository.loadOperation(String(user.id),classId,'opening',operationKey+':opening');
  if(cachedOpening&&cachedOpening.validity_state!=='CURRENT')c.fail('CLASSROOM_PREPARATION_OPERATION_STALE');
  const openingOutput=cachedOpening?cachedOpening.payload:await intelligence.presenter({context,directive,chapter:chapter.payload,guide:guide.payload,producer:producer('opening')});validatePresenter(openingOutput,{directive,chapter:chapter.payload,supportedBoardOperations:requirements.supportedBoardOperations});
  if(openingOutput.status!=='ok'||openingOutput.interaction.preparation_completion!=='complete')return {prepared:false,published:false,hold:'OPENING_INCOMPLETE'};
  const opening=cachedOpening||await repository.saveCandidate({...base,operationKey:operationKey+':opening',logicalId:plan.logical_id+':opening',logicalVersion:plan.logical_version,kind:'opening',payload:openingOutput,producer:producer('opening'),context:{directive,chapter:chapter.payload,supportedBoardOperations:requirements.supportedBoardOperations},dependencies:[dep('chapter',chapter),dep('guide',guide)]});
  const artifacts=[chapter,plan,guide,opening];for(const artifact of artifacts){if(artifact.validation_state==='VALIDATED')continue;const receipt=await reviewArtifact({artifact,workflow,context});await repository.recordValidation({studentId:base.studentId,artifactId:artifact.artifact_version_id,receipt});}
  const wholeReview=await reviewWholeArtifact({artifacts,workflow,context});if(wholeReview?.accepted!==true||wholeReview.independent!==true||wholeReview.routeQualified!==true||!wholeReview.reviewId||JSON.stringify(wholeReview.contentHashes)!==JSON.stringify(artifacts.map(a=>a.content_sha256)))c.fail('CLASSROOM_WHOLE_ARTIFACT_REVIEW_REQUIRED');
  const stale=await dependenciesCurrent(base.studentId,artifacts.map(a=>a.artifact_version_id));const refreshed=await d11Repository.getClassContext(base.studentId,classId);const snapshot=await preparationRepository.getWorkspaceSnapshot(base.workspaceId);const assets=await assetReadiness({opening,chapter,context:refreshed});
  const readiness=evaluateFinalizationReadiness({versions:[{id:'schedule',expected:String(base.expectedScheduleVersion),current:String(refreshed?.classRow?.schedule_version)},{id:'plan',expected:String(base.expectedPlanVersion),current:String(refreshed?.plan?.version_no)}],requiredValidations:[{id:'dependencies',passed:stale.length===0},{id:'assets',passed:assets?.ready===true}],openFindings:(snapshot?.findings||[]).map(f=>({id:f.finding_id,status:f.status,blocksFinalization:f.severity==='BLOCKING'})),protectionChecks:[{id:'unprotected',passed:snapshot?.workspace?.protected_content_class==='UNPROTECTED'}],policyChecks:[{id:'course',passed:refreshed?.classRow?.course_lifecycle_state==='ACTIVE'}],feasibilityChecks:[{id:'scheduled',passed:refreshed?.classRow?.lifecycle_state==='SCHEDULED'}]});
  if(!readiness.ready)return {prepared:false,published:false,hold:'FINAL_REVALIDATION_FAILED',blockers:readiness.blockers};
  const blueprint=await acceptBlueprint({context:refreshed,chapter,plan,workflow,operationKey:operationKey+':blueprint'});const ppl=await finalizePpl({context:refreshed,workflow,artifacts,readiness,operationKey:operationKey+':finalization'});
  if(!ppl?.ready)return {prepared:false,published:false,hold:'EXISTING_PPL_FINALIZATION_HELD'};
  return repository.bindReady({...base,blueprintId:blueprint.lesson_blueprint_id,chapterId:chapter.artifact_version_id,planId:plan.artifact_version_id,guideId:guide.artifact_version_id,openingId:opening.artifact_version_id,receipt:{ready:true,delivery1GatePassed:true,routesQualified:true,pplReady:true,workflowVersion:VERSION,wholeArtifactReview:wholeReview,artifactHashes:artifacts.map(a=>a.content_sha256),readiness}});
 }
 async function getPublicChapter(user,classId){
  c.string(user?.id,'student identity');const authorization=await gate();if(!authorization.delivery1GatePassed)c.fail('CLASSROOM_CONTRACT_OR_ROUTE_NOT_QUALIFIED');
  const context=await d11Repository.getClassContext(String(user.id),classId);if(context?.session?.classroom_engine!=='CLASSROOM_V1')c.fail('CLASSROOM_SESSION_NOT_REMODELED');
  const binding=await repository.loadBinding(String(user.id),classId);if(!binding||String(binding.schedule_version)!==String(context.classRow.schedule_version)||String(binding.course_plan_version)!==String(context.plan.version_no)||binding.course_plan_id!==context.plan.course_plan_id)c.fail('CLASSROOM_CHAPTER_BINDING_STALE');
  if(context.session.classroom_chapter_artifact_id!==binding.chapter_artifact_id||context.session.lesson_blueprint_id!==binding.lesson_blueprint_id)c.fail('CLASSROOM_CHAPTER_SESSION_PIN_MISMATCH');
  const ids=[binding.chapter_artifact_id,binding.plan_artifact_id,binding.guide_artifact_id,binding.opening_artifact_id];if((await dependenciesCurrent(String(user.id),ids)).length)c.fail('CLASSROOM_CHAPTER_DEPENDENCIES_STALE');
  const chapter=await repository.loadArtifact(String(user.id),binding.chapter_artifact_id);if(!chapter||chapter.validation_state!=='VALIDATED'||chapter.validity_state!=='CURRENT')c.fail('CLASSROOM_CHAPTER_NOT_PUBLIC_READY');return c.projectChapter({...chapter.payload,validation:'validated'});
 }
 return {version:VERSION,prepare,getPublicChapter,dependenciesCurrent};
}
module.exports={VERSION,preparationWorkflow,createClassroomPreparationService};
