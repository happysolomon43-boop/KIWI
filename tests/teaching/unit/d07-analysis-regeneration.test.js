'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createD07Service } = require('../../../teaching/d07/service');
const {
  buildRegenerationContext,
  curriculumAuditRequest,
  structurePassRequest,
} = require('../../../teaching/d07/intelligence');

function course(stateVersion=4) {
  return {
    course_id:'course-1',
    student_id:'student-1',
    subject_id:'subject-1',
    title:'Biology',
    lifecycle_state:'DRAFT',
    state_version:stateVersion,
    subject_snapshot_ref:'subject:subject-1:snapshot-4',
  };
}

function source(id='source-1') {
  return {
    source_content_item_id:id,
    source_kind:'PRIMARY_STUDY_NOTE',
    source_ref:'note:1',
    source_version_ref:'v1',
    locator:{page:1},
    content_hash:'hash-1',
    content_summary:'Cell biology, membrane transport, enzymes, and genetics.',
  };
}

function subjects() {
  return {
    async getForUser(){ return {id:'subject-1',name:'Biology'}; },
    async getCorpusForUser(){ return {subject:{id:'subject-1',name:'Biology'},decks:[],cards:[]}; },
  };
}

test('Course analysis regeneration resets downstream current state before it queues replacement analysis', async () => {
  const events=[];
  const calls=[];
  const previousAudit={
    curriculum_audit_id:'audit-4',
    audit_version:4,
    status:'VALIDATED_CANDIDATE',
    audit_output:{learning_units:Array.from({length:20},(_,i)=>({learning_unit_id:`u-${i+1}`}))},
  };
  const before={
    course:course(4),
    sources:[source()],
    curriculumAudit:previousAudit,
    backgroundAnalysis:null,
  };
  const after={
    course:course(5),
    sources:[source()],
    curriculumAudit:{...previousAudit,status:'SUPERSEDED'},
    backgroundAnalysis:null,
  };
  let setupReads=0;
  const repository={
    async getSetup(){
      setupReads+=1;
      return setupReads===1?before:after;
    },
    async prepareAuditRegeneration({studentId,courseId,reason}){
      calls.push({studentId,courseId,reason});
      return {course:after.course,previousAudit,regenerationReason:reason};
    },
  };
  const service=createD07Service({
    subjects:subjects(),
    repository,
    intelligence:{},
    outboxStore:{
      async append(event){
        events.push(event);
        return {inserted:true,event:{...event,event_id:event.eventId,status:'PENDING'}};
      },
    },
    randomUUID:()=> 'regen-job-1',
    clock:()=>new Date('2026-10-07T13:30:00Z'),
  });

  const queued=await service.queueAudit(
    {id:'student-1'},
    'course-1',
    {regenerate:true,regenerationReason:'There are too many Learning Units; group closely related competencies where academically safe.'},
  );

  assert.equal(calls.length,1);
  assert.equal(calls[0].reason,'There are too many Learning Units; group closely related competencies where academically safe.');
  assert.equal(events.length,1);
  assert.equal(events[0].eventType,'teaching.curriculum.audit_requested');
  assert.equal(events[0].aggregateVersion,5);
  assert.equal(events[0].payload.regenerate,true);
  assert.equal(events[0].payload.previous_audit_id,'audit-4');
  assert.equal(events[0].payload.previous_audit_version,4);
  assert.equal(events[0].payload.regeneration_reason,calls[0].reason);
  assert.match(events[0].idempotencyKey,/regenerate:from-audit-4/);
  assert.equal(queued.background,true);
  assert.equal(queued.operation,'REGENERATION');
  assert.equal(queued.resetApplied,true);
});

