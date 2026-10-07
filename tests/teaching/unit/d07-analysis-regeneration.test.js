'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { digest } = require('../../../teaching/d07/contracts');

const { createD07Service } = require('../../../teaching/d07/service');
const {
  buildRegenerationContext,
  buildRefinementContext,
  curriculumRefinementRequest,
} = require('../../../teaching/d07/intelligence');

function course(stateVersion=4,state='DRAFT') {
  return {
    course_id:'course-1',
    student_id:'student-1',
    subject_id:'subject-1',
    title:'Biology',
    lifecycle_state:state,
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

function currentAudit(version=4) {
  return {
    curriculum_audit_id:`audit-${version}`,
    audit_version:version,
    status:'VALIDATED_CANDIDATE',
    subject_snapshot_ref:'subject:subject-1:snapshot-4',
    source_inventory_digest:digest([['note:1','hash-1']]),
    audit_output:{
      input_state_reference:'course:course-1:state:4',
      task_mode:'DEEP_AUDIT',
      execution_stage:'SINGLE_PASS',
      audit_scope:{subject_or_course:'Biology',source_refs:['source:source-1'],trusted_scope_version:'subject:subject-1:snapshot-4',source_walk:[]},
      source_inventory:[],
      topics:[],
      learning_units:Array.from({length:20},(_,i)=>({learning_unit_id:`u-${i+1}`})),
      assumed_prerequisites:[],
      source_conflicts:[],
      coverage_gaps:[],
      structure_change_proposals:[],
      source_to_unit_reconciliation:{required_item_map:[],unmapped_required_refs:[]},
      unresolved_items:[],
      status:'ok',
      review_required:false,
      review_reasons:[],
      student_facing_summary_candidate:'Biology course analysis.',
    },
  };
}

test('targeted Course analysis refinement queues against the current audit without resetting anything first', async () => {
  const events=[];
  const audit=currentAudit();
  const setup={course:course(4),sources:[source()],curriculumAudit:audit,backgroundAnalysis:null};
  const repository={async getSetup(){return setup;}};
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
    randomUUID:()=> 'refine-job-1',
    clock:()=>new Date('2026-10-07T13:30:00Z'),
  });

  const queued=await service.queueAudit(
    {id:'student-1'},
    'course-1',
    {operation:'REFINE',changeRequest:'The Learning Units are too broad. Split them at real assessable competence boundaries.'},
  );

  assert.equal(events.length,1);
  assert.equal(events[0].eventType,'teaching.curriculum.audit_requested');
  assert.equal(events[0].aggregateVersion,4);
  assert.equal(events[0].payload.operation,'REFINE');
  assert.equal(events[0].payload.refine,true);
  assert.equal(events[0].payload.regenerate,false);
  assert.equal(events[0].payload.previous_audit_id,'audit-4');
  assert.equal(events[0].payload.previous_audit_version,4);
  assert.match(events[0].payload.change_request,/too broad/);
  assert.match(events[0].idempotencyKey,/refine:from-audit-4/);
  assert.equal(queued.operation,'REFINEMENT');
  assert.equal(queued.resetApplied,false);
  assert.equal(queued.resetOnValidatedCommit,true);
  assert.equal(setup.curriculumAudit.status,'VALIDATED_CANDIDATE');
});

test('full Course analysis regeneration remains available and its reason is optional', async () => {
  const events=[];
  const setup={course:course(4),sources:[source()],curriculumAudit:currentAudit(),backgroundAnalysis:null};
  const service=createD07Service({
    subjects:subjects(),
    repository:{async getSetup(){return setup;}},
    intelligence:{},
    outboxStore:{async append(event){events.push(event);return {inserted:true,event:{...event,event_id:event.eventId,status:'PENDING'}};}},
    randomUUID:()=> 'regen-job-1',
    clock:()=>new Date('2026-10-07T13:30:00Z'),
  });

  const queued=await service.queueAudit({id:'student-1'},'course-1',{operation:'REGENERATE'});

  assert.equal(events[0].payload.operation,'REGENERATE');
  assert.equal(events[0].payload.regenerate,true);
  assert.equal(events[0].payload.regeneration_reason,null);
  assert.equal(queued.operation,'REGENERATION');
  assert.equal(queued.resetApplied,false);
  assert.equal(queued.resetOnValidatedCommit,true);
});

