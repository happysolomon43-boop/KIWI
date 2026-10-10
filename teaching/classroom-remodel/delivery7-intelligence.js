'use strict';

const {getCapability}=require('../capability-registry');
const {lessonPlanRequest,normalizeD11AcademicInput}=require('../d11/intelligence');
const {getModeSchema}=require('./mode-schemas');
const {createCandidateInvocationBinding}=require('./invocation-binding');
const {hash}=require('./academic-artifacts');
const {failure,value,assertPresentationPolicy}=require('./presentation-policy');
const MODES=Object.freeze({
 prepare_continuity:{role:'coordinator',familyId:'TPF-21',capabilityId:'teaching.pedagogy.knowledge_type_sensitive_review_strategy'},
 guide_assessment:{role:'coordinator',familyId:'TPF-21',capabilityId:'teaching.pedagogy.subject_appropriate_evidence_task_design'},
 lesson_closure_analysis:{role:'author',familyId:'TPF-05',capabilityId:'teaching.lesson.lesson_closure_analysis'},
 homework_design_generate:{role:'author',familyId:'TPF-05',capabilityId:'teaching.scheduling.purposeful_homework_selection_generation'},
 homework_to_next_lesson_synthesis:{role:'author',familyId:'TPF-05',capabilityId:'teaching.scheduling.homework_to_next_lesson_synthesis'},
 rolling_planning_horizon:{role:'author',familyId:'TPF-05',capabilityId:'teaching.scheduling.rolling_planning_horizon_adjustment'},
});

function delivery7Request({context,mode,requestKey,record=null,history=null,requirements,chapter=null}={}) {
 const binding=MODES[mode];
 if(!binding)throw failure('CLASSROOM_DELIVERY_SEVEN_MODE_UNAVAILABLE',422);
 if(typeof requestKey!=='string'||!requestKey.trim())throw failure('CLASSROOM_OPERATION_KEY_REQUIRED',422);
 if(!requirements?.version||!requirements.adoptionRef)throw failure('CLASSROOM_PLANNING_REQUIREMENTS_NOT_ADOPTED',503);
 assertPresentationPolicy(requirements.numericPolicy);
 if(!require('./state-policy').capabilityReadiness(requirements.numericPolicy,'generation').ready)throw failure('CLASSROOM_GENERATION_POLICY_MISSING',503);
 if(mode!=='prepare_continuity'&&(!record?.record_id||!record.content_hash||!record.record))throw failure('CLASSROOM_PLANNING_ACTUAL_RECORD_REQUIRED',409);
 if(mode==='guide_assessment'&&!record?.record?.exposure_and_assistance)throw failure('CLASSROOM_ASSESSMENT_EXPOSURE_CONTEXT_REQUIRED',409);
 if(mode==='homework_design_generate'&&(!Array.isArray(requirements.permittedResources)||!requirements.workload?.validated||!requirements.workload.ownerRef))throw failure('CLASSROOM_HOMEWORK_WORKLOAD_OR_RESOURCES_REQUIRED',409);
 if(mode==='rolling_planning_horizon'&&(!Array.isArray(requirements.scheduledClasses)||!requirements.scheduledClasses.length))throw failure('CLASSROOM_EXISTING_SCHEDULE_REQUIRED',409);
 const base=lessonPlanRequest({context,signals:{},requestKey});
 const capability=getCapability(binding.capabilityId),schema=getModeSchema(binding.role,mode,{chapter});
 const sourceRefs=[...(record?[`classroom-record:${record.record_id}@${record.content_hash}`]:[]),...(history?.records||[]).flatMap(r=>[r.closure_ref,r.record_ref]).filter(Boolean)];
 const academicInput=normalizeD11AcademicInput({
  approved_course_plan:base.academicInput.course_plan,
  actual_class_record:record?.record||null,
  history:history?{state:history.state,records:(history.records||[]).slice(0,3).map(r=>({session_id:r.session_id,closure_ref:r.closure_ref,record_ref:r.record_ref||null,record_created_at:r.record_created_at||null,state:r.state,classroom:r.classroom||null})),horizon_is_retention_policy:false}:null,
  chapter,
  source_refs:sourceRefs,
  permitted_resources:mode==='homework_design_generate'?requirements.permittedResources:[],
  workload:requirements.workload||null,
  already_scheduled_classes:requirements.scheduledClasses||[],
  requirements_binding:{version:requirements.version,adoption_ref:requirements.adoptionRef},
  pinned_numeric_policy:requirements.numericPolicy,
  rules:{publication_is_not_mastery:true,missing_or_excused_work_is_not_weakness:true,follow_up_requires_owner_confirmation:true,homework_generation_requires_explicit_mode:true,assignment_and_deadline_owner:'D16',schedule_owner:'D09/D10',assessment_eligibility_owner:'D17',marks_owner:'D20',protected_future_packages_excluded:true},
 });
 const forbidden=/^(?:answer_key|protected_package|future_assessment|official_mark|official_grade|integrity_signals)$/i;
 function inspect(v){if(!v||typeof v!=='object')return;for(const [k,x] of Object.entries(v)){if(forbidden.test(k))throw failure('CLASSROOM_PLANNING_PROTECTED_CONTEXT',422);inspect(x);}}
 inspect(academicInput);
 const inputHash=hash(academicInput);
 let attempts=0;
 return {...base,idempotencyKey:requestKey+':'+mode+':'+inputHash,capabilityId:capability.id,declaredAuthorityLevel:capability.authority_ceiling,taskMode:mode,commit:false,
  candidatePromptBinding:createCandidateInvocationBinding({...binding,mode}),outputSchema:schema,
  generation:{maxOutputTokens:value(requirements.numericPolicy,'generationBudget')},
  beforeAttempt:async()=>{if(attempts++>=value(requirements.numericPolicy,'generationRetryLimit')+1)throw failure('CLASSROOM_GENERATION_RETRY_BUDGET_EXHAUSTED',503);},
  academicInput,
  contextSpec:{...base.contextSpec,context_kind:'classroom_delivery_seven_planning',access_purpose:mode,provenance_refs:sourceRefs.map(ref=>({ref})),forbidden_context:['protected_future_assessment_packages','private_answer_keys','unrelated_student_history']},
  directive:{...base.directive,bounded_actions:['Return only the requested provisional planning artifact grounded in supplied actual records'],allowed_operations:['Propose homework, no homework, continuity or instructional guidance'],prohibited_operations:['Assign work or deadlines','Schedule a Class or follow-up appointment','Expand assessment eligibility','Lock packages','Write marks or mastery','Treat missing or excused work as weakness'],downstream_handoff:{...base.directive.downstream_handoff,commit_owner_boundary:capability.authoritative_owner_boundary}},
  resultContract:{...base.resultContract,output_schema_id:schema.id,output_schema_version:schema.version},
  schemaValidator:schema.validate,domainValidator:schema.validate,provenanceValidator:schema.validate,
  planningBinding:Object.freeze({mode,inputHash,recordHash:record?.content_hash||null,requirementsVersion:requirements.version}),
 };
}

