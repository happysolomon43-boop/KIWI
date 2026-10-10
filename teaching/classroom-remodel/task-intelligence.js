'use strict';
const {failure,value}=require('./presentation-policy');
const {getCapability}=require('../capability-registry');
const {lessonTeacherRequest}=require('../d14/lesson-intelligence');
const {getModeSchema}=require('./mode-schemas');
const {createCandidateInvocationBinding}=require('./invocation-binding');
const contracts=require('./task-contracts');
// Qualification-only adapters reuse the central execution/governance boundary.
// Reviewer acceptance and durable publication remain separate owner operations.
function createClassroomTaskIntelligence({orchestrator,d11Repository,requirementsReader,directiveReader}={}){
 if(typeof orchestrator?.execute!=='function'||!d11Repository||typeof requirementsReader!=='function')throw new TypeError('Existing orchestrator, D11 context and adopted requirements required');
 async function execute(args,{capabilityId,familyId,mode,role,academicInput,validate,untrustedRefs=[]}){
  const context=await d11Repository.getClassContext(args.studentId,args.classId),policy=args.policy||args.immutableContext?.policy;
  const requirements=await requirementsReader({studentId:args.studentId,classId:args.classId,context,mode});
  if(!requirements?.version||!requirements.adoptionRef||requirements.numericPolicy?.version!==policy?.version||policy.fields.generationBudget?.unit!=='output_tokens_per_attempt')throw failure('CLASSROOM_TASK_REQUIREMENTS_NOT_ADOPTED',503);
  const capability=getCapability(capabilityId),schema=getModeSchema(role,mode,{chapter:args.chapter||args.immutableContext?.sources.chapter,directive:args.directive,supportedBoardOperations:['add']});
  const base=lessonTeacherRequest({studentId:args.studentId,classId:args.classId,context,turnKey:args.operationKey||'task-evaluation:'+args.admissionId+':'+args.token});let attempts=0;
  const validator=validate?async output=>{try{const checked=await schema.validate(output);if(!checked.ok)return checked;validate(output);return {ok:true,value:output};}catch(e){return {ok:false,reason:e.code||'CLASSROOM_TASK_OUTPUT_REJECTED'};}}:schema.validate;
  const request={...base,capabilityId,declaredAuthorityLevel:capability.authority_ceiling,taskMode:mode,commit:false,signal:args.signal,outputSchema:schema,
   candidatePromptBinding:createCandidateInvocationBinding({capabilityId,familyId,mode}),generation:{maxOutputTokens:value(policy,'generationBudget')},
   beforeAttempt:async()=>{if(args.signal?.aborted)throw failure('CLASSROOM_TASK_EVALUATION_TIMEOUT',503);if(attempts++>=value(policy,'generationRetryLimit')+1)throw failure('CLASSROOM_GENERATION_RETRY_BUDGET_EXHAUSTED',503);},
   resultContract:{...base.resultContract,output_schema_id:schema.id,output_schema_version:schema.version},
   directive:{...base.directive,bounded_actions:['Return exactly one provisional mode artifact within the accepted task and assistance limits'],allowed_operations:['Propose only; owner review, admission, publication and D11 transitions are separate'],downstream_handoff:{...base.directive.downstream_handoff,commit_owner_boundary:capability.authoritative_owner_boundary}},
   contextSpec:{...base.contextSpec,untrusted_refs:untrustedRefs.map(ref=>({ref}))},academicInput:{...academicInput,pinned_numeric_policy:policy},schemaValidator:validator,domainValidator:validator,provenanceValidator:validator,
  };
  const result=await orchestrator.execute(request);if(!result.accepted||!result.validatedResult?.output)throw failure('CLASSROOM_TASK_OUTPUT_REJECTED',503);return result.validatedResult.output;
 }
 return Object.freeze({coordinator:{interpret:args=>execute(args,{capabilityId:'teaching.lesson.response_correctness_quality_evaluation',familyId:'TPF-21',mode:'interpret_response',role:'coordinator',academicInput:{immutable_admission:args.immutableContext,exposure_snapshot:args.exposure,student_content_is_untrusted:true},untrustedRefs:['response:'+args.immutableContext.response.response_id],validate:output=>contracts.interpretation(output,{task:args.immutableContext.task,exposure:args.exposure,responseId:args.immutableContext.response.response_id,demand:args.immutableContext.design.artifacts.checks[0].task_demand,stateReference:args.immutableContext.design.input_state_reference})})},turnProvider:{generate:async args=>{
  if(typeof directiveReader!=='function')throw failure('CLASSROOM_TASK_DIRECTIVE_ROUTE_HELD',503);
  const directive=await directiveReader(args),mode=args.kind==='feedback'?'natural_teacher_instruction':'permitted_hint_wording';
  const output=await execute({...args,directive},{capabilityId:'teaching.pedagogy.natural_teacher_explanation_generation',familyId:'TPF-08',mode,role:'presenter',academicInput:{chapter:args.chapter,interaction_directive:directive,public_task:args.publicTask,selected_action:args.selectedAction,accepted_public_feedback:args.feedbackPoints,accepted_evaluation:args.acceptedEvaluation,student_request:args.request,student_content_is_untrusted:true},untrustedRefs:args.request?['task-support:'+args.operationKey]:[]});
  return {output,directive,assistanceLevel:directive.current_assistance_state};
 }}});
}
module.exports={createClassroomTaskIntelligence};
