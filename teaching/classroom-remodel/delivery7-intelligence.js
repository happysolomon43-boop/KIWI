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


function reviewedContinuationLinks({receipt,history}={}) {
 const selected=receipt?.approvedQuestionRefs;
 if(!receipt?.accepted||!receipt.independent||!receipt.ownerRef||!Array.isArray(selected))
  throw failure('CLASSROOM_CONTINUITY_OWNER_SELECTION_REQUIRED',409);
 const permitted=new Set((history?.records||[]).filter(r=>r.state==='EXACT_RECORDS_AVAILABLE')
  .flatMap(r=>(r.classroom?.pending_questions||[]).filter(q=>q.state==='unresolved at closure')
   .map(q=>String(r.session_id)+':'+String(q.message_id))));
 const seen=new Set();
 return selected.map(ref=>{
  if(!ref||Object.keys(ref).sort().join(',')!=='messageId,sourceSessionId'||
     typeof ref.messageId!=='string'||typeof ref.sourceSessionId!=='string')
   throw failure('CLASSROOM_CONTINUITY_LINK_REFERENCE_INVALID',422);
  const key=ref.sourceSessionId+':'+ref.messageId;
  if(!permitted.has(key)||seen.has(key))throw failure('CLASSROOM_CONTINUITY_SOURCE_NOT_REVIEWABLE',409);
  seen.add(key);return Object.freeze({sourceSessionId:ref.sourceSessionId,messageId:ref.messageId});
 });
}


function validateReviewedOwnerHandoff({proposal,approval,record,workload}={}) {
 const mode=proposal?.mode,expected=mode==='homework_design_generate'?'D16':mode==='guide_assessment'?'D17':null;
 if(!expected)throw failure('CLASSROOM_PLANNING_OWNER_MODE_INVALID',422);
 if(!approval?.approved||!approval.independent||approval.owner!==expected||!approval.ownerRef||
   !approval.reviewRef||approval.inputHash!==proposal.binding?.inputHash||
   approval.outputHash!==hash(proposal.output)||approval.recordHash!==proposal.binding?.recordHash||
   !proposal.receipt?.independent||!proposal.receipt?.accepted)
  throw failure('CLASSROOM_PLANNING_DOMAIN_OWNER_APPROVAL_REQUIRED',409);
 if(!record?.record_id||record.content_hash!==proposal.binding.recordHash)
  throw failure('CLASSROOM_PLANNING_OWNER_RECORD_STALE',409);
 if(mode==='homework_design_generate') {
  const h=proposal.output?.artifacts?.homework_proposal;
  if(!h||typeof h.assign!=='boolean')throw failure('CLASSROOM_HOMEWORK_PROPOSAL_INVALID',422);
  if(!h.assign){if(approval.decision!=='NO_HOMEWORK'||approval.spec)throw failure('CLASSROOM_HOMEWORK_OWNER_DECISION_CONFLICT',409);return {owner:'D16',noHomework:true};}
  const spec=approval.spec;
  if(approval.decision!=='CREATE_APPROVED_ASSIGNMENT'||!workload?.validated||!workload.ownerRef||
    approval.workloadOwnerRef!==workload.ownerRef||
    !spec||!Array.isArray(spec.learningUnitIds)||!spec.learningUnitIds.length||
    !spec.sourceLineage||spec.sourceLineage.classroomRecordRef!==`classroom-record:${record.record_id}@${record.content_hash}`||
    !spec.sourceLineage.classClosureRef||spec.sourceLineage.reviewedProposalHash!==hash(proposal.output)||
    !spec.dueAt||!spec.deadlineType)
   throw failure('CLASSROOM_HOMEWORK_OWNER_SPEC_REQUIRED',409);
  // A reviewed Class task cannot silently penalize missed/excused work or
  // convert unsupported exposure into an official competence claim.
  const actuallyCovered=new Set(record.record?.confirmed_taught_learning_unit_refs||[]);
  if(spec.learningUnitIds.some(id=>!actuallyCovered.has(id))||spec.graded===true||spec.assistanceMode==='FORMAL_ASSESSMENT')
   throw failure('CLASSROOM_HOMEWORK_UNSUPPORTED_SCOPE_OR_AUTHORITY',409);
  return {owner:'D16',noHomework:false,spec};
 }
 if(approval.decision!=='PREPARE_ELIGIBLE_BLUEPRINT'||typeof approval.assessmentId!=='string'||
    !approval.assessmentId||!approval.input?.blueprint||!approval.input?.measurementRequirements||
    approval.input.lane&&approval.input.lane!=='ELIGIBLE_CANDIDATE')
  throw failure('CLASSROOM_ASSESSMENT_OWNER_BLUEPRINT_REQUIRED',409);
 // Existing D17 ownership/eligibility/package validation must still execute.
 return {owner:'D17',assessmentId:approval.assessmentId,input:approval.input};
}

