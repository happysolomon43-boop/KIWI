'use strict';
// D16 is the only assignment creator. Holding the D14 delivery row while
// checking the current immutable reconciliation prevents a late Class
// evaluation from replacing the approved scope between review and commit.
function fail(code){throw Object.assign(new Error(code),{code,status:409});}
async function assertClassroomSourceUsing(tx,{studentId,classId,courseId,sourceLineage,learningUnitIds}={}){
 const ref=sourceLineage?.classroomRecordRef;
 if(!ref)return {bound:false};
 if(!studentId||!classId||!courseId||!Array.isArray(learningUnitIds)||
  !sourceLineage.classClosureRef||!sourceLineage.reviewedProposalHash||
  !/^[a-f0-9]{64}$/.test(sourceLineage.reviewedProposalHash))
  throw fail('TEACHING_D16_CLASSROOM_SOURCE_BINDING_REQUIRED');
 const delivery=(await tx.query(
  'select d.session_id,s.course_id,s.lifecycle_state from public.teaching_classroom_delivery d join public.teaching_class_sessions s on s.class_session_id=d.session_id and s.student_id=d.student_id where d.student_id=$1 and d.class_id=$2 for update of d',
  [studentId,classId])).rows[0];
 if(!delivery||delivery.lifecycle_state!=='CLOSED'||delivery.course_id!==courseId)
  throw fail('TEACHING_D16_CLASSROOM_SOURCE_NOT_OWNED_OR_CLOSED');
 const [latest,fact]=await Promise.all([
  tx.query('select record_id,content_hash,record from public.teaching_classroom_reconciliation_versions where student_id=$1 and session_id=$2 order by version_no desc limit 1',[studentId,delivery.session_id]),
  tx.query('select closure_fact_id from public.teaching_class_closure_facts where student_id=$1 and class_session_id=$2',[studentId,delivery.session_id])
 ]);
 const record=latest.rows[0],closure=fact.rows[0];
 if(!record||!closure||ref!=='classroom-record:'+record.record_id+'@'+record.content_hash||
  sourceLineage.classClosureRef!=='class-closure:'+closure.closure_fact_id)
  throw fail('TEACHING_D16_CLASSROOM_SOURCE_STALE');
 const actual=new Set(record.record?.confirmed_taught_learning_unit_refs||[]);
 if(!learningUnitIds.length||learningUnitIds.some(id=>!actual.has(id)))
  throw fail('TEACHING_D16_CLASSROOM_SCOPE_NOT_CONFIRMED');
 return {bound:true,recordId:record.record_id,contentHash:record.content_hash,sessionId:delivery.session_id};
}
module.exports={assertClassroomSourceUsing};
