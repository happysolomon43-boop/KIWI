'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {beforeEnd,closingSource,prepareBeforeEnd}=require('../../../teaching/classroom-remodel/pre-closure');
const policy=lead=>({fields:{closureLeadMs:{value:lead}}});
const state=now=>({session_id:'s',class_id:'c',server_time:now||'2026-10-10T09:50:00Z',
 controller_version:1,delivery_version:2,delivery_epoch:1,capabilities:{presentation:true},
 clocks:{class_end_at:'2026-10-10T10:00:00Z'},position:{last_published:2,last_render_confirmed:1,resume_anchor:'U01.E02'},
 messages:{questions:[{message_id:'q',state:'waiting'}]},active_task:null});
const c={session:{lifecycle_state:'ACTIVE',instructional_substate:'INSTRUCTION'}};
test('adopted lead time fences pre-end closing and protected activities',()=>{
 assert.equal(beforeEnd(state(),c,policy(600000)).eligible,true);
 for(const [s,context,lead] of [[state(),c,0],[state('2026-10-10T09:30:00Z'),c,600000],
 [state('2026-10-10T10:00:00Z'),c,600000],[state(),{session:{...c.session,instructional_substate:'ASSESSMENT'}},600000]])
  assert.equal(beforeEnd(s,context,policy(lead)).held,true);
});
test('closing source reflects render provenance and unresolved work without mastery claims',()=>{
 const x=closingSource(state(),{remainingMs:400000});
 assert.equal(x.position.last_render_confirmed,1);
 assert.equal(x.pendingQuestions[0].messageId,'q');
 assert.equal(x.claimRestrictions.unconfirmedPortionsNotTaught,true);
});
test('without a governed close_class capability no fake presenter or closure occurs',async()=>{
 let called=false;const result=await prepareBeforeEnd({studentId:'s',classId:'c',
  closing:{qualified:false,coordinator:{closeClass:async()=>{called=true;}}}});
 assert.equal(result.held,true);assert.equal(result.closureCommitted,false);assert.equal(called,false);
});
