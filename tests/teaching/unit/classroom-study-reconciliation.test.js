'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createD14Service}=require('../../../teaching/d14/service');
const digest='a'.repeat(64);
const context={session:{lifecycle_state:'CLOSED'},classRow:{class_id:'class-1',course_id:'course-1',course_state_version:1,schedule_version:2},
 plan:{course_plan_id:'plan-1',version_no:1},blueprint:{blueprint_state:'VALIDATED',lesson_blueprint_id:'lesson-1',version_no:1,planned_learning_unit_refs:['u1']}};
const pre={note_version_id:'pre-validated',stage:'PRE_CLASS',state:'PREPARED_NOT_PUBLISHABLE',note_payload:{sections:[]}};
function harness({preNote=pre,summaryState='TRANSLATED',summaryHash=digest,previousPost=null}={}){
 const calls={notes:[],saved:[],executed:[]};
 const repository={latestNote:async(_sid,_cid,stage)=>{calls.notes.push(stage);return stage==='PRE_CLASS'?preNote:stage==='POST_CLASS'?previousPost:null;},
   saveNote:async v=>{calls.saved.push(v);return {state:v.state,note_version_id:'post-private'};}};
 const closure={closure_fact_id:'closure-1',controller_version:1,fact_pack:{completed_objective_refs:[],classroom:{confirmed_taught_learning_unit_refs:['u1'],published:[{render_confirmed:true}]}}};
 const d11Repository={getClassContext:async()=>context,getClosureFact:async()=>closure,
  classroomReconciliation:async()=>({record_id:'record-1',content_hash:digest,record:closure.fact_pack.classroom}),
  latestSummary:async()=>({class_summary_id:'summary-1',version_no:2,summary_state:summaryState,summary_payload:{student_facing:'Only actual teaching'},translation_provenance:{translation_only:true,classroom_record_hash:summaryHash}})};
 const checks=Object.fromEntries(['all_substantive_claims_traceable','actual_taught_scope_only_for_publication','source_and_card_versions_aligned','final_card_set_accounted_for','corrections_applied','protected_content_excluded','no_mastery_grade_or_schedule_decision','no_invented_teacher_memory','publishable_only_after_reconciliation'].map(k=>[k,true]));
 const intelligence={execute:async request=>{
   calls.executed.push(request);
   const b=request.binding;
   return {accepted:true,validatedResult:{output:{
    prompt_family:'TPF-20',prompt_version:'1.0',capability_id:'teaching.study.class_grounded_note_generation',
    task_mode:'POST_CLASS_NOTE_RECONCILIATION',status:'DRAFT_READY_FOR_VALIDATION',
    source_binding:{course_ref:b.courseRef,class_ref:b.classRef,lesson_plan_ref:b.lessonPlanRef,
      course_source_snapshot_ref:b.sourceSnapshotRef,class_study_card_set_ref:b.cardSetRef,
      class_closure_ref:b.closureRef,class_summary_ref:b.summaryRef},
    note:{sections:[{learning_unit_refs:['u1'],title:'Taught unit'}]},
    claim_provenance:[],coverage:{removed_untaught_learning_unit_refs:[]},
    reconciliation:{provisional_note_ref:'pre-validated',actual_class_delta_applied:true},checks
   }}};
 }};
 const service=createD14Service({repository,d11Repository,d11Service:{},d12Service:{},studyIntelligence:intelligence,
   cardSetReader:async()=>({ref:'cards@1',cards:[]}),sourceReader:async()=>({ref:'sources@1',spans:[]}),randomUUID:()=> 'uuid'});
 return {service,calls};
}
test('TPF-20 reconciliation requires the approved pre-Class note, not a latest post-Class hold',async()=>{
 const missing=harness({preNote:null});const outcome=await missing.service.runStudyStage({studentId:'student-1',classId:'class-1',stage:'POST_CLASS'});
 assert.equal(outcome.reason,'VALIDATED_PRE_CLASS_NOTE_REQUIRED');assert.equal(missing.calls.executed.length,0);
 assert.deepEqual(missing.calls.notes,['PRE_CLASS']);
 const incomplete=harness({preNote:{...pre,state:'ROUTE_HELD'}});
 assert.equal((await incomplete.service.runStudyStage({studentId:'student-1',classId:'class-1',stage:'POST_CLASS'})).state,'RECONCILIATION_HELD');
});
test('TPF-20 never generates from a held or stale Class Summary',async()=>{
 for(const config of [{summaryState:'ROUTE_HELD'},{summaryHash:'stale'}]){
  const h=harness(config);const result=await h.service.runStudyStage({studentId:'student-1',classId:'class-1',stage:'POST_CLASS'});
  assert.equal(result.state,'RECONCILIATION_HELD');assert.equal(h.calls.executed.length,0);
 }
});
test('TPF-20 validates and persists versioned post-Class note privately against actual record',async()=>{
 const h=harness();const output=await h.service.runStudyStage({studentId:'student-1',classId:'class-1',stage:'POST_CLASS'});
 assert.equal(output.state,'VALIDATED_PRIVATE');assert.equal(output.published,false);
 assert.equal(h.calls.executed.length,1);
 assert.equal(h.calls.executed[0].academicInput.closure.classroom.confirmed_taught_learning_unit_refs[0],'u1');
 assert.equal(h.calls.executed[0].academicInput.provisionalNote.sections.length,0);
 assert.equal(h.calls.saved.length,1);
 assert.equal(h.calls.saved[0].binding.classroomRecordHash,digest);
 assert.equal(h.calls.saved[0].state,'VALIDATED_PRIVATE');
 assert.match(h.calls.saved[0].idempotencyKey,/:validated:[0-9a-f]{64}$/);
});
test('TPF-20 current private candidate replays without regenerating or promoting',async()=>{
 const h=harness({previousPost:{state:'VALIDATED_PRIVATE',note_version_id:'post-existing',
  binding:{courseRef:'course-1@1',classRef:'class-1@2',lessonPlanRef:'lesson-1@1',sourceSnapshotRef:'sources@1',cardSetRef:'cards@1',
    closureRef:'closure-1@1',summaryRef:'summary-1@2',classroomRecordRef:'record-1',classroomRecordHash:digest}}});
 const result=await h.service.runStudyStage({studentId:'student-1',classId:'class-1',stage:'POST_CLASS'});
 assert.equal(result.replay,true);assert.equal(result.noteVersionId,'post-existing');
 assert.equal(h.calls.executed.length,0);assert.equal(h.calls.saved.length,0);
});

test('TPF-20 rejects invalid stages and refuses stale pre-Class work after closure',async()=>{
 const h=harness();
 await assert.rejects(h.service.runStudyStage({studentId:'student-1',classId:'class-1',stage:'UNKNOWN'}),{code:'TEACHING_D14_NOTE_STAGE_INVALID'});
 const result=await h.service.runStudyStage({studentId:'student-1',classId:'class-1',stage:'PRE_CLASS'});
 assert.equal(result.reason,'PRE_CLASS_NOTE_AFTER_CLOSURE_FORBIDDEN');
 assert.equal(h.calls.executed.length,0);
});
