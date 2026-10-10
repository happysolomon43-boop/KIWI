'use strict';
const {failure,value}=require('./presentation-policy');
const {lessonTeacherRequest}=require('../d14/lesson-intelligence');
const {getModeSchema}=require('./mode-schemas');
const {createCandidateInvocationBinding}=require('./invocation-binding');
// Reuses the live D14 request, central D03/D05 execution and D05 result sink.
// It never reopens a handed-off pre-class PPL workspace for live teaching.
function createClassroomPresentationIntelligence({orchestrator,repository,d11Repository,requirementsReader}={}){
 if(typeof orchestrator?.execute!=='function'||!repository||typeof d11Repository?.getClassContext!=='function'||typeof requirementsReader!=='function')throw new TypeError('Existing live orchestrator, delivery repository and adopted requirements reader required');
 return Object.freeze({generate:async args=>{
  const context=await d11Repository.getClassContext(args.studentId,args.classId);
  const requirements=await requirementsReader({context,studentId:args.studentId,classId:args.classId});
  if(!requirements?.version||!requirements.adoptionRef||requirements.numericPolicy?.version!==args.policy.version)throw failure('CLASSROOM_GENERATION_POLICY_HANDOFF_CONFLICT',503);
  if(args.policy.fields.generationBudget?.unit!=='output_tokens_per_attempt')throw failure('CLASSROOM_GENERATION_BUDGET_UNIT_NOT_ADOPTED',503);
  let attempts=0;
  const beforeAttempt=async()=>{if(args.signal?.aborted)throw failure('CLASSROOM_GENERATION_OUTCOME_UNKNOWN',503);if(attempts>=value(args.policy,'generationRetryLimit')+1)throw failure('CLASSROOM_GENERATION_RETRY_BUDGET_EXHAUSTED',503);attempts++;};
  const cached=await repository.loadSequence(args.studentId,args.classId,args.operationKey,args.expected);
  if(cached)return cached;
  const base=lessonTeacherRequest({studentId:args.studentId,classId:args.classId,context,turnKey:args.operationKey});
  const mode='natural_teacher_instruction',schema=getModeSchema('presenter',mode,{chapter:args.chapter,directive:args.directive,supportedBoardOperations:['add']});
  const request={...base,taskMode:mode,outputSchema:schema,signal:args.signal,commit:false,beforeAttempt,generation:{maxOutputTokens:value(args.policy,'generationBudget')},
   candidatePromptBinding:createCandidateInvocationBinding({capabilityId:base.capabilityId,familyId:'TPF-08',mode}),
   resultContract:{...base.resultContract,output_schema_id:schema.id,output_schema_version:schema.version},
   academicInput:{chapter:args.chapter,explanation_guide:args.guide,interaction_directive:args.directive,pinned_numeric_policy:args.policy},
   schemaValidator:schema.validate,domainValidator:schema.validate,provenanceValidator:schema.validate,
   provisionalResultSink:async validated=>repository.acceptSequence({studentId:args.studentId,classId:args.classId,operationKey:args.operationKey,output:validated.output,directive:args.directive,expected:args.expected,types:args.types,assets:args.assets}),
  };
  const result=await orchestrator.execute(request);
  if(result.replay){const recovered=await repository.loadSequence(args.studentId,args.classId,args.operationKey,args.expected);if(recovered)return recovered;throw failure('CLASSROOM_GENERATION_OUTCOME_UNKNOWN',503);}
  if(!result.accepted||!result.validatedResult?.output)throw failure('CLASSROOM_PRESENTER_OUTPUT_REJECTED',503);
  return result.validatedResult.output;
 }});
}
module.exports={createClassroomPresentationIntelligence};