test('regeneration reason is optional but TPF-02 receives it as advisory decomposition context when supplied', () => {
  const previousAudit={
    audit_version:3,
    audit_output:{learning_units:Array.from({length:18},(_,i)=>({learning_unit_id:`old-${i+1}`}))},
  };
  const guided=buildRegenerationContext({
    regenerationReason:'The Learning Units are too fragmented.',
    previousAudit,
  });
  const unguided=buildRegenerationContext({previousAudit});

  assert.equal(guided.student_reason,'The Learning Units are too fragmented.');
  assert.equal(guided.previous_learning_unit_count,18);
  assert.equal(unguided.student_reason,null);
  assert.ok(guided.instruction.some((line)=>/advisory decomposition feedback/.test(line)));
  assert.ok(guided.instruction.some((line)=>/Preserve distinct assessable competencies/.test(line)));

  const request=curriculumAuditRequest({
    course:course(),
    sources:[source()],
    regenerationContext:guided,
  });
  assert.equal(request.academicInput.regeneration_context.student_reason,guided.student_reason);

  const prepared=[{
    source_item_ref:request.academicInput.source_items[0].source_item_ref,
    provenance:'source',
    academic_meaning:'Required biology content.',
    proposed_scope_classification:'required',
    scope_classification_basis:'Direct Course evidence.',
    duplicate_of_ref:null,
    content_validity_status:'current_supported',
    content_validity_basis:'Current source.',
    confidence:'high',
  }];
  const structure=structurePassRequest({
    course:course(),
    sources:[source()],
    preparedInventory:prepared,
    regenerationContext:guided,
  });
  assert.equal(structure.academicInput.regeneration_context.student_reason,guided.student_reason);
});

test('TPF-02 direct execution is explicitly told to treat regeneration feedback as advisory, not academic authority', () => {
  const direct=fs.readFileSync(path.resolve(__dirname,'../../../teaching/d07/tpf02-direct.js'),'utf8');
  assert.match(direct,/analysisRegeneration=academicInput\?\.regeneration_context\?\.requested===true/);
  assert.match(direct,/optional advisory feedback from the student/);
  assert.match(direct,/never treat it as authority to omit or invent academic scope/);
  assert.match(direct,/Do not preserve the prior Learning Unit count merely because it existed/);
});

test('analysis reset preserves history but invalidates every downstream current artifact at the analysis boundary', () => {
  const repository=fs.readFileSync(
    path.resolve(__dirname,'../../../teaching/repositories/d07-course-intake.js'),
    'utf8',
  );
  const planReader=fs.readFileSync(
    path.resolve(__dirname,'../../../teaching/repositories/d08/plan-reader.js'),
    'utf8',
  );
  const scheduler=fs.readFileSync(
    path.resolve(__dirname,'../../../teaching/repositories/d09-scheduling.js'),
    'utf8',
  );

  assert.match(repository,/status='SUPERSEDED'/);
  assert.match(repository,/academically_meaningful=null,classification=null/);
  assert.match(repository,/plan_state='REVIEW_REQUIRED'/);
  assert.match(repository,/timetable_state='STALE'/);
  assert.match(repository,/TEACHING_ANALYSIS_REGENERATION_RESET/);
  assert.match(repository,/state_version=state_version\+1/);
  assert.match(repository,/COURSE_ANALYSIS_REGENERATION/);
  assert.match(repository,/lifecycle_state='DRAFT'/);
  assert.match(repository,/Course Analysis regeneration reset/);
  assert.doesNotMatch(repository,/delete from public\.teaching_curriculum_audits/i);
  assert.doesNotMatch(repository,/delete from public\.teaching_course_plans/i);

  assert.match(planReader,/plan_state not in \('REVIEW_REQUIRED','SUPERSEDED'\)/);
  assert.match(planReader,/curriculum_audit_id/);
  assert.match(scheduler,/plan_state not in \('REVIEW_REQUIRED','SUPERSEDED'\)/);
});

test('READY-to-DRAFT reset is a guarded analysis-regeneration transition, not a general lifecycle rollback', () => {
  const migration=fs.readFileSync(
    path.resolve(__dirname,'../../../migrations/20261007_teaching_analysis_regeneration_reset.sql'),
    'utf8',
  );
  assert.match(migration,/current_setting\('kiwi\.teaching_analysis_reset'/);
  assert.match(migration,/COURSE_ANALYSIS_REGENERATION/);
  assert.match(migration,/OLD\.lifecycle_state='READY' AND NEW\.lifecycle_state='DRAFT'/);
  assert.match(migration,/OLD\.activated_at IS NULL AND OLD\.academic_record_started_at IS NULL/);
});

test('Course Setup exposes a deliberate optional regeneration reason instead of silently regenerating', () => {
  const ui=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-d08.js'),'utf8');
  assert.match(ui,/Regenerate analysis/);
  assert.match(ui,/Why should KIWI reconsider the analysis\?/);
  assert.match(ui,/Optional — for example/);
  assert.match(ui,/there are too many Learning Units/);
  assert.match(ui,/body: \{ regenerate: true, reason: reason\.value\.trim\(\) \|\| null \}/);
  assert.match(ui,/resets this Course back to Material analysis/);
  assert.match(ui,/historical versions are preserved/);
});