test('refinement request is required while regeneration feedback stays advisory and optional', () => {
  assert.throws(
    ()=>buildRefinementContext({previousAudit:currentAudit()}),
    (error)=>error.code==='TEACHING_D07_ANALYSIS_REFINEMENT_REQUEST_REQUIRED',
  );

  const refinement=buildRefinementContext({
    changeRequest:'There are too few Learning Units. Expand the structure where competencies are genuinely distinct.',
    previousAudit:currentAudit(),
  });
  assert.equal(refinement.mode,'STUDENT_DIRECTED_ANALYSIS_REFINEMENT');
  assert.match(refinement.student_request,/too few Learning Units/);
  assert.ok(refinement.instruction.some((line)=>/Preserve unaffected curriculum structure/.test(line)));
  assert.ok(refinement.instruction.some((line)=>/Do not reclassify sources/.test(line)));

  const regeneration=buildRegenerationContext({previousAudit:currentAudit()});
  assert.equal(regeneration.student_reason,null);
  assert.equal(regeneration.previous_learning_unit_count,20);
});

test('targeted refinement sends the validated current analysis instead of re-running source inventory', () => {
  const request=curriculumRefinementRequest({
    course:course(),
    sources:[source()],
    previousAudit:currentAudit(),
    changeRequest:'Split broad Learning Units into smaller assessable units.',
  });

  assert.equal(request.academicInput.task_mode,'DEEP_AUDIT');
  assert.equal(request.academicInput.execution_stage,'SINGLE_PASS');
  assert.deepEqual(request.academicInput.source_items,[]);
  assert.equal(request.academicInput.refinement_context.mode,'STUDENT_DIRECTED_ANALYSIS_REFINEMENT');
  assert.equal(request.academicInput.refinement_context.current_analysis.learning_units.length,20);
  assert.match(request.contextSpec.context_kind,/student_directed_analysis_refinement/);
});

test('validated refinement commits a new audit version and only then resets downstream setup', async () => {
  const audit=currentAudit();
  const setup={course:course(4),sources:[source()],curriculumAudit:audit,backgroundAnalysis:null};
  const saves=[];
  let reads=0;
  const repository={
    async getSetup(){reads+=1;return setup;},
    async saveAudit(input){saves.push(input);return {curriculum_audit_id:'audit-5',audit_version:5,downstream_reset_applied:true,course_state_version_after:5};},
  };
  const service=createD07Service({
    subjects:subjects(),
    repository,
    intelligence:{
      async refineCurriculumAudit({previousAudit,changeRequest}){
        assert.equal(previousAudit.curriculum_audit_id,'audit-4');
        assert.match(changeRequest,/split/i);
        return {accepted:true,validatedResult:{output:{replacement:true}}};
      },
    },
  });

  const result=await service.runAudit(
    {id:'student-1'},
    'course-1',
    {operation:'REFINE',changeRequest:'Please split the broad Learning Units.'},
  );

  assert.equal(reads,2,'authoritative state must be re-read before commit');
  assert.equal(saves.length,1);
  assert.equal(saves[0].revision.mode,'REFINE');
  assert.equal(saves[0].revision.previousAuditId,'audit-4');
  assert.match(saves[0].revision.studentInstruction,/split/);
  assert.equal(saves[0].validationMetadata.refinement_requested,true);
  assert.equal(result.downstream_reset_applied,true);
});

test('failed refinement cannot reset the existing Course because reset lives behind validated saveAudit', async () => {
  const setup={course:course(4),sources:[source()],curriculumAudit:currentAudit(),backgroundAnalysis:null};
  let saveCalls=0;
  const service=createD07Service({
    subjects:subjects(),
    repository:{
      async getSetup(){return setup;},
      async saveAudit(){saveCalls+=1;},
    },
    intelligence:{
      async refineCurriculumAudit(){return {accepted:false,reason:'unsafe'};},
    },
  });

  await assert.rejects(
    service.runAudit({id:'student-1'},'course-1',{operation:'REFINE',changeRequest:'Remove required units.'}),
    (error)=>error.code==='TEACHING_D07_ANALYSIS_REFINEMENT_REJECTED',
  );
  assert.equal(saveCalls,0);
  assert.equal(setup.curriculumAudit.status,'VALIDATED_CANDIDATE');
});

test('a cancelled refinement can be retried without joining its terminal outbox event', async () => {
  const audit=currentAudit();
  const events=[];
  const setup={
    course:course(4),
    sources:[source()],
    curriculumAudit:{
      ...audit,
      subject_snapshot_ref:'subject:subject-1:snapshot-4',
      source_inventory_digest:require('../../../teaching/d07/contracts').digest([[source().source_ref,source().content_hash]]),
    },
    backgroundAnalysis:{
      event_id:'failed-refine-job',
      status:'CANCELLED',
      payload:{
        operation:'REFINE',
        expected_state_version:'4',
        previous_audit_id:'audit-4',
        previous_audit_version:4,
        change_request:'Split broad Learning Units.',
      },
    },
  };
  const service=createD07Service({
    subjects:subjects(),
    repository:{async getSetup(){return setup;}},
    intelligence:{},
    outboxStore:{async append(event){events.push(event);return {inserted:true,event:{...event,event_id:event.eventId,status:'PENDING'}};}},
    randomUUID:()=> 'retry-refine-job',
    clock:()=>new Date('2026-10-07T15:30:00Z'),
  });

  const queued=await service.queueAudit({id:'student-1'},'course-1',{
    operation:'REFINE',
    changeRequest:'Split broad Learning Units.',
  });

  assert.equal(events.length,1);
  assert.match(events[0].idempotencyKey,/recovery:failed-refine-job$/);
  assert.equal(events[0].causationId,'failed-refine-job');
  assert.equal(queued.jobId,'retry-refine-job');
  assert.equal(queued.joinedExisting,false);
});

