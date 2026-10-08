'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {getCapability,listCapabilities}=require('../../../teaching/capability-registry');
const {CAPABILITY}=require('../../../teaching/d14/help-intelligence');
test('D14 uses frozen TPF-08 natural Teacher explanation capability, never an independent chatbot',()=>{
  const cap=getCapability(CAPABILITY);
  assert.equal(cap.id,'teaching.pedagogy.natural_teacher_explanation_generation');
  assert.equal(cap.authority_ceiling,'T1');
  assert.equal(cap.prompt_family_id,'TPF-08');
  assert.equal(cap.authoritative_owner_boundary,'AI Teacher');
  assert.equal(cap.execution_class,'DIRECT-AI');
  assert.ok(listCapabilities().some(x=>x.id===cap.id));
  assert.notEqual(cap.id,'teaching.pedagogy.outside_class_teacher_q_a');
  assert.notEqual(cap.id,'teaching.pedagogy.board_instructional_content_generation');
});
