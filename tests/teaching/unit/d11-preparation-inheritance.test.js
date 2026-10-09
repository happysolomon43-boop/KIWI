'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {evaluateLessonInheritance}=require('../../../teaching/d11/preparation-inheritance');
const {registerD11Runtime}=require('../../../teaching/d11/runtime');
const {TEACHING_EVENTS}=require('../../../teaching/events/names');

const start='2027-04-15T11:00:00Z',end='2027-04-15T12:00:00Z';
const source={
 class_id:'old-phy101',student_id:'student-1',course_id:'phy101',
 lifecycle_state:'CANCELLED',source_request_id:'reschedule-01',
 scheduled_start_at:'2027-04-14T10:00:00Z',scheduled_end_at:'2027-04-14T11:00:00Z',
 schedule_version:12,source_timetable_version_id:'timetable-12',
 source_timetable_slot_id:'old-slot',course_state_version:4
};
const target={
 ...source,class_id:'new-phy101',lifecycle_state:'SCHEDULED',
 scheduled_start_at:start,scheduled_end_at:end,
 schedule_version:13,source_timetable_version_id:'timetable-13',
 source_timetable_slot_id:'new-slot',source_timetable_state:'APPROVED',
 course_lifecycle_state:'ACTIVE'
};
const plan={course_plan_id:'course-plan-1',version_no:3};
const sourceSlot={timetable_slot_id:'old-slot',slot_kind:'CLASS',learning_unit_refs:['newton-laws','kinematics']};
const targetSlot={timetable_slot_id:'new-slot',slot_kind:'CLASS',learning_unit_refs:['kinematics','newton-laws']};
const learningUnits=[{learning_unit_id:'newton-laws'},{learning_unit_id:'kinematics'}];
const payload={
 status:'OK',review_required:false,review_reasons:[],
 objectives:[{id:'o1',learning_unit_ref:'newton-laws',label:'Explain Newton laws',
  criticality:'CORE',minimum_safe_minutes:10,prerequisite_refs:[],evidence_descriptor_targets:[]}],
 segments:[{id:'s1',kind:'INSTRUCTION',objective_refs:['o1'],planned_minutes:50,
  minimum_safe_minutes:10,criticality:'CORE',optional:false,
  learning_evidence_descriptor:null,assistance_level:'NONE'}],
 adaptive_reserve_minutes:8,
 stopping_conditions:[],prerequisite_checks:[],likely_misconceptions:[],examples:[],
 guided_work:[],independent_evidence_opportunities:[],remediation_branches:[],
 homework_candidates:[],unresolved_items:[]
};
const blueprint={
 blueprint_state:'SUPERSEDED',lesson_blueprint_id:'b-old',
 course_plan_id:'course-plan-1',source_course_plan_version:3,
 source_course_state_version:4,source_class_schedule_version:12,
 source_timetable_version_id:'timetable-12',
 validation_metadata:{deterministic_validation:'PASS'},
 blueprint_payload:payload
};
const candidate={
 artifact_version_id:'a-old',validity_state:'CURRENT',maturity_stage:'CANDIDATE',payload,
 preconditions:{
  course_plan_id:'course-plan-1',course_plan_version:3,course_state_version:4,
  class_schedule_version:12,timetable_version_id:'timetable-12'
 }
};
const base={source,target,plan,sourceSlot,targetSlot,learningUnits,sourceBlueprint:blueprint,
 now:new Date('2026-11-01T10:00:00Z'),requestId:'reschedule-01'};
const assess=changes=>evaluateLessonInheritance({...base,...changes});

test('Same-duration legitimate reschedule transfers revalidated lesson content, not academic status',()=>{
 const d=assess({});
 assert.equal(d.mode,'INHERIT_VALIDATED_BLUEPRINT');
 assert.equal(d.originBlueprintId,'b-old');
 assert.equal(d.validatedContent.objectives[0].learning_unit_ref,'newton-laws');
 assert.equal(d.validatedContent.segments[0].planned_minutes,50);
 assert.equal(d.validatedContent.adaptive_reserve_minutes,8);
 assert.ok(Object.isFrozen(d));
});

