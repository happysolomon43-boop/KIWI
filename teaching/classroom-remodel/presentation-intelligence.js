'use strict';
const {failure}=require('./presentation-policy');
// Retains central D03/D05 execution and durable private PPL generation history.
// No model result is a publication or an academic-owner commit.
function createClassroomPresentationIntelligence({intelligence,d11Repository,requirementsReader}={}){
 if(typeof intelligence?.presenter!=='function'||typeof d11Repository?.getClassContext!=='function'||typeof requirementsReader!=='function')throw new TypeError('Existing preparation intelligence and adopted requirements reader required');
 return Object.freeze({generate:async args=>{
  const context=await d11Repository.getClassContext(args.studentId,args.classId);
  const requirements=await requirementsReader({context,studentId:args.studentId,classId:args.classId});
  if(!requirements?.version||!requirements.adoptionRef||requirements.numericPolicy?.version!==args.policy.version)throw failure('CLASSROOM_GENERATION_POLICY_HANDOFF_CONFLICT',503);
  return intelligence.presenter({context,requirements:{...requirements,supportedBoardOperations:['add'],numericPolicy:args.policy},producer:{familyId:'TPF-08',capabilityId:'teaching.pedagogy.natural_teacher_explanation_generation',mode:'natural_teacher_instruction',schemaVersion:'classroom-contracts.v1'},chapter:args.chapter,guide:args.guide,directive:args.directive,operationKey:args.operationKey});
 }});
}
module.exports={createClassroomPresentationIntelligence};
