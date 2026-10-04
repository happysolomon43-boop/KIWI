'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createD27Service}=require('../../../teaching/d27/service');
const {buildSourceInventory}=require('../../../teaching/d07/contracts');

function primaryRows(corpus){
  return buildSourceInventory({corpus,supplementaryMaterials:[]}).items.map(item=>({
    source_ref:item.sourceRef,source_version_ref:item.sourceVersionRef,locator:item.locator,content_hash:item.contentHash,
  }));
}

function harness(overrides={}){
  const audits=[];const refs=[];const candidates=new Map();const events=new Map();
  const subject={id:'subject-1',name:'Biology',updated_at:'2026-10-01T00:00:00Z'};
  const corpus={subject,decks:[{id:'deck-1',name:'Cells',updated_at:'2026-10-01T00:00:00Z'}],cards:[{id:'card-1',deck_id:'deck-1',front_content:'What is osmosis?',back_content:'Movement of water across a membrane.',updated_at:'2026-10-01T00:00:00Z'}]};
  const repository={
    getCourseSubjectContext:async()=>({course_id:'course-1',student_id:'student-1',subject_id:'subject-1',lifecycle_state:'ACTIVE',subject_snapshot_ref:'subject:subject-1:snap',source_version_ref:'full-course-digest-may-include-supplements',state_version:4}),
    getCoursePrimarySubjectSnapshot:async()=>primaryRows(corpus),
    getCourseStudyContext:async()=>({course_id:'course-1',student_id:'student-1',subject_id:'subject-1',lifecycle_state:'ACTIVE',course_state_version:4,class_id:'class-1',class_state_version:2,learning_unit_id:'lu-1',learning_unit_title:'Cell membrane transport',intended_competence:'Explain osmosis',learning_unit_metadata:{knowledge_type:'CONCEPTUAL'},course_plan_version:3}),
    enqueueEvent:async(event)=>{const current=[...events.values()].find(x=>x.student_id===event.studentId&&x.idempotency_key===event.idempotencyKey);if(current)return {row:current,inserted:false};const row={event_id:event.eventId,student_id:event.studentId,event_type:event.eventType,schema_version:event.schemaVersion,source_owner:event.source.owner,source_entity_type:event.source.entityType,source_entity_id:event.source.entityId,source_version:event.source.version,occurred_at:event.occurredAt,correlation_id:event.correlationId,causation_id:event.causationId,idempotency_key:event.idempotencyKey,policy_version:event.policyVersion,privacy_class:event.privacyClass,payload:event.payload,status:'PENDING'};events.set(row.event_id,row);return {row,inserted:true};},
    getEvent:async(_student,id)=>events.get(id)||null,
    markEvent:async({eventId,status})=>{const row=events.get(eventId);if(row)row.status=status;return row;},
    recordAudit:async(input)=>(audits.push(input),input),
    upsertStudyReference:async(input)=>{const row={reference_id:`r${refs.length+1}`,...Object.fromEntries(Object.entries(input).map(([k,v])=>[k.replace(/[A-Z]/g,m=>'_'+m.toLowerCase()),v]))};refs.push(row);return row;},
    listStudyReferences:async()=>refs,
    insertCandidate:async(input)=>{const row={candidate_id:input.candidateId,student_id:input.studentId,course_id:input.courseId,class_id:input.classId,learning_unit_id:input.learningUnitId,subject_id:input.subjectId,knowledge_type:input.knowledgeType,front_content:input.frontContent,back_content:input.backContent,content_hash:input.contentHash,provenance_refs:input.provenanceRefs,source_version:input.sourceVersion,validation:input.validation,status:'VALIDATED',version:1};candidates.set(row.candidate_id,row);return {row,inserted:true};},
    getCandidate:async(_student,id)=>candidates.get(id)||null,
    transitionCandidate:async({candidateId,toStatus,promotedCardId})=>{const row=candidates.get(candidateId);if(!row)return null;row.status=toStatus;row.version+=1;if(promotedCardId){row.promoted_card_id=promotedCardId;}return row;},
    ...overrides.repository,
  };
  const subjectReader={getForUser:async()=>subject,getCorpusForUser:async()=>corpus,...overrides.subjectReader};
  let id=0;
  const service=createD27Service({repository,subjectReader,examInterface:{buildAssessmentShellHandoff:input=>({contractVersion:'d18.v1',targetAppPath:'/assessment-shell.html',...input})},notificationInterface:{send:async()=>({id:'n'})},ownerAdapters:overrides.ownerAdapters||{},sourceVersionReader:overrides.sourceVersionReader||null,integrationEventPublisher:overrides.integrationEventPublisher||null,featureFlags:overrides.featureFlags||{},randomUUID:()=>`id-${++id}`,clock:()=>new Date('2026-10-04T05:00:00Z')});
  return {service,repository,audits,refs,candidates,events,corpus};
}