test('Compatible provisional work remains a candidate requiring normal finalization',()=>{
 const a=assess({sourceBlueprint:null,sourcePreparation:candidate});
 assert.equal(a.mode,'INHERIT_PREPARATION_CANDIDATE');
 assert.equal(a.originArtifactId,'a-old');
 const changed=assess({target:{...target,scheduled_end_at:'2027-04-15T12:03:00Z'}});
 assert.equal(changed.mode,'INHERIT_PREPARATION_CANDIDATE');
 assert.match(changed.reason,/DURATION_CHANGED/);
});

test('No reuse when topic, Plan, student, ownership, request, session or time differs',()=>{
 const failures=[
 [{sourceSlot:{...sourceSlot,learning_unit_refs:['old-syllabus']}},'LESSON_SCOPE_CHANGED'],
 [{plan:{...plan,version_no:5}},'BLUEPRINT_PROVENANCE_CHANGED'],
 [{target:{...target,student_id:'other'}},'WRONG_CLASS_IDENTITY'],
 [{target:{...target,lifecycle_state:'CANCELLED'}},'NOT_CURRENT_APPROVED_REPLACEMENT'],
 [{target:{...target,source_timetable_state:'SUPERSEDED'}},'NOT_CURRENT_APPROVED_REPLACEMENT'],
 [{sourceHasSession:true},'SESSION_HISTORY_PROTECTED'],
 [{targetHasSession:true},'SESSION_HISTORY_PROTECTED'],
 [{target:{...target,source_request_id:'other-request'}},'RESCHEDULE_REQUEST_MISMATCH'],
 [{source:{...source,lifecycle_state:'SCHEDULED'}},'NOT_CURRENT_APPROVED_REPLACEMENT'],
 [{target:{...target,source_timetable_version_id:'timetable-12'}},'NO_TIMETABLE_REPLACEMENT'],
 [{target:{...target,source_timetable_slot_id:'missing'}},'SLOT_AUTHORITY_CHANGED'],
 [{now:new Date('2027-04-15T11:01:00Z')},'INVALID_OR_ELAPSED_CLASS_WINDOW'],
 [{sourceBlueprint:{...blueprint,validation_metadata:{}}},'BLUEPRINT_PROVENANCE_CHANGED'],
 [{sourceBlueprint:{...blueprint,source_course_state_version:3}},'BLUEPRINT_PROVENANCE_CHANGED'],
 [{sourceBlueprint:null,sourcePreparation:{...candidate,preconditions:{...candidate.preconditions,course_plan_version:2}}},'PREPARATION_PROVENANCE_CHANGED'],
 [{sourceBlueprint:null,sourcePreparation:null},'NO_REUSABLE_PREPARATION'],
 ];
 for(const [input,reason] of failures){
  const result=assess(input);
  assert.equal(result.mode,'FRESH_PREPARATION',reason);
  assert.equal(result.reason,reason);
 }
});
test('Invalid / oversized preparation never slips into a new validated Class',()=>{
 for(const bad of [
  {...payload,segments:[{...payload.segments[0],planned_minutes:60}]},
  {...payload,objectives:[{...payload.objectives[0],learning_unit_ref:'fabricated-learning-unit'}]},
  {...payload,segments:[{...payload.segments[0],planned_minutes:'50 mins'}]}
 ]){
  const d=assess({sourceBlueprint:{...blueprint,blueprint_payload:bad}});
  assert.equal(d.mode,'FRESH_PREPARATION');
  assert.equal(d.reason,'CONTENT_REVALIDATION_FAILED');
 }
});

