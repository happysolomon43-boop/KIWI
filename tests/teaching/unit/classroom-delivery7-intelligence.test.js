'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {delivery7Request,createDelivery7Intelligence}=require('../../../teaching/classroom-remodel/delivery7-intelligence');
const {fixturePolicy}=require('../fixtures/classroom-presentation-policy');
const {hash}=require('../../../teaching/classroom-remodel/academic-artifacts');
function context(){return {classRow:{student_id:'s',class_id:'c',course_id:'course',course_lifecycle_state:'ACTIVE',course_state_version:1,scheduled_start_at:'2026-10-10T10:00:00Z',scheduled_end_at:'2026-10-10T11:00:00Z',timezone:'UTC',schedule_version:1},plan:{course_plan_id:'plan',version_no:1},learningUnits:[],learningUnitDependencies:[],planPrerequisites:[],session:null};}
function args(mode='lesson_closure_analysis'){return {context:context(),mode,requestKey:'operation',record:{record_id:'record',content_hash:'hash',record:{exposure_and_assistance:{events:[],accepted_response_context:[],independence_owner:'D12'},published:[],pending_questions:[],pending_evaluations:['admission'],work:{publication_is_not_completion:true}}},history:{state:'CONFIRMED_FIRST_CLASS',records:[]},requirements:{version:'fixture',adoptionRef:'FIXTURE_NOT_PRODUCTION',numericPolicy:fixturePolicy()}};}
function output(){return {task_mode:'lesson_closure_analysis',input_state_reference:'fixture',status:'ok',review_required:false,review_reasons:[],completion:{closure_or_replan:'complete',homework_proposal:'complete'},provenance:{},artifacts:{closure_or_replan:{preserved_work:[],carry_forward:['pending interpretation'],current_position:'U01.E01'},homework_proposal:{assign:false,purpose:'No purposeful additional work justified',student_tasks:[],private:{}}},handoff:[]};}
test('Delivery 7 planning preserves actual pending work and uses qualification-only mode binding',()=>{
 const r=delivery7Request(args());assert.equal(r.taskMode,'lesson_closure_analysis');assert.equal(r.candidatePromptBinding.runtimeAuthorized,false);assert.equal(r.commit,false);assert.deepEqual(r.academicInput.actual_class_record.pending_evaluations,['admission']);assert.equal(r.academicInput.rules.assignment_and_deadline_owner,'D16');
});
test('homework generation requires an explicit mode plus owner-validated workload and resources',()=>{
 assert.throws(()=>delivery7Request(args('homework_design_generate')),{code:'CLASSROOM_HOMEWORK_WORKLOAD_OR_RESOURCES_REQUIRED'});
 const a=args('homework_design_generate');a.requirements.permittedResources=[];a.requirements.workload={validated:true,ownerRef:'FIXTURE_D16'};assert.equal(delivery7Request(a).taskMode,'homework_design_generate');
});
test('continuity permits first-Class history without fabricating a closure',()=>{
 const a=args('prepare_continuity');a.record=null;const r=delivery7Request(a);assert.equal(r.academicInput.actual_class_record,null);assert.equal(r.academicInput.history.state,'CONFIRMED_FIRST_CLASS');assert.equal(r.candidatePromptBinding.familyId,'TPF-21');
});
test('assessment guidance excludes protected future packages and preserves eligibility authority',()=>{
 const a=args('guide_assessment');a.record.record.future_assessment={answer_key:'PRIVATE'};assert.throws(()=>delivery7Request(a),{code:'CLASSROOM_PLANNING_PROTECTED_CONTEXT'});
 const r=delivery7Request(args('guide_assessment'));assert.equal(r.academicInput.rules.assessment_eligibility_owner,'D17');assert.equal(r.academicInput.rules.marks_owner,'D20');
});
test('rolling planning requires existing scheduled Classes',()=>{
 assert.throws(()=>delivery7Request(args('rolling_planning_horizon')),{code:'CLASSROOM_EXISTING_SCHEDULE_REQUIRED'});
});
test('generation retries stop at the adopted attempt budget',async()=>{
 const r=delivery7Request(args());await r.beforeAttempt();await assert.rejects(()=>r.beforeAttempt(),{code:'CLASSROOM_GENERATION_RETRY_BUDGET_EXHAUSTED'});
});
function service({reviewer,changing=false}={}){
 const a=args();let n=0,calls=0;
 return {get calls(){return calls;},intelligence:createDelivery7Intelligence({d11Repository:{getClassContext:async()=>a.context},continuityRepository:{history:async()=>a.history,latestRecord:async()=>({...a.record,record:changing&&n++?{changed:true}:a.record.record})},requirementsReader:async()=>a.requirements,orchestrator:{execute:async()=>{calls++;return {accepted:true,executionId:'execution',validatedResult:{output:output()}};}},reviewer})};
}
const review={accept:async a=>({accepted:true,independent:true,ownerRef:'FIXTURE_OWNER',executionId:a.executionId,inputHash:a.binding.inputHash,outputHash:hash(a.output)})};
test('missing independent reviewer holds the route before generation',async()=>{
 const s=service();const r=await s.intelligence.propose({studentId:'s',classId:'c',mode:'lesson_closure_analysis',operationKey:'op'});assert.equal(r.held,true);assert.equal(s.calls,0);
});
test('a reviewed no-homework proposal does not create work, schedules or marks',async()=>{
 const s=service({reviewer:review});const r=await s.intelligence.propose({studentId:'s',classId:'c',mode:'lesson_closure_analysis',operationKey:'op'});assert.equal(r.proposed,true);assert.equal(r.output.artifacts.homework_proposal.assign,false);assert.equal(r.assignmentCreated,false);assert.equal(r.followUpScheduled,false);assert.equal(r.officialOutcome,false);
});
test('late record changes invalidate a planning result after independent review',async()=>{
 const s=service({reviewer:review,changing:true});await assert.rejects(()=>s.intelligence.propose({studentId:'s',classId:'c',mode:'lesson_closure_analysis',operationKey:'op'}),{code:'CLASSROOM_PLANNING_RESULT_STALE'});
});