test('deleted Subject preserves active Course snapshot and never silently rebinds',async()=>{
  const x=harness({subjectReader:{getForUser:async()=>null,getCorpusForUser:async()=>null}});
  const result=await x.service.subjectBoundary({id:'student-1'},'course-1');
  assert.equal(result.state,'SUBJECT_MISSING_SNAPSHOT_PINNED');
  assert.equal(result.maySilentlyRebind,false);
});

test('unchanged Subject stays current even when Course source digest includes supplements',async()=>{
  const x=harness();
  const result=await x.service.subjectBoundary({id:'student-1'},'course-1');
  assert.equal(result.state,'SUBJECT_CURRENT');
  assert.equal(result.maySilentlyRebind,false);
  assert.equal(result.liveVersion,result.pinnedPrimaryVersion);
});

test('changed Subject is detected from primary source inventory rather than full Course digest',async()=>{
  const x=harness({repository:{getCoursePrimarySubjectSnapshot:async()=>[{source_ref:'subject:subject-1:deck:deck-1',source_version_ref:'old',content_hash:'old-hash'}]}});
  const result=await x.service.subjectBoundary({id:'student-1'},'course-1');
  assert.equal(result.state,'SUBJECT_CHANGED_SNAPSHOT_PINNED');
  assert.equal(result.maySilentlyRebind,false);
});

test('shared Assessment Shell handoff does not create global Exam truth',async()=>{
  const x=harness();
  const result=await x.service.assessmentShellHandoff({id:'student-1'},{assessmentId:'a1',packageId:'p1',sourceVersion:'3'});
  assert.equal(result.academicTruthOwner,'TEACHING_ASSESSMENT');
  assert.equal(result.duplicateGlobalExamRecordCreated,false);
  assert.equal(x.audits.at(-1).integrationName,'EXAM');
});

test('high-level integration event is durable and duplicate idempotency is safe',async()=>{
  const x=harness();
  const input={eventType:'learning_unit_verified',source:{owner:'D13_SKM',entityType:'StudentKnowledgeState',entityId:'ks1',version:'2'},idempotencyKey:'same',payload:{subjectId:'subject-1',evidenceType:'DELAYED_INDEPENDENT'}};
  const first=await x.service.publishEvent({id:'student-1'},input);
  const second=await x.service.publishEvent({id:'student-1'},input);
  assert.equal(first.inserted,true);assert.equal(second.inserted,false);assert.equal(x.events.size,1);
});

test('KS write is feature-gated and audited with no owner mutation when disabled',async()=>{
  const x=harness();
  const published=await x.service.publishEvent({id:'student-1'},{eventType:'learning_unit_verified',source:{owner:'D13_SKM',entityType:'StudentKnowledgeState',entityId:'ks1',version:'2'},idempotencyKey:'ks-off',payload:{subjectId:'subject-1',evidenceType:'DELAYED_INDEPENDENT'}});
  await assert.rejects(()=>x.service.applyKnowledgeScore({id:'student-1'},published.event.event_id),e=>e.code==='TEACHING_D27_KS_WRITE_DISABLED');
  assert.equal(x.audits.at(-1).outcome,'NO_WRITE');
});

test('consequential KS write rejects stale source before target owner call',async()=>{
  let targetCalled=false;
  const x=harness({featureFlags:{ksWrite:true},sourceVersionReader:async()=>({exists:true,version:'9'}),ownerAdapters:{knowledgeScore:{readState:async()=>({version:'1'}),applyTeachingEvidence:async()=>{targetCalled=true;}}}});
  const published=await x.service.publishEvent({id:'student-1'},{eventType:'learning_unit_verified',source:{owner:'D13_SKM',entityType:'StudentKnowledgeState',entityId:'ks1',version:'2'},idempotencyKey:'ks-stale',payload:{subjectId:'subject-1',evidenceType:'DELAYED_INDEPENDENT'}});
  await assert.rejects(()=>x.service.applyKnowledgeScore({id:'student-1'},published.event.event_id),e=>e.code==='TEACHING_D27_SOURCE_VERSION_STALE');
  assert.equal(targetCalled,false);
});

test('Study exact candidate duplicate becomes a reference instead of a new card candidate',async()=>{
  const x=harness();
  const result=await x.service.prepareClassReviewSet({id:'student-1'},{courseId:'course-1',classId:'class-1',learningUnitId:'lu-1',knowledgeType:'CONCEPTUAL',candidate:{frontContent:'What is osmosis?',backContent:'Movement of water across a membrane.',validation:{status:'PASS',independent:true},provenanceRefs:[{contentClass:'C1',source:'course-snapshot'}]}});
  assert.equal(result.automaticDeckMutation,false);
  assert.ok(result.references.length>=1);
  assert.equal(x.candidates.size,0);
});

test('Brain, Biome and achievements stay off in D27 status',()=>{
  const status=harness().service.status();
  assert.equal(status.brainWriteEnabled,false);assert.equal(status.biomeWriteEnabled,false);assert.equal(status.achievementWriteEnabled,false);
});