test('TPF-02 direct execution treats student refinement as bounded structural guidance, never source authority', () => {
  const direct=fs.readFileSync(path.resolve(__dirname,'../../../teaching/d07/tpf02-direct.js'),'utf8');
  assert.match(direct,/STUDENT_DIRECTED_ANALYSIS_REFINEMENT/);
  assert.match(direct,/preserve unaffected curriculum structure/i);
  assert.match(direct,/Copy source_inventory, audit_scope\.source_walk, source_conflicts, and coverage_gaps exactly/);
  assert.match(direct,/merge only when distinct assessable competencies are not collapsed/);
});

test('validated analysis revision preserves history and resets downstream current state at the analysis boundary', () => {
  const repository=fs.readFileSync(path.resolve(__dirname,'../../../teaching/repositories/d07-course-intake.js'),'utf8');
  const planReader=fs.readFileSync(path.resolve(__dirname,'../../../teaching/repositories/d08/plan-reader.js'),'utf8');
  const scheduler=fs.readFileSync(path.resolve(__dirname,'../../../teaching/repositories/d09-scheduling.js'),'utf8');

  assert.doesNotMatch(repository,/prepareAuditRegeneration/);
  assert.match(repository,/downstream_reset_applied/);
  assert.match(repository,/status='SUPERSEDED'/);
  assert.match(repository,/plan_state='REVIEW_REQUIRED'/);
  assert.match(repository,/timetable_state='STALE'/);
  assert.match(repository,/TEACHING_ANALYSIS_REVISION_RESET/);
  assert.match(repository,/state_version=state_version\+1/);
  assert.match(repository,/COURSE_ANALYSIS_REVISION/);
  assert.match(repository,/lifecycle_state='DRAFT'/);
  assert.match(repository,/Course Analysis revision reset/);
  assert.doesNotMatch(repository,/delete from public\.teaching_curriculum_audits/i);
  assert.doesNotMatch(repository,/delete from public\.teaching_course_plans/i);

  assert.match(planReader,/plan_state not in \('REVIEW_REQUIRED','SUPERSEDED'\)/);
  assert.match(scheduler,/plan_state not in \('REVIEW_REQUIRED','SUPERSEDED'\)/);
});