function createDelivery7Intelligence({orchestrator,d11Repository,continuityRepository,requirementsReader,reviewer=null,chapterReader=null}={}) {
 if(typeof orchestrator?.execute!=='function'||!d11Repository||!continuityRepository||typeof requirementsReader!=='function')throw new TypeError('Delivery 7 requires existing orchestration, owned records and adopted requirements');
 async function inputs(args){
  const context=await d11Repository.getClassContext(args.studentId,args.classId);
  if(!context)throw failure('CLASSROOM_SESSION_NOT_FOUND',404);
  const record=args.mode==='prepare_continuity'?null:await continuityRepository.latestRecord(args.studentId,args.classId);
  const history=await continuityRepository.history(args.studentId,args.classId);
  const requirements=await requirementsReader({...args,context,record,history});
  const chapter=chapterReader?await chapterReader({...args,context,record}):null;
  return {context,record,history,requirements,chapter,mode:args.mode,requestKey:args.operationKey};
 }
 async function propose(args){
  if(typeof reviewer?.accept!=='function')return {held:true,reason:'CLASSROOM_PLANNING_REVIEW_ROUTE_UNAVAILABLE',committed:false};
  const request=delivery7Request(await inputs(args));
  const abort=new AbortController();let timer,result;
  const timeout=new Promise(resolve=>{timer=setTimeout(()=>{abort.abort();resolve({held:true,reason:'CLASSROOM_PLANNING_GENERATION_OUTCOME_UNKNOWN'});},value(request.academicInput.pinned_numeric_policy,'generationTimeoutMs'));});
  try{result=await Promise.race([orchestrator.execute({...request,signal:abort.signal}),timeout]);}finally{clearTimeout(timer);}
  if(result?.held)return {...result,committed:false};
  const output=result?.validatedResult?.output;
  if(!result?.accepted||!output)return {held:true,reason:'CLASSROOM_PLANNING_RESULT_NOT_ACCEPTED',committed:false};
  if(!['ok','complete'].includes(output.status))return {held:true,reason:'CLASSROOM_PLANNING_PROPOSAL_REQUIRES_REVIEW',output,committed:false};
  const checked=await request.outputSchema.validate(output);
  if(!checked.ok)throw failure(checked.reason,422);
  const receipt=await reviewer.accept({studentId:args.studentId,classId:args.classId,mode:args.mode,output,binding:request.planningBinding,executionId:result.executionId});
  if(!receipt?.accepted||!receipt.independent||!result.executionId||receipt.executionId!==result.executionId||receipt.inputHash!==request.planningBinding.inputHash||receipt.outputHash!==hash(output)||!receipt.ownerRef)return {held:true,reason:'CLASSROOM_PLANNING_INDEPENDENT_REVIEW_REQUIRED',committed:false};
  const current=delivery7Request(await inputs(args));
  if(current.planningBinding.inputHash!==request.planningBinding.inputHash)throw failure('CLASSROOM_PLANNING_RESULT_STALE',409);
  return {proposed:true,committed:false,mode:args.mode,output,receipt,binding:request.planningBinding,assignmentCreated:false,followUpScheduled:false,officialOutcome:false};
 }
 return Object.freeze({propose});
}
module.exports={MODES,delivery7Request,createDelivery7Intelligence};
