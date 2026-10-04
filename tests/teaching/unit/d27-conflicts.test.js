'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {D27_CONFLICT_POLICIES}=require('../../../teaching/d27/conflicts');
const {createD27Service}=require('../../../teaching/d27/service');
const {buildSourceInventory}=require('../../../teaching/d07/contracts');

function minimalService({ownerAdapters={},sourceVersionReader=async()=>({exists:true,version:'2'}),featureFlags={}}={}){
  const events=new Map();const audits=[];const refs=[{reference_id:'r1',student_id:'s',course_id:'co',class_id:'cl',learning_unit_id:'lu',subject_id:'sub',card_id:'missing-card',card_version:'v1',knowledge_type:'CONCEPTUAL',relevance_reason:'x'}];
  const subject={id:'sub',updated_at:'2026-10-01T00:00:00Z'};const corpus={subject,decks:[{id:'d',name:'Deck',updated_at:'2026-10-01T00:00:00Z'}],cards:[]};
  const primary=buildSourceInventory({corpus,supplementaryMaterials:[]}).items.map(x=>({source_ref:x.sourceRef,source_version_ref:x.sourceVersionRef,content_hash:x.contentHash}));
  const repository={
    getCourseSubjectContext:async()=>({course_id:'co',student_id:'s',subject_id:'sub',lifecycle_state:'ACTIVE',subject_snapshot_ref:'snap',source_version_ref:'full',state_version:1}),
    getCoursePrimarySubjectSnapshot:async()=>primary,
    getEvent:async(_s,id)=>events.get(id)||null,
    enqueueEvent:async(e)=>{const existing=[...events.values()].find(x=>x.idempotency_key===e.idempotencyKey);if(existing)return {row:existing,inserted:false};const row={event_id:e.eventId,student_id:e.studentId,event_type:e.eventType,schema_version:e.schemaVersion,source_owner:e.source.owner,source_entity_type:e.source.entityType,source_entity_id:e.source.entityId,source_version:e.source.version,occurred_at:e.occurredAt,correlation_id:e.correlationId,causation_id:e.causationId,idempotency_key:e.idempotencyKey,policy_version:e.policyVersion,privacy_class:e.privacyClass,payload:e.payload,status:'PENDING'};events.set(row.event_id,row);return {row,inserted:true};},
    markEvent:async({eventId,status})=>{const row=events.get(eventId);row.status=status;return row;},
    recordAudit:async x=>(audits.push(x),x),
    listStudyReferences:async()=>refs,
    ...{},
  };
  let n=0;
  return {events,audits,service:createD27Service({repository,subjectReader:{getForUser:async()=>subject,getCorpusForUser:async()=>corpus},examInterface:{buildAssessmentShellHandoff:x=>x},notificationInterface:{send:async()=>({})},ownerAdapters,sourceVersionReader,featureFlags,randomUUID:()=>`e-${++n}`,clock:()=>new Date('2026-10-04T06:00:00Z')})};
}

test('strong Teaching evidence and weak FSRS signal remain separate truth domains',()=>{
  const p=D27_CONFLICT_POLICIES.TEACHING_STRONG_FSRS_WEAK;
  assert.match(p.resolution,/CANNOT_DOWNGRADE_SKM_OR_GRADEBOOK/);
  assert.equal(p.automaticAcademicMutation,false);
});

test('FSRS due date and Mastery deadline cannot override Teaching timetable authority',()=>{
  assert.equal(D27_CONFLICT_POLICIES.FSRS_DUE_VS_TEACHING_TIMETABLE.authoritativeOwner,'D09_SCHEDULER_FOR_COURSE_TIME');
  assert.equal(D27_CONFLICT_POLICIES.MASTERY_DEADLINE_VS_TEACHING_TIMETABLE.authoritativeOwner,'D09_SCHEDULER_FOR_COURSE_TIME');
});

test('deleted source card remains a missing reference and is not recreated by Teaching',async()=>{
  const x=minimalService();const result=await x.service.getClassReviewSet({id:'s'},{courseId:'co'});
  assert.equal(result.references[0].status,'CARD_MISSING');
  assert.equal(result.sourceCardsCopied,false);assert.equal(result.sourceCardDeletionAuthority,false);
});

test('target owner rejection is audited and never fabricated as success',async()=>{
  const targetError=Object.assign(new Error('owner says no'),{code:'OWNER_REJECTED'});
  const x=minimalService({featureFlags:{ksWrite:true},ownerAdapters:{knowledgeScore:{readState:async()=>({version:'k1'}),applyTeachingEvidence:async()=>{throw targetError;}}}});
  const e=await x.service.publishEvent({id:'s'},{eventType:'learning_unit_verified',source:{owner:'D13_SKM',entityType:'StudentKnowledgeState',entityId:'ks',version:'2'},idempotencyKey:'reject',payload:{subjectId:'sub',evidenceType:'INDEPENDENT'}});
  await assert.rejects(()=>x.service.applyKnowledgeScore({id:'s'},e.event.event_id),err=>err.code==='OWNER_REJECTED');
  assert.equal(x.audits.at(-1).outcome,'OWNER_REJECTED');
});

test('integration outage leaves durable event pending and replayable',async()=>{
  const x=minimalService();
  const e=await x.service.publishEvent({id:'s'},{eventType:'course_completed',source:{owner:'D21_PROGRESSION',entityType:'CourseResult',entityId:'cr',version:'2'},idempotencyKey:'late-complete',payload:{courseId:'co'}});
  await assert.rejects(()=>x.service.dispatchEvent({id:'s'},e.event.event_id),err=>err.code==='TEACHING_D27_EVENT_PUBLISHER_UNAVAILABLE');
  assert.equal(x.events.get(e.event.event_id).status,'PENDING');
});

test('duplicate and late course-completion publication is idempotency-bound',async()=>{
  const x=minimalService();
  const input={eventType:'course_completed',source:{owner:'D21_PROGRESSION',entityType:'CourseResult',entityId:'cr',version:'2'},idempotencyKey:'complete:co:v2',payload:{courseId:'co'}};
  const a=await x.service.publishEvent({id:'s'},input);const b=await x.service.publishEvent({id:'s'},input);
  assert.equal(a.inserted,true);assert.equal(b.inserted,false);assert.equal(x.events.size,1);
  assert.match(D27_CONFLICT_POLICIES.COURSE_COMPLETION_LATE_REPLAY.resolution,/IDEMPOTENCY/);
});