function createDelivery7Intelligence({orchestrator,d11Repository,continuityRepository,requirementsReader,reviewer=null,chapterReader=null,downstreamOwners=null,ownerApprovalReader=null}={}) {
 if(typeof orchestrator?.execute!=='function'||!d11Repository||!continuityRepository||typeof requirementsReader!=='function')throw new TypeError('Delivery 7 requires existing orchestration, owned records and adopted requirements');
 const reviewedContinuity=new WeakMap();
 const reviewedPlanning=new WeakMap();
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
  const proposal={proposed:true,committed:false,mode:args.mode,output,receipt,binding:request.planningBinding,assignmentCreated:false,followUpScheduled:false,officialOutcome:false};
  if(args.mode==='prepare_continuity')reviewedContinuity.set(proposal,{studentId:args.studentId,classId:args.classId,requestKey:args.operationKey,inputHash:request.planningBinding.inputHash,selection:structuredClone(receipt.approvedQuestionRefs||[]),receiptHash:hash(receipt)});
  if(['homework_design_generate','guide_assessment'].includes(args.mode))reviewedPlanning.set(proposal,{studentId:args.studentId,classId:args.classId,requestKey:args.operationKey,inputHash:request.planningBinding.inputHash,outputHash:hash(output),receiptHash:hash(receipt)});
  return proposal;
 }
 // Trusted internal workflow: the independent owner selects exact unresolved
 // source IDs. Merely generating continuity prose cannot schedule or resolve
 // a question; each link remains an unscheduled durable cross-Class reference.
 async function linkReviewedContinuity({studentId,classId,proposal}={}){
  const bound=proposal&&reviewedContinuity.get(proposal);
  if(!bound||bound.studentId!==studentId||bound.classId!==classId||proposal.mode!=='prepare_continuity')
   throw failure('CLASSROOM_CONTINUITY_REVIEWED_PROPOSAL_REQUIRED',409);
  if(hash(proposal.receipt)!==bound.receiptHash)throw failure('CLASSROOM_CONTINUITY_REVIEW_CHANGED',409);
  const current=delivery7Request(await inputs({studentId,classId,mode:'prepare_continuity',operationKey:bound.requestKey}));
  if(current.planningBinding.inputHash!==bound.inputHash||proposal.binding.inputHash!==bound.inputHash)
   throw failure('CLASSROOM_CONTINUITY_REVIEW_STALE',409);
  const links=reviewedContinuationLinks({receipt:{...proposal.receipt,approvedQuestionRefs:bound.selection},history:await continuityRepository.history(studentId,classId)});
  const accepted=[];
  for(const link of links){
   const operationKey='reviewed-continuity:'+hash({inputHash:proposal.binding.inputHash,link});
   const result=await continuityRepository.linkQuestion({...link,studentId,classId,operationKey});
   accepted.push({...link,linkId:result.linkId,replay:result.replay===true});
  }
  return {accepted:true,links:accepted,scheduled:false,questionsResolved:false,academicEvidenceCommitted:false};
 }
 // Explicit D16/D17 owner acceptance follows independent planning review.
 // No owner callback, unadopted workload, stale record or missing D17 Blueprint
 // can be replaced with a Teacher/model promise or an invented deadline.
 async function consumeReviewedPlanning({studentId,classId,proposal}={}){
  const pinned=proposal&&reviewedPlanning.get(proposal);
  if(!pinned||pinned.studentId!==studentId||pinned.classId!==classId)
   throw failure('CLASSROOM_PLANNING_REVIEWED_PROPOSAL_REQUIRED',409);
  if(typeof ownerApprovalReader!=='function')return {held:true,reason:'CLASSROOM_PLANNING_DOMAIN_OWNER_UNAVAILABLE',committed:false};
  const fresh=await inputs({studentId,classId,mode:proposal.mode,operationKey:pinned.requestKey});
  const current=delivery7Request(fresh);
  if(current.planningBinding.inputHash!==pinned.inputHash||hash(proposal.output)!==pinned.outputHash||
    hash(proposal.receipt)!==pinned.receiptHash)
   throw failure('CLASSROOM_PLANNING_OWNER_RESULT_STALE',409);
  const approval=await ownerApprovalReader({studentId,classId,mode:proposal.mode,inputHash:pinned.inputHash,
   outputHash:pinned.outputHash,recordHash:fresh.record?.content_hash,reviewReceipt:proposal.receipt,
   output:proposal.output});
  const reviewed=validateReviewedOwnerHandoff({proposal,approval,record:fresh.record,workload:fresh.requirements.workload});
  if(reviewed.noHomework)return {accepted:true,committed:false,owner:'D16',assignmentCreated:false,
   decision:'NO_HOMEWORK',reviewRef:approval.reviewRef};
  if(reviewed.owner==='D16'){
   if(typeof downstreamOwners?.d16?.createFromTrustedSpec!=='function')
    return {held:true,reason:'CLASSROOM_D16_OWNER_ROUTE_UNAVAILABLE',committed:false};
   const committed=await downstreamOwners.d16.createFromTrustedSpec({studentId,classId,spec:reviewed.spec,
    idempotencyKey:'classroom-d16:'+hash({reviewRef:approval.reviewRef,recordHash:fresh.record.content_hash})});
   return {accepted:true,committed:true,owner:'D16',assignmentCreated:true,assignmentId:committed.assignmentId,
    reviewRef:approval.reviewRef};
  }
  if(typeof downstreamOwners?.d17?.prepareBlueprint!=='function')
   return {held:true,reason:'CLASSROOM_D17_OWNER_ROUTE_UNAVAILABLE',committed:false};
  const prepared=await downstreamOwners.d17.prepareBlueprint({id:studentId},reviewed.assessmentId,
   {...reviewed.input,lane:'ELIGIBLE_CANDIDATE',idempotencyKey:'classroom-d17:'+hash({reviewRef:approval.reviewRef,recordHash:fresh.record.content_hash}),
    provenanceRefs:[...new Set([...(reviewed.input.provenanceRefs||[]),`classroom-record:${fresh.record.record_id}@${fresh.record.content_hash}`,`classroom-planning-review:${approval.reviewRef}`])]});
  return {accepted:true,committed:true,owner:'D17',assessmentId:reviewed.assessmentId,
   blueprintId:prepared?.blueprint?.assessment_blueprint_id||null,reviewRef:approval.reviewRef,
   packageLocked:false,graded:false};
 }
 return Object.freeze({propose,linkReviewedContinuity,consumeReviewedPlanning});
}
module.exports={MODES,delivery7Request,reviewedContinuationLinks,validateReviewedOwnerHandoff,createDelivery7Intelligence};
