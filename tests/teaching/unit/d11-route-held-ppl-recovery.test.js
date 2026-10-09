'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {lateStartRecoveryEligibility,isRecoverableRouteHeldSession}=require('../../../teaching/d11/late-start-recovery');

const time=Date.parse('2026-10-09T07:00:00Z');
const klass={
 scheduled_start_at:new Date(time).toISOString(),
 scheduled_end_at:new Date(time+120*60000).toISOString(),
 lifecycle_state:'SCHEDULED',course_lifecycle_state:'ACTIVE',
 source_timetable_state:'APPROVED',
 course_state_version:10,schedule_version:28,source_timetable_version_id:'tt28'
};
const emptyProgress={
 completed_segment_refs:[],completed_objective_refs:[],evidence_event_refs:[],
 independent_evidence_objective_refs:[]
};
const session={
 lifecycle_state:'INTERRUPTED',instructional_substate:'INTERRUPTED',
 lesson_blueprint_id:null,resume_instructional_substate:null,
 source_course_state_version:10,source_class_schedule_version:28,
 source_timetable_version_id:'tt28',progress_state:emptyProgress
};
const eligibility=(minutes,override={})=>lateStartRecoveryEligibility({
 classRow:{...klass,...(override.klass||{})},session:override.session===undefined?session:override.session,
 now:new Date(time+minutes*60000)
});

test('Only never-taught route-held Controllers can complete validated PPL during their authorized Class window',()=>{
 assert.equal(isRecoverableRouteHeldSession(session),true);
 assert.equal(eligibility(1).allowed,true);
 assert.equal(eligibility(44).allowed,true);
 assert.equal(eligibility(46).allowed,false);
 assert.equal(eligibility(-1).allowed,false);
 assert.equal(eligibility(118).allowed,false);
 assert.equal(eligibility(120).allowed,false);
 assert.equal(eligibility(1,{session:null}).allowed,true);
 assert.equal(eligibility(1,{session:{...session,lifecycle_state:'ACTIVE'}}).allowed,false);
 assert.equal(eligibility(1,{session:{...session,lesson_blueprint_id:'some-blueprint'}}).allowed,false);
 assert.equal(eligibility(1,{session:{...session,resume_instructional_substate:'INSTRUCTION'}}).allowed,false);
 assert.equal(eligibility(1,{session:{...session,progress_state:{...emptyProgress,evidence_event_refs:['e1']}}}).allowed,false);
 assert.equal(eligibility(1,{session:{...session,source_timetable_version_id:'superseded'}}).reason,'ROUTE_HELD_AUTHORITY_STALE');
 assert.equal(eligibility(1,{klass:{source_timetable_state:'SUPERSEDED'}}).allowed,false);
});

test('D11 parent-fenced artifact capture does not universally reject an existing route-held session',()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../../../teaching/repositories/d11-lesson-controller.js'),'utf8');
 const section=source.slice(source.indexOf('  async function recordPreparationArtifactUsing('),
   source.indexOf('  async function getPreparationArtifactPayload('));
 assert.match(section,/allowLateStartRecovery===true/);
 assert.match(section,/lateStartRecoveryEligibility\(\{classRow:klass,session,now:clock\(\)\}\)\.allowed/);
 assert.match(section,/\(!session \|\| \(allowLateStartRecovery===true/);
 assert.match(section,/klass\.source_timetable_state==='APPROVED'/);
 assert.match(section,/workspace\.lifecycle_state==='ACTIVE'/);
});

test('Classroom only offers explicit route-held recovery, verifies Blueprint, then calls the genuine D11 resume and D14 JOIN',()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-classroom.js'),'utf8');
 assert.match(source,/function isUntouchedRouteHeldController/);
 assert.match(source,/if\(current\?\.controller&&!isUntouchedRouteHeldController/);
 assert.match(source,/Prepare & Resume Lesson/);
 const section=source.slice(source.indexOf("if(path==='recover-and-resume')"),source.indexOf("if(path==='start')await recoverPreparedLesson",source.indexOf("if(path==='recover-and-resume')")));
 assert.match(section,/await recoverPreparedLesson\(classId\)/);
 assert.match(section,/current\?\.blueprint\?\.currentForAuthoritativeContext/);
 assert.match(section,/resumeInstructionalSubstate!=='OPENING'/);
 assert.match(section,/controller\/transition/);
 assert.match(section,/expectedVersion:controller\.stateVersion/);
 assert.match(section,/controller\/enter|classroom\/enter/);
 assert.doesNotMatch(section,/update.*teaching_classes|set.*lesson_blueprint_id/);
});