test('D11 applied-event fanout carries precisely the D10 source Class mapping and never clones sessions',async()=>{
 const registered=new Map(), queued=[], seeded=[], inheritance=[];
 const current={...target,course_lifecycle_state:'ACTIVE',source_timetable_state:'APPROVED'};
 registerD11Runtime({
  publishedEvents:{register:(kind,spec)=>{registered.set(kind,spec.handle);return {};}}, 
  eventRuntime:{register:()=>({})},
  dueEventStore:{enqueue:async e=>{queued.push(e);return {inserted:true};}},
  outboxStore:{append:async e=>{queued.push(e);return {inserted:true};}},
  repository:{
   listClassesForApprovedTimetable:async()=>[current,{...current,class_id:'another-course-class',course_id:'phy102'}],
   getClassContext:async(_,classId)=>({classRow:classId===target.class_id?current:
     {...current,class_id:classId,course_id:'phy102'}}),
   ensurePreparationWorkspace:async args=>{seeded.push(args);return {workspace:{workspace_id:'new-workspace'}};},
  },
  service:{
   startController:async()=>({}),
   refreshCoursePreparation:async()=>[],
   inheritRescheduledPreparation:async(...args)=>{
    inheritance.push(args);
    return {mode:'INHERIT_VALIDATED_BLUEPRINT',reason:'AUTHORITATIVE_CONTENT_REVALIDATED'};
   }
  }
 });
 const event={eventId:'d10-applied-1',actorId:'student-1',
  payload:{course_id:'phy101',request_id:'reschedule-01',request_type:'SINGLE_CLASS_RESCHEDULE',
   timetable_version_id:'timetable-13',
   reschedule_inheritance:{from_class_id:'old-phy101',to_class_id:'new-phy101'}}};
 const applied=await registered.get(TEACHING_EVENTS.REQUEST_APPLIED)(event);
 assert.equal(applied.queuedClassReconciliations,2);
 const jobs=queued.filter(e=>e.eventType===TEACHING_EVENTS.CLASS_PREPARATION_RECONCILE);
 assert.equal(jobs.length,2);
 assert.equal(jobs[0].payload.inheritance_from_class_id,'old-phy101');
 assert.equal(jobs[0].payload.governing_request_id,'reschedule-01');
 assert.equal(jobs[1].payload.inheritance_from_class_id,undefined);
 const a=await registered.get(TEACHING_EVENTS.CLASS_PREPARATION_RECONCILE)({
  eventId:'reconcile-01',actorId:'student-1',aggregateId:'new-phy101',payload:jobs[0].payload
 });
 assert.equal(a.inheritance.mode,'INHERIT_VALIDATED_BLUEPRINT');
 assert.deepEqual(inheritance,[['student-1','old-phy101','new-phy101','reschedule-01']]);
 assert.equal(seeded.length,0,'ready inherited Blueprint must NOT create a new unfinished SKELETON');
 assert.ok(queued.some(e=>e.eventType===TEACHING_EVENTS.CLASS_START_DUE));
 assert.ok(queued.some(e=>e.eventType===TEACHING_EVENTS.CLASS_END_DUE));
});

test('D11 SQL adoption remains atomic, owner-scoped, version-fenced and auditable',()=>{
 const r=fs.readFileSync(path.resolve(__dirname,'../../../teaching/repositories/d11-lesson-controller.js'),'utf8');
 const section=r.slice(r.indexOf('  async function inheritRescheduledPreparation('),
   r.indexOf('  async function getGovernedRequest('));
 assert.match(section,/return withTransaction\(async tx=>/);
 assert.match(section,/class_id=any\(\$2::text\[\]\) order by class_id for update/);
 assert.match(section,/student_id=\$1/);
 assert.match(section,/sourceHasSession/);
 assert.match(section,/evaluateLessonInheritance/);
 assert.match(section,/saveBlueprintUsing\(tx/);
 assert.match(section,/recordPreparationArtifactUsing\(tx/);
 assert.match(section,/lesson\.preparation\.revalidated_inheritance/);
 assert.match(section,/model_calls:0/);
 assert.match(section,/BLUEPRINT_INHERITED_REVALIDATED/);
 assert.doesNotMatch(section,/update public\.teaching_class_sessions|update public\.teaching_attendance_records/);
});
