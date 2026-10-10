'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {reviewedContinuationLinks}=require('../../../teaching/classroom-remodel/delivery7-intelligence');
const history={records:[{state:'EXACT_RECORDS_AVAILABLE',session_id:'prior',classroom:{pending_questions:[{message_id:'q1',state:'unresolved at closure'},{message_id:'answered',state:'answered'}]}},{state:'LEGACY_RECORDS_AVAILABLE',session_id:'legacy',classroom:{pending_questions:[{message_id:'q2',state:'unresolved at closure'}]}}]};
const receipt=approvedQuestionRefs=>({accepted:true,independent:true,ownerRef:'fixture-owner',approvedQuestionRefs});
test('only independently approved unresolved questions from exact source Class are linkable',()=>{
 assert.deepEqual(reviewedContinuationLinks({receipt:receipt([{sourceSessionId:'prior',messageId:'q1'}]),history}),[{sourceSessionId:'prior',messageId:'q1'}]);
 assert.deepEqual(reviewedContinuationLinks({receipt:receipt([]),history}),[]);
});
test('unreviewed, answered, legacy, foreign and duplicate follow-ups are rejected',()=>{
 for(const refs of [[{sourceSessionId:'prior',messageId:'answered'}],[{sourceSessionId:'other',messageId:'q1'}],[{sourceSessionId:'legacy',messageId:'q2'}],[{sourceSessionId:'prior',messageId:'q1'},{sourceSessionId:'prior',messageId:'q1'}],[{sourceSessionId:'prior',messageId:'q1',scheduled:true}]])
  assert.throws(()=>reviewedContinuationLinks({receipt:receipt(refs),history}));
 assert.throws(()=>reviewedContinuationLinks({receipt:{accepted:true,independent:false,approvedQuestionRefs:[]},history}));
});
