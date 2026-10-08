'use strict';

function createD14ClassroomRepository({query,withTransaction,randomUUID,d11Repository}={}) {
  if (![query,withTransaction,randomUUID].every((f)=>typeof f==='function') || !d11Repository) throw new TypeError('D14 persistence dependencies required.');
  async function assertReady() {
    const {rows}=await query("select to_regclass('public.teaching_student_notebook_items') notebook,to_regclass('public.teaching_classroom_interactions') interactions,to_regclass('public.teaching_class_study_note_versions') study_notes,to_regclass('public.teaching_teacher_communications') teacher_messages");
    if(Object.values(rows?.[0]||{}).some((v)=>v==null)) throw Object.assign(new Error('D14 persistence missing.'),{code:'TEACHING_D14_SCHEMA_MISSING'});
  }
  async function listClasses(studentId,courseId) {
    const {rows}=await query(`select c.class_id,c.course_id,c.scheduled_start_at,c.scheduled_end_at,c.timezone,c.lifecycle_state,c.schedule_version,
      s.lifecycle_state session_state,s.instructional_substate,
      a.outcome attendance_outcome,a.presence_state,a.missed_minutes,a.arrived_at,a.exited_at
      from public.teaching_classes c
      join public.teaching_courses co on co.student_id=c.student_id and co.course_id=c.course_id
      left join lateral (
        select timetable_version_id from public.teaching_timetable_versions t
        where t.student_id=c.student_id and t.semester_id=co.semester_id and t.timetable_state='APPROVED'
        order by t.version_no desc limit 1
      ) approved on true
      left join lateral (
        select lifecycle_state,instructional_substate from public.teaching_class_sessions
        where student_id=c.student_id and class_id=c.class_id order by created_at desc limit 1
      ) s on true
      left join lateral (
        select outcome,presence_state,missed_minutes,arrived_at,exited_at from public.teaching_attendance_records
        where student_id=c.student_id and class_id=c.class_id and schedule_version=c.schedule_version
        order by version_no desc,recorded_at desc limit 1
      ) a on true
      where c.student_id=$1 and c.course_id=$2 and c.lifecycle_state<>'CANCELLED'
        and (
          approved.timetable_version_id is null
          or c.source_timetable_version_id=approved.timetable_version_id
          or co.semester_id is null
          or s.lifecycle_state is not null
          or a.outcome is not null
          or c.lifecycle_state<>'SCHEDULED'
        )
      order by c.scheduled_start_at`,[studentId,courseId]);
    return rows;
  }
  async function identity(studentId,courseId) {
    const {rows}=await query('select co.title course_title,t.display_name teacher_name from public.teaching_courses co left join lateral (select i.display_name from public.teaching_course_teacher_assignments a join public.teaching_teacher_identities i on i.teacher_identity_id=a.teacher_identity_id and i.student_id=a.student_id where a.student_id=co.student_id and a.course_id=co.course_id and a.effective_to is null order by a.version_no desc limit 1) t on true where co.student_id=$1 and co.course_id=$2',[studentId,courseId]);
    return rows?.[0]||null;
  }
  async function board(studentId,classSessionId) {
    if(!classSessionId)return [];
    const {rows}=await query('select s.board_scene_id,s.ordinal scene_ordinal,s.scene_type,s.title,i.board_item_id,i.ordinal item_ordinal,i.block_type,i.content,i.provenance_refs from public.teaching_board_scenes s left join public.teaching_board_items i on i.board_scene_id=s.board_scene_id and i.student_id=s.student_id where s.student_id=$1 and s.class_session_id=$2 order by s.ordinal,i.ordinal',[studentId,classSessionId]);
    const scenes=[];for(const row of rows){let scene=scenes.at(-1);if(!scene||scene.boardSceneId!==row.board_scene_id){scene={boardSceneId:row.board_scene_id,ordinal:row.scene_ordinal,type:row.scene_type,title:row.title,items:[]};scenes.push(scene);}if(row.board_item_id)scene.items.push({boardItemId:row.board_item_id,ordinal:row.item_ordinal,type:row.block_type,content:row.content,provenanceRefs:row.provenance_refs});}
    return scenes;
  }
  async function notebook(studentId,classId){const {rows}=await query('select notebook_item_id,board_item_id,content,source_kind,version_no,created_at,updated_at from public.teaching_student_notebook_items where student_id=$1 and class_id=$2 order by created_at,notebook_item_id',[studentId,classId]);return rows;}
  // A bounded, student-only projection of already committed classroom communication.
  // This is not a transcript of model reasoning and cannot publish a Teacher turn.
  async function conversation(studentId,classId){
    const [student,teacher]=await Promise.all([
      query("select interaction_id id,interaction_kind kind,body message,created_at sent_at from public.teaching_classroom_interactions where student_id=$1 and class_id=$2 and interaction_kind in ('ASK_TEACHER','NEED_HELP') and body is not null order by created_at desc limit 40",[studentId,classId]),
      query("select communication_id id,message,created_at sent_at from public.teaching_teacher_communications where student_id=$1 and class_id=$2 and visibility='STUDENT' order by created_at desc limit 40",[studentId,classId])
    ]);
    return [...(student.rows||[]).map(row=>({id:row.id,role:'STUDENT',kind:row.kind,message:row.message,sentAt:row.sent_at})),
      ...(teacher.rows||[]).map(row=>({id:row.id,role:'TEACHER',kind:'TEACHER_TURN',message:row.message,sentAt:row.sent_at}))]
      .sort((a,b)=>Date.parse(a.sentAt)-Date.parse(b.sentAt)||String(a.id).localeCompare(String(b.id)));
  }
  async function latestTeacherMessage(studentId,classId){const {rows}=await query("select communication_id,message,created_at from public.teaching_teacher_communications where student_id=$1 and class_id=$2 and visibility='STUDENT' order by created_at desc limit 1",[studentId,classId]);return rows[0]||null;}
  async function firstEntry(studentId,classId){const {rows}=await query("select created_at from public.teaching_classroom_interactions where student_id=$1 and class_id=$2 and interaction_kind='JOIN' order by created_at limit 1",[studentId,classId]);return rows[0]||null;}
  async function publishTeacherTurn({studentId,classId,expectedControllerVersion,message,blocks=[],idempotencyKey}){
    const {validateBlock}=require('../d14/board');
    if(typeof message!=='string'||!message.trim()||message.length>5000||!Array.isArray(blocks)||blocks.length>30)throw Object.assign(new Error('Teacher turn invalid.'),{code:'TEACHING_D14_TEACHER_TURN_INVALID',status:422});
    const safe=blocks.map(validateBlock);
    return withTransaction(async(tx)=>{
      const existing=await tx.query('select * from public.teaching_teacher_communications where student_id=$1 and idempotency_key=$2',[studentId,idempotencyKey]);
      if(existing.rows[0])return existing.rows[0];
      const locked=await tx.query('select * from public.teaching_class_sessions where student_id=$1 and class_id=$2 for update',[studentId,classId]);const session=locked.rows[0];
      if(!session||session.lifecycle_state!=='ACTIVE'||Number(session.state_version)!==Number(expectedControllerVersion)||['ASSESSMENT','BREAK','INTERRUPTED'].includes(session.instructional_substate))throw Object.assign(new Error('Teacher turn targets stale or restricted Class state.'),{code:'TEACHING_D14_TEACHER_TURN_STALE',status:409});
      const {rows}=await tx.query("insert into public.teaching_teacher_communications(communication_id,student_id,class_id,class_session_id,controller_version,message,visibility,provenance_refs,idempotency_key) values($1,$2,$3,$4,$5,$6,'STUDENT',$7::jsonb,$8) returning *",[randomUUID(),studentId,classId,session.class_session_id,session.state_version,message.trim(),JSON.stringify([`class-session:${session.class_session_id}@${session.state_version}`]),idempotencyKey]);
      if(safe.length){const ordinal=await tx.query('select coalesce(max(ordinal),-1)+1 n from public.teaching_board_scenes where class_session_id=$1',[session.class_session_id]);const sceneId=randomUUID();
        await tx.query("insert into public.teaching_board_scenes(board_scene_id,student_id,class_session_id,ordinal,scene_type,title) values($1,$2,$3,$4,'TEACHER_TURN',$5)",[sceneId,studentId,session.class_session_id,ordinal.rows[0].n,null]);
        for(const [i,b] of safe.entries())await tx.query('insert into public.teaching_board_items(board_item_id,student_id,board_scene_id,ordinal,block_type,content,provenance_refs) values($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)',[randomUUID(),studentId,sceneId,i,b.type,JSON.stringify(b.content),JSON.stringify([`teacher-communication:${rows[0].communication_id}`])]);
      }
      return rows[0];
    });
  }
  async function addNotebook({studentId,classId,content,sourceKind,boardItemId=null,idempotencyKey}){
    return withTransaction(async(tx)=>{
      const existing=await tx.query('select * from public.teaching_student_notebook_items where student_id=$1 and idempotency_key=$2',[studentId,idempotencyKey]);
      if(existing.rows[0]){if(existing.rows[0].class_id!==classId||existing.rows[0].content!==content||existing.rows[0].board_item_id!==boardItemId)throw Object.assign(new Error('Conflicting notebook retry.'),{code:'TEACHING_D14_IDEMPOTENCY_CONFLICT',status:409});return existing.rows[0];}
      if(boardItemId){const item=await tx.query('select 1 from public.teaching_board_items i join public.teaching_board_scenes s on s.board_scene_id=i.board_scene_id join public.teaching_class_sessions cs on cs.class_session_id=s.class_session_id where i.board_item_id=$1 and i.student_id=$2 and cs.class_id=$3',[boardItemId,studentId,classId]);if(!item.rows[0])throw Object.assign(new Error('Board item not in Class.'),{status:404,code:'TEACHING_D14_BOARD_ITEM_NOT_FOUND'});}
      const {rows}=await tx.query('insert into public.teaching_student_notebook_items(notebook_item_id,student_id,class_id,board_item_id,content,source_kind,idempotency_key) values($1,$2,$3,$4,$5,$6,$7) returning *',[randomUUID(),studentId,classId,boardItemId,content,sourceKind,idempotencyKey]);return rows[0];
    });
  }
  async function recordInteraction({studentId,classId,session,kind,body,idempotencyKey}){
    return withTransaction(async(tx)=>{
      const existing=await tx.query('select * from public.teaching_classroom_interactions where student_id=$1 and idempotency_key=$2',[studentId,idempotencyKey]);
      if(existing.rows[0]){if(existing.rows[0].class_id!==classId||existing.rows[0].interaction_kind!==kind||existing.rows[0].body!==body)throw Object.assign(new Error('Conflicting interaction retry.'),{status:409,code:'TEACHING_D14_IDEMPOTENCY_CONFLICT'});return existing.rows[0];}
      const current=await tx.query('select class_session_id,state_version,lifecycle_state from public.teaching_class_sessions where student_id=$1 and class_id=$2 for update',[studentId,classId]);
      if(session && (current.rows[0]?.class_session_id!==session.class_session_id||Number(current.rows[0]?.state_version)!==Number(session.state_version)))throw Object.assign(new Error('Class changed. Reload before acting.'),{status:409,code:'TEACHING_D14_STALE_CONTROLLER'});
      const {rows}=await tx.query('insert into public.teaching_classroom_interactions(interaction_id,student_id,class_id,class_session_id,controller_version,interaction_kind,body,idempotency_key) values($1,$2,$3,$4,$5,$6,$7,$8) returning *',[randomUUID(),studentId,classId,session?.class_session_id||null,session?.state_version||null,kind,body,idempotencyKey]);return rows[0];
    });
  }
  async function latestNote(studentId,classId){const {rows}=await query('select * from public.teaching_class_study_note_versions where student_id=$1 and class_id=$2 order by version_no desc limit 1',[studentId,classId]);return rows[0]||null;}
  async function saveNote({studentId,classId,state,stage,binding,payload={},validation={},closureFactId=null,idempotencyKey}){
    return withTransaction(async(tx)=>{
      const previous=await tx.query('select * from public.teaching_class_study_note_versions where student_id=$1 and class_id=$2 order by version_no desc limit 1 for update',[studentId,classId]);
      const old=previous.rows[0];if(old?.idempotency_key===idempotencyKey)return old;
      const {rows}=await tx.query('insert into public.teaching_class_study_note_versions(note_version_id,student_id,class_id,version_no,state,stage,binding,note_payload,validation,closure_fact_id,idempotency_key) values($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11) returning *',[randomUUID(),studentId,classId,Number(old?.version_no||0)+1,state,stage,JSON.stringify(binding),JSON.stringify(payload),JSON.stringify(validation),closureFactId,idempotencyKey]);return rows[0];
    });
  }
  return Object.freeze({assertReady,listClasses,identity,board,notebook,addNotebook,recordInteraction,conversation,latestNote,saveNote,latestTeacherMessage,firstEntry,publishTeacherTurn});
}
module.exports={createD14ClassroomRepository};
