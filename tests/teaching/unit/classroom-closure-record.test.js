'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {closureRecord} = require('../../../teaching/classroom-remodel/closure-record');
function record(extra = {}) {
  return closureRecord({binding:{chapter_artifact_id:'chapter',plan_artifact_id:'plan',guide_artifact_id:'guide',binding_version:2},delivery:{last_published:2,last_confirmed:1,resume_anchor:'U01.E02'},...extra});
}
test('closure distinguishes published content, confirmed rendering and evidence of completion', () => {
  const result = record({portions:[{portion_id:'p',server_sequence:2,status:'PUBLISHED',public_payload:{source_refs:['source'],expected_solution:'PRIVATE'},board_item_ids:['board']}],progress:{completed_objective_refs:['objective'],independent_evidence_objective_refs:[]}});
  assert.equal(result.published[0].render_confirmed,false);
  assert.deepEqual(result.position,{last_published:2,last_render_confirmed:1,resume_anchor:'U01.E02'});
  assert.deepEqual(result.work.independently_evidenced_objective_refs,[]);
  assert.equal(result.work.publication_is_not_completion,true);
  assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
});
test('accepted responses remain pending until their immutable evaluation completes', () => {
  const result = record({admissions:[{admission_id:'a'},{admission_id:'b'}],evaluations:[{admission_id:'a',state:'PROCESSING'},{admission_id:'b',state:'COMPLETED',evaluation_id:'e',completed_after_closure:true}]});
  assert.deepEqual(result.pending_evaluations,['a']);
  assert.equal(result.evaluations[0].completed_after_closure,true);
  assert.equal(result.evaluations[0].feedback_delivered_in_class,false);
});
test('carry-forward preserves unanswered questions without promising scheduling or difficulty resolution', () => {
  const result = record({questions:[{message_id:'q',state:'reply pending delivery',difficulty_resolution:'unknown'},{message_id:'answered',state:'answered'}]});
  assert.deepEqual(result.carry_forward.question_refs,['q']);
  assert.equal(result.carry_forward.scheduled,false);
  assert.equal(result.pending_questions[0].difficulty_resolution,'unknown');
  assert.equal(result.pending_questions[0].reply_delivery_status,'unknown');
});
test('actual taught scope requires confirmed rendering against the pinned chapter version',()=>{
  const chapter={id:'chapter',version:'2',units:[{anchor:'U01',objective_refs:[{kind:'course_learning_unit',id:'unit'}]}]};
  const portion=(status,version)=>({portion_id:status,server_sequence:1,status,public_payload:{source_refs:[{id:'chapter',version,anchor:'U01.E01'}]},board_item_ids:[]});
  assert.deepEqual(record({chapter,portions:[portion('PUBLISHED','2'),portion('CONFIRMED','1')]}).confirmed_taught_learning_unit_refs,[]);
  assert.deepEqual(record({chapter,portions:[portion('CONFIRMED','2')]}).confirmed_taught_learning_unit_refs,['unit']);
});
