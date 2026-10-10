'use strict';

// Durable operational facts, never an inference of reading or learning. Keys,
// provider context and private evaluation findings are intentionally absent.
function closureRecord({chapter,followUps=[],binding,delivery,portions=[],questions=[],windows=[],admissions=[],exposures=[],evaluations=[],corrections=[],progress={}}) {
 const resolvedElsewhere=new Set(followUps.filter(l=>l.source_session_id===delivery.session_id&&l.state==='RESOLVED').map(l=>l.message_id));
 const evaluated=new Set(evaluations.filter(e=>e.state==='COMPLETED').map(e=>e.admission_id));
 const confirmedAnchors=portions.filter(p=>p.status==='CONFIRMED').flatMap(p=>p.public_payload.source_refs||[]).filter(r=>r.id===chapter?.id&&String(r.version)===String(chapter?.version)).map(r=>r.anchor);
 const taught=(chapter?.units||[]).filter(u=>confirmedAnchors.some(anchor=>anchor===u.anchor||typeof anchor==='string'&&anchor.startsWith(u.anchor+'.'))).flatMap(u=>u.objective_refs||[]).filter(r=>r.kind==='course_learning_unit').map(r=>r.id);
 return {
  schema_version:'classroom-closure.v1',
  source_binding:{chapter_id:binding.chapter_artifact_id,plan_id:binding.plan_artifact_id,guide_id:binding.guide_artifact_id,binding_version:binding.binding_version},
  position:{last_published:Number(delivery.last_published),last_render_confirmed:Number(delivery.last_confirmed),resume_anchor:delivery.resume_anchor},
  confirmed_taught_learning_unit_refs:[...new Set(taught)],
  published:portions.map(p=>({portion_id:p.portion_id,sequence:Number(p.server_sequence),source_refs:p.public_payload.source_refs,teacher_message:p.public_payload.teacher_message||null,render_confirmed:p.status==='CONFIRMED',board_refs:p.board_item_ids})),
  pending_questions:questions.filter(q=>q.state!=='answered').map(q=>({message_id:q.message_id,state:'unresolved at closure',difficulty_resolution:q.difficulty_resolution||'not_established',reply_delivery_status:q.reply_delivery_status||'unknown'})),
  task_outcomes:windows.map(w=>({task_id:w.task_id,window_id:w.window_id,state:w.state,opened_at:w.opened_at,deadline_at:w.deadline_at,system_reason:w.system_reason||null})),
  accepted_responses:admissions.map(a=>({admission_id:a.admission_id,response_id:a.response_id,task_id:a.task_id,accepted_at:a.accepted_at})),
  exposure_and_assistance:{events:exposures.map(e=>({exposure_id:e.exposure_id,task_id:e.task_id,stage:e.exposure_payload.stage,assistance_level:e.exposure_payload.assistance_level,answer_or_method_exposed:e.exposure_payload.answer_or_method_exposed===true,occurred_at:e.occurred_at})),accepted_response_context:admissions.map(a=>({admission_id:a.admission_id,assistance_level:a.exposure_snapshot?.released_assistance_level||'unknown',answer_or_method_exposed:a.exposure_snapshot?.answer_or_method_exposed??null,uncertain_exposure:a.exposure_snapshot?.uncertain_exposure??true})),independence_owner:'D12 exposure and evidence policy'},
  pending_evaluations:admissions.filter(a=>!evaluated.has(a.admission_id)).map(a=>a.admission_id),
  evaluations:evaluations.filter(e=>e.state==='COMPLETED').map(e=>({evaluation_id:e.evaluation_id,admission_id:e.admission_id,completed_after_closure:e.completed_after_closure===true,feedback_delivered_in_class:e.feedback_delivered_in_class===true})),
  linked_question_outcomes:followUps.map(l=>({link_id:l.link_id,message_id:l.message_id,source_session_id:l.source_session_id,target_session_id:l.target_session_id,reply_portion_id:l.reply_portion_id||null,reply_confirmed:l.state==='RESOLVED',difficulty_resolution:'not_established',old_class_reopened:false})),
  corrections:corrections.map(r=>({revision_id:r.revision_id,original_portion_id:r.original_portion_id,state:r.state})),
  work:{completed_objective_refs:progress.completed_objective_refs||[],independently_evidenced_objective_refs:progress.independent_evidence_objective_refs||[],classification_owner:'D11/D12 evidence policy',publication_is_not_completion:true},
  carry_forward:{question_refs:questions.filter(q=>q.state!=='answered'&&!resolvedElsewhere.has(q.message_id)).map(q=>q.message_id),resume_anchor:delivery.resume_anchor,confirmed_follow_up:[],proposed_follow_up:[],scheduled:false},
 };
}
module.exports={closureRecord};
