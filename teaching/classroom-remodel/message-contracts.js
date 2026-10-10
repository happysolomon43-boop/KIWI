'use strict';
const {failure,value}=require('./presentation-policy');
const c=require('./contracts');
const VERSION='classroom-messages.v1';
function validateInput(input){
 const fields=['schemaVersion','sessionId','operationKey','content','intent','sourceRef','replyTo'];
 if(!input||Array.isArray(input)||Object.keys(input).some(k=>!fields.includes(k)))throw failure('CLASSROOM_MESSAGE_INVALID',422);
 for(const k of ['sessionId','operationKey','content'])if(typeof input[k]!=='string'||!input[k].trim())throw failure('CLASSROOM_MESSAGE_INVALID',422);
 if(input.schemaVersion!==VERSION||!['conversation','clarification','technical_report','correction_report'].includes(input.intent))throw failure('CLASSROOM_MESSAGE_LANE_UNAVAILABLE',422);
 if(input.sourceRef!=null)c.versionRef(input.sourceRef);
 if(input.replyTo!=null&&(typeof input.replyTo!=='string'||!input.replyTo.trim()))throw failure('CLASSROOM_MESSAGE_INVALID',422);
 return {...input,sourceRef:input.sourceRef??null,replyTo:input.replyTo??null};
}
function ready(policy){const s=require('./state-policy');return s.capabilityReadiness(policy,'messages').ready&&s.capabilityReadiness(policy,'generation').ready;}
function assertPolicy(policy){if(!ready(policy))throw failure('CLASSROOM_MESSAGE_POLICY_MISSING',503);if(policy.fields.messageRateLimit.unit!=='accepted_messages_per_window'||policy.fields.conversationalAllowance.unit!=='accepted_turns_per_session')throw failure('CLASSROOM_MESSAGE_POLICY_UNIT_MISSING',503);return policy;}
function validateDisposition(output,{messageId,chapter,acknowledged=[]}={}){
 c.validateCoordinator(output,{mode:'handle_message',messageRefs:[messageId],chapter,confirmedAcknowledgements:acknowledged});
 if(output.status!=='complete'||output.review_required)throw failure('CLASSROOM_MESSAGE_ROUTING_HELD',409);
 const d=output.artifacts.message_dispositions[0];
 if(d.reply_delivery_status==='delivered_confirmed'||d.difficulty_resolution==='resolved'||d.confirmed_queue_state==='answered'||d.requested_queue_transition==='answered')throw failure('CLASSROOM_MESSAGE_PREMATURE_ANSWER',422);
 if(d.classification==='response to a teacher question'||output.artifacts.replan_request||output.runtime_requests.length)throw failure('CLASSROOM_MESSAGE_OWNER_DECISION_REQUIRED',409);
 if(output.next_action&&!['answer message','request clarification','wait'].includes(output.next_action.action))throw failure('CLASSROOM_MESSAGE_ACTION_UNAVAILABLE',409);
 if(output.next_action&&output.next_action.timing!==d.response_timing)throw failure('CLASSROOM_MESSAGE_TIMING_CONFLICT',422);
 const schedules=(output.artifacts.scheduling||[]).filter(s=>s.message_refs.includes(messageId));
 if(schedules.length>1||(output.artifacts.scheduling||[]).some(s=>s.message_refs.some(id=>id!==messageId)))throw failure('CLASSROOM_MESSAGE_SCHEDULE_INVALID',422);
 const scheduled=schedules[0];
 if(scheduled?.requested_handling==='unit'&&!chapter.units.some(u=>u.anchor===scheduled.boundary_ref))throw failure('CLASSROOM_MESSAGE_UNIT_UNAVAILABLE',422);
 const kind=scheduled?.requested_handling||(d.disposition==='preserve for follow-up'?'follow_up_proposal':d.response_timing==='at the end of class'?'closure':d.response_timing==='immediately'?'immediate':'boundary');
 if(kind==='immediate'&&!['expression of confusion','clarification request'].includes(d.classification))throw failure('CLASSROOM_MESSAGE_URGENT_DECISION_REQUIRED',409);
 if(kind==='boundary'&&scheduled?.boundary_ref&&!chapter.units.some(u=>u.anchor===scheduled.boundary_ref||u.elements.some(e=>e.anchor===scheduled.boundary_ref)))throw failure('CLASSROOM_MESSAGE_BOUNDARY_UNAVAILABLE',422);
 if(d.grouping_refs.some(id=>typeof id!=='string')||d.grouping_refs.includes(messageId))throw failure('CLASSROOM_MESSAGE_GROUP_INVALID',422);
 return {disposition:d,kind,anchor:scheduled?.boundary_ref||null};
}
module.exports={VERSION,validateInput,assertPolicy,ready,validateDisposition,value};
