'use strict';
const {TEACHING_EVENTS}=require('../events/names');
const MODES=new Set(['OPENING','DIAGNOSTIC','INSTRUCTION','GUIDED_PRACTICE','INDEPENDENT_PRACTICE','REMEDIATION']);
async function enqueueInstructionUsing(tx,outboxStore,session) {
  if(!outboxStore?.appendUsing||!session?.lesson_blueprint_id||session.lifecycle_state!=='ACTIVE'||!MODES.has(session.instructional_substate))return null;
  const key='d14-instruction:'+session.class_session_id+':v'+session.state_version;
  // Use persisted time so retries reconstruct the identical event envelope.
  const occurredAt=new Date(session.updated_at||session.started_at||session.created_at).toISOString();
  return outboxStore.appendUsing(tx.query.bind(tx),{eventId:key,schemaVersion:1,eventType:TEACHING_EVENTS.CLASSROOM_INSTRUCTION_READY,eventCategory:'committed_domain_event',triggerType:'committed_domain_event',source:'teaching.d14',origin:'d14',actorId:session.student_id,aggregateType:'CLASS',aggregateId:session.class_id,aggregateVersion:Number(session.state_version),occurredAt,idempotencyKey:key,correlationId:key,payload:{student_id:session.student_id,class_id:session.class_id,class_session_id:session.class_session_id,controller_version:Number(session.state_version)}});
}
module.exports={enqueueInstructionUsing};