test('READY-to-DRAFT reset remains guarded and can only occur for a validated Course Analysis revision', () => {
  const migration=fs.readFileSync(
    path.resolve(__dirname,'../../../migrations/20261007_teaching_analysis_regeneration_reset.sql'),
    'utf8',
  );
  assert.match(migration,/current_setting\('kiwi\.teaching_analysis_reset'/);
  assert.match(migration,/COURSE_ANALYSIS_REVISION/);
  assert.match(migration,/OLD\.lifecycle_state='READY' AND NEW\.lifecycle_state='DRAFT'/);
  assert.match(migration,/OLD\.activated_at IS NULL AND OLD\.academic_record_started_at IS NULL/);
});

test('Course Setup lets the student choose targeted changes or whole-analysis regeneration', () => {
  const ui=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-d08.js'),'utf8');
  assert.match(ui,/Request changes/);
  assert.match(ui,/Regenerate analysis/);
  assert.match(ui,/What should KIWI change\?/);
  assert.match(ui,/Apply requested changes/);
  assert.match(ui,/Regenerate whole analysis/);
  assert.match(ui,/operation: 'REFINE'/);
  assert.match(ui,/operation: 'REGENERATE'/);
  assert.match(ui,/If validation fails, nothing is reset/);
  assert.match(ui,/If regeneration fails, the current Course remains intact/);
  assert.match(ui,/analysisRevisionAllowed/);
  assert.match(ui,/Active Courses use governed academic-change workflows/);
});

test('Course Setup shows one actionable Course-analysis failure surface for the 188-source validation case', () => {
  const ui=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-d08.js'),'utf8');
  assert.match(ui,/TEACHING_D07_CURRICULUM_AUDIT_REJECTED/);
  assert.match(ui,/could not safely complete the final Course-structure validation/);
  assert.match(ui,/large source sets are resumed through bounded validation work/);
  assert.doesNotMatch(ui,/card\.append\(failure\)/);
});


test('Course analysis background idempotency joins only the exact same refinement request', async () => {
  const audit=currentAudit();
  const active={
    event_id:'refine-job-active',
    status:'PENDING',
    aggregate_version:4,
    payload:{
      operation:'REFINE',
      expected_state_version:'4',
      previous_audit_id:'audit-4',
      previous_audit_version:4,
      change_request:'Split broad Learning Units.',
      regeneration_reason:null,
    },
  };
  const setup={course:course(4),sources:[source()],curriculumAudit:{
    ...audit,
    subject_snapshot_ref:'subject:subject-1:snapshot-4',
    source_inventory_digest:require('../../../teaching/d07/contracts').digest([[source().source_ref,source().content_hash]]),
  },backgroundAnalysis:active};
  const service=createD07Service({
    subjects:subjects(),
    repository:{async getSetup(){return setup;}},
    intelligence:{},
    outboxStore:{async append(){throw new Error('identical active work should be joined');}},
    randomUUID:()=> 'unused',
  });

  const joined=await service.queueAudit({id:'student-1'},'course-1',{
    operation:'REFINE',
    changeRequest:'Split broad Learning Units.',
  });
  assert.equal(joined.joinedExisting,true);
  assert.equal(joined.jobId,'refine-job-active');

  await assert.rejects(
    service.queueAudit({id:'student-1'},'course-1',{
      operation:'REFINE',
      changeRequest:'Merge overlapping Learning Units instead.',
    }),
    (error)=>error.code==='TEACHING_D07_ANALYSIS_OPERATION_IN_PROGRESS',
  );
  await assert.rejects(
    service.queueAudit({id:'student-1'},'course-1',{operation:'REGENERATE'}),
    (error)=>error.code==='TEACHING_D07_ANALYSIS_OPERATION_IN_PROGRESS',
  );
});

test('validated analysis revision advances Course state so claimed downstream workers cannot commit old analysis results', () => {
  const repository=fs.readFileSync(path.resolve(__dirname,'../../../teaching/repositories/d07-course-intake.js'),'utf8');
  const planWriter=fs.readFileSync(path.resolve(__dirname,'../../../teaching/repositories/d08/plan-writer.js'),'utf8');
  const timetableRepository=fs.readFileSync(path.resolve(__dirname,'../../../teaching/repositories/d09-scheduling.js'),'utf8');

  assert.match(repository,/Every validated analysis revision advances Course state/);
  assert.match(repository,/set state_version=state_version\+1,updated_at=now\(\)/);
  assert.match(repository,/revision_committed_state_version/);
  assert.match(planWriter,/TEACHING_D08_STALE_COURSE_STATE/);
  assert.match(timetableRepository,/assertSchedulingContextCurrent/);
});


test('stale Course analysis cannot be refined against changed source material', async () => {
  const audit=currentAudit();
  const setup={
    course:course(4),
    sources:[source('source-1')],
    curriculumAudit:{
      ...audit,
      subject_snapshot_ref:'subject:subject-1:snapshot-4',
      source_inventory_digest:digest([['note:1','older-hash']]),
    },
    backgroundAnalysis:null,
  };
  let aiCalls=0;
  const service=createD07Service({
    subjects:subjects(),
    repository:{async getSetup(){return setup;}},
    intelligence:{async refineCurriculumAudit(){aiCalls+=1;return {accepted:true};}},
  });

  await assert.rejects(
    service.runAudit({id:'student-1'},'course-1',{
      operation:'REFINE',
      changeRequest:'Split the broad Learning Units.',
      previousAudit:setup.curriculumAudit,
    }),
    (error)=>error.code==='TEACHING_D07_ANALYSIS_REVISION_REQUIRES_CURRENT',
  );
  assert.equal(aiCalls,0);
});


test('analysis-boundary reset makes old diagnostic and prior-knowledge results historical without deleting them', () => {
  const intakeRepository=fs.readFileSync(path.resolve(__dirname,'../../../teaching/repositories/d07-course-intake.js'),'utf8');
  const planReader=fs.readFileSync(path.resolve(__dirname,'../../../teaching/repositories/d08/plan-reader.js'),'utf8');

  for(const source of [intakeRepository,planReader]){
    assert.match(source,/String\(row\.curriculum_audit_id\|\|''\)===String\(curriculumAudit\.curriculum_audit_id\|\|''\)/);
    assert.match(source,/Date\.parse\(row\.decided_at\|\|''\)>=auditAt/);
  }
  assert.doesNotMatch(intakeRepository,/delete from public\.teaching_diagnostic_plans/i);
  assert.doesNotMatch(intakeRepository,/delete from public\.teaching_validated_prior_knowledge_decisions/i);
});
