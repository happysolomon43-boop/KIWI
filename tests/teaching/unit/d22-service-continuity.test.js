'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createD22Service}=require('../../../teaching/d22/service');
const {SAFE_PROFILE_LIBRARY}=require('../../../teaching/d22/contracts');

function version(id='teacher-1'){return {teacher_identity_version_id:id+':v1',teacher_identity_id:id,version_no:1,warmth:'moderate',directness:'moderate',formality:'moderate',expressiveness:'moderate',humor_frequency:'low',encouragement_intensity:'moderate',challenge_style:'balanced',accountability_style:'balanced',conversationality:'moderate',presentation_metadata:{}};}
function assignment(id='teacher-1'){return {teacher_assignment_id:'assign-1',teacher_identity_id:id,version_no:1,display_name:'Teacher Rowan',effective_from:'2026-10-03T00:00:00.000Z',source_request_id:null};}

function surfaceRepo(overrides={}){
  return {
    ensureCourse:async()=>({course_id:'course-2',title:'Chemistry',lifecycle_state:'DRAFT',state_version:1}),
    currentAssignment:async()=>({assignment:assignment(),version:version(),familiarity:{familiarity_level:'new'}}),
    hydrateIdentityIfNeeded:async()=>version(),
    ensureFamiliarity:async()=>({familiarity_level:'new'}),
    continuityCandidate:async()=>null,
    interactionProfile:async()=>null,
    assignmentHistory:async()=>[],
    saveInteractionProfile:async()=>({}),
    recordAuthorizedFamiliarity:async()=>({}),
    findTeacherChangeRequestByIdempotency:async()=>null,
    identityById:async()=>null,
    requestAndAssignment:async()=>null,
    createIdentity:async()=>({identity:{teacher_identity_id:'new-teacher',display_name:'Teacher Aster'},version:version('new-teacher')}),
    ...overrides,
  };
}

test('D22 carries the same Teacher and authoritative familiarity across explicit D21 repeat lineage',async()=>{
  const priorAssignment={...assignment('teacher-prior'),teacher_assignment_id:'assign-prior'};
  const newAssignment={...assignment('teacher-prior'),teacher_assignment_id:'assign-new'};
  const priorVersion=version('teacher-prior');
  let preparedTeacher=null;let currentCalls=0;let familiarityArgs=null;
  const repo=surfaceRepo({
    currentAssignment:async()=>{
      currentCalls+=1;
      if(currentCalls===1)return null;
      if(currentCalls===2)return {assignment:newAssignment,version:priorVersion,familiarity:null};
      return {assignment:newAssignment,version:priorVersion,familiarity:{familiarity_level:'familiar',source_kind:'CONTINUITY_CARRY_FORWARD'}};
    },
    continuityCandidate:async()=>({sourceCourseId:'course-1',sourceAttemptId:'attempt-1',assignment:priorAssignment,version:priorVersion,familiarity:{familiarity_level:'familiar'},sourceKind:'CONTINUITY_CARRY_FORWARD'}),
    ensureFamiliarity:async(args)=>{familiarityArgs=args;return {familiarity_level:args.initialLevel,source_kind:args.sourceKind};},
  });
  const d10={
    prepareAcademicRules:async(_user,_courseId,input)=>{preparedTeacher=input.teacherIdentityId;return {};},
    listRequests:async()=>[],
  };
  const service=createD22Service({repository:repo,d10Service:d10,randomUUID:()=> '00000000-0000-0000-0000-000000000001'});
  const result=await service.ensureTeacher({id:'student-1'},'course-2');
  assert.equal(preparedTeacher,'teacher-prior');
  assert.equal(familiarityArgs.initialLevel,'familiar');
  assert.equal(familiarityArgs.sourceKind,'CONTINUITY_CARRY_FORWARD');
  assert.equal(familiarityArgs.sourceRef,'course:course-1');
  assert.equal(result.teacher.teacherIdentityId,'teacher-prior');
  assert.equal(result.teacher.styleEnvelope.familiarity_level,'familiar');
});

test('Teacher Change retries reuse the existing D10 request and replacement identity',async()=>{
  let createdIdentity=false;let createdRequest=false;
  const repo=surfaceRepo({
    findTeacherChangeRequestByIdempotency:async()=>({request_id:'request-1',requested_change:{teacherIdentityId:'teacher-2'}}),
    identityById:async()=>({identity:{teacher_identity_id:'teacher-2',display_name:'Teacher Linden'},version:version('teacher-2')}),
    createIdentity:async()=>{createdIdentity=true;throw new Error('must not create a second replacement identity');},
  });
  const d10={
    getRequest:async()=>({requestId:'request-1',type:'TEACHER_CHANGE',state:'REVIEWING'}),
    createRequest:async()=>{createdRequest=true;throw new Error('must not create a duplicate request');},
  };
  const service=createD22Service({repository:repo,d10Service:d10,randomUUID:()=> '00000000-0000-0000-0000-000000000001'});
  const result=await service.requestTeacherChange({id:'student-1'},'course-2',{idempotencyKey:'teacher-change:stable'});
  assert.equal(result.idempotent,true);
  assert.equal(result.request.requestId,'request-1');
  assert.equal(result.replacementTeacher.teacherIdentityId,'teacher-2');
  assert.equal(createdIdentity,false);assert.equal(createdRequest,false);
});
