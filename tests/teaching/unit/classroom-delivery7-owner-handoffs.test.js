'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validateReviewedOwnerHandoff}=require('../../../teaching/classroom-remodel/delivery7-intelligence');
const {hash}=require('../../../teaching/classroom-remodel/academic-artifacts');
const record={record_id:'r1',content_hash:'v1',record:{confirmed_taught_learning_unit_refs:['u1']}};
const base={mode:'homework_design_generate',binding:{inputHash:'i1',recordHash:'v1'},output:{artifacts:{homework_proposal:{assign:true}}},receipt:{accepted:true,independent:true}};
const approval={approved:true,independent:true,owner:'D16',ownerRef:'owner-d16',reviewRef:'review-d16',inputHash:'i1',outputHash:hash(base.output),recordHash:'v1',workloadOwnerRef:'workload-owner',decision:'CREATE_APPROVED_ASSIGNMENT'};
const spec={learningUnitIds:['u1'],sourceLineage:{classroomRecordRef:'classroom-record:r1@v1',classClosureRef:'class-closure:c1',reviewedProposalHash:hash(base.output)},dueAt:'2026-11-02T08:00:00.000Z',deadlineType:'HARD',assistanceMode:'GUIDED',graded:false};
test('D16 handoff requires owner-supplied scope, workload and authoritative deadline',()=>{
 assert.equal(validateReviewedOwnerHandoff({proposal:base,approval:{...approval,spec},record,workload:{validated:true,ownerRef:'workload-owner'}}).owner,'D16');
 for(const wrong of [{...spec,learningUnitIds:['not-taught']},{...spec,dueAt:null},{...spec,graded:true},{...spec,sourceLineage:{...spec.sourceLineage,classroomRecordRef:'stale'}}])
  assert.throws(()=>validateReviewedOwnerHandoff({proposal:base,approval:{...approval,spec:wrong},record,workload:{validated:true,ownerRef:'workload-owner'}}));
 assert.throws(()=>validateReviewedOwnerHandoff({proposal:base,approval:{...approval,spec},record,workload:{validated:false,ownerRef:'workload-owner'}}));
});
test('no-homework is allowed only as an explicit independently adopted owner decision',()=>{
 const proposal={...base,output:{artifacts:{homework_proposal:{assign:false}}}};
 const a={...approval,outputHash:hash(proposal.output),decision:'NO_HOMEWORK'};
 assert.equal(validateReviewedOwnerHandoff({proposal,approval:a,record}).noHomework,true);
 assert.throws(()=>validateReviewedOwnerHandoff({proposal,approval:{...a,decision:'CREATE_APPROVED_ASSIGNMENT'},record}));
});
test('D17 handoff only forwards owner-selected blueprint to existing eligibility validation',()=>{
 const proposal={...base,mode:'guide_assessment',output:{artifacts:{assessment_guidance:{}}}};
 const a={approved:true,independent:true,owner:'D17',ownerRef:'d17',reviewRef:'r2',inputHash:'i1',recordHash:'v1',outputHash:hash(proposal.output),
  decision:'PREPARE_ELIGIBLE_BLUEPRINT',assessmentId:'assessment',input:{blueprint:{slots:[]},measurementRequirements:{coverage:'actual'}}};
 assert.equal(validateReviewedOwnerHandoff({proposal,approval:a,record}).owner,'D17');
 assert.throws(()=>validateReviewedOwnerHandoff({proposal,approval:{...a,input:{...a.input,lane:'FORECAST_PLANNING'}},record}));
 assert.throws(()=>validateReviewedOwnerHandoff({proposal,approval:{...a,owner:'D20'},record}));
});
