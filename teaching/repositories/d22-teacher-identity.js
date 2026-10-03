'use strict';

const { TPF08, TPF18 } = require('../d22/contracts');

const CONTINUITY_CARRY_FORWARD='CONTINUITY_CARRY_FORWARD';

function createD22TeacherIdentityRepository({query,withTransaction,randomUUID,clock=()=>new Date()}={}){
  if(typeof query!=='function'||typeof withTransaction!=='function'||typeof randomUUID!=='function')throw new TypeError('D22 repository requires query, withTransaction and randomUUID.');
  const q=(runner,sql,params=[])=>runner?(typeof runner==='function'?runner(sql,params):runner.query(sql,params)):query(sql,params);
  const now=()=>{const v=clock();return v instanceof Date?v:new Date(v);};
  const json=(v)=>JSON.stringify(v??null);
  function err(message,code,status=409,details=null){const e=new Error(message);e.code=code;e.status=status;if(details)e.details=details;return e;}

  async function assertReady(){
    const {rows}=await query(`select
      to_regclass('public.teaching_teacher_identities') teacher_identities,
      to_regclass('public.teaching_teacher_identity_versions') teacher_identity_versions,
      to_regclass('public.teaching_teacher_familiarity_states') teacher_familiarity_states,
      to_regclass('public.teaching_course_teacher_assignments') teacher_assignments,
      to_regclass('public.teaching_interaction_preferences') interaction_preferences,
      to_regclass('public.teaching_requests') requests`);
    if(Object.values(rows?.[0]||{}).some((v)=>v==null))throw err('Teaching D22 persistence is not installed.','TEACHING_D22_SCHEMA_NOT_READY',503);
    return true;
  }

  async function ensureCourse(studentId,courseId,runner=null,lock=false){
    const {rows}=await q(runner,`select * from public.teaching_courses where student_id=$1 and course_id=$2 ${lock?'for update':''}`,[studentId,courseId]);
    if(!rows?.[0])throw err('Teaching Course not found.','TEACHING_D22_COURSE_NOT_FOUND',404);
    return rows[0];
  }

  async function latestIdentityVersion(studentId,teacherIdentityId,runner=null){
    const {rows}=await q(runner,`select * from public.teaching_teacher_identity_versions where student_id=$1 and teacher_identity_id=$2 order by version_no desc limit 1`,[studentId,teacherIdentityId]);
    return rows?.[0]||null;
  }

  async function latestFamiliarity(studentId,teacherAssignmentId,runner=null){
    const {rows}=await q(runner,`select * from public.teaching_teacher_familiarity_states where student_id=$1 and teacher_assignment_id=$2 order by version_no desc limit 1`,[studentId,teacherAssignmentId]);
    return rows?.[0]||null;
  }

  async function currentAssignment(studentId,courseId,runner=null,lock=false){
    await ensureCourse(studentId,courseId,runner,lock);
    const suffix=lock?' for update of a':'';
    const {rows}=await q(runner,`select a.*,t.display_name,t.active teacher_active,t.style_envelope_version
      from public.teaching_course_teacher_assignments a
      join public.teaching_teacher_identities t on t.teacher_identity_id=a.teacher_identity_id
      where a.student_id=$1 and a.course_id=$2 and a.effective_to is null
      order by a.version_no desc limit 1${suffix}`,[studentId,courseId]);
    const assignment=rows?.[0]||null;if(!assignment)return null;
    const [version,familiarity]=await Promise.all([
      latestIdentityVersion(studentId,assignment.teacher_identity_id,runner),
      latestFamiliarity(studentId,assignment.teacher_assignment_id,runner),
    ]);
    return {assignment,version,familiarity};
  }

  async function interactionProfile(studentId,courseId,runner=null){
    const {rows}=await q(runner,`select * from public.teaching_interaction_preferences
      where student_id=$1 and course_id=$2 and superseded_at is null
      order by effective_at desc,created_at desc limit 1`,[studentId,courseId]);
    return rows?.[0]||null;
  }

  async function assignmentHistory(studentId,courseId){
    const {rows=[]}=await query(`select a.*,t.display_name
      from public.teaching_course_teacher_assignments a join public.teaching_teacher_identities t on t.teacher_identity_id=a.teacher_identity_id
      where a.student_id=$1 and a.course_id=$2 order by a.version_no asc`,[studentId,courseId]);
    return rows;
  }

  async function auditUsing(tx,{studentId,action,entityType,entityId,stateVersionRef=null,reason=null,beforeRef={},afterRef={},safeMetadata={}}){
    await q(tx,`insert into public.teaching_academic_audit_log(
      audit_id,student_id,occurred_at,actor_type,actor_id,action,entity_type,entity_id,authoritative_owner,
      state_version_ref,reason,before_ref,after_ref,provenance_refs,safe_metadata
    ) values($1,$2,$3,'SYSTEM',null,$4,$5,$6,'teacher_identity',$7,$8,$9::jsonb,$10::jsonb,'[]'::jsonb,$11::jsonb)`,
      [randomUUID(),studentId,now(),action,entityType,entityId,stateVersionRef==null?null:String(stateVersionRef),reason,json(beforeRef),json(afterRef),json(safeMetadata)]);
  }

  async function createIdentity({studentId,displayName,traits,broadStylePreference=null,presentationMetadata={},generationMode='D22_DETERMINISTIC_POLICY',influenceTrace=[],promptLineage=null}){
    return withTransaction(async(tx)=>{
      const teacherIdentityId=randomUUID(),versionId=randomUUID();
      const rootProfile={schema:'d22.teacher-identity-root.v1',structured_profile_owner:'teaching_teacher_identity_versions',ai_disclosure:true};
      const legacyPersonality={schema:'d22.personality-pointer.v1',deprecated_payload:true,structured_profile_owner:'teaching_teacher_identity_versions',academic_authority:false};
      const root=(await q(tx,`insert into public.teaching_teacher_identities(
        teacher_identity_id,student_id,display_name,identity_profile,personality_profile,style_envelope_version,active
      ) values($1,$2,$3,$4::jsonb,$5::jsonb,$6,true) returning *`,
      [teacherIdentityId,studentId,displayName,json(rootProfile),json(legacyPersonality),TPF08.styleEnvelopeVersion])).rows[0];
      const version=(await q(tx,`insert into public.teaching_teacher_identity_versions(
        teacher_identity_version_id,student_id,teacher_identity_id,version_no,style_envelope_schema_version,
        warmth,directness,formality,expressiveness,humor_frequency,encouragement_intensity,challenge_style,accountability_style,conversationality,
        presentation_metadata,generation_mode,broad_style_preference,influence_trace,prompt_family_id,prompt_family_version,prompt_sha256
      ) values($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17::jsonb,$18,$19,$20) returning *`,
      [versionId,studentId,teacherIdentityId,TPF08.styleEnvelopeVersion,traits.warmth,traits.directness,traits.formality,traits.expressiveness,traits.humor_frequency,traits.encouragement_intensity,traits.challenge_style,traits.accountability_style,traits.conversationality,json({...presentationMetadata,display_name:displayName,ai_disclosure:true}),generationMode,broadStylePreference,json(influenceTrace),promptLineage?.family||null,promptLineage?.version||null,promptLineage?.sha256||null])).rows[0];
      await auditUsing(tx,{studentId,action:'teacher_identity.create',entityType:'TEACHER_IDENTITY',entityId:teacherIdentityId,stateVersionRef:1,afterRef:{teacher_identity_version_id:versionId},safeMetadata:{style_envelope_schema_version:TPF08.styleEnvelopeVersion,academic_authority:false,subject_used_for_personality:false,demographics_used_for_personality:false}});
      return {identity:root,version};
    });
  }

  async function hydrateIdentityIfNeeded({studentId,teacherIdentityId,traits,displayName}){
    const existing=await latestIdentityVersion(studentId,teacherIdentityId);if(existing)return existing;
    return withTransaction(async(tx)=>{
      const locked=await q(tx,'select * from public.teaching_teacher_identities where student_id=$1 and teacher_identity_id=$2 for update',[studentId,teacherIdentityId]);
      const root=locked.rows?.[0];if(!root)throw err('Teacher Identity not found.','TEACHING_D22_TEACHER_NOT_FOUND',404);
      const prior=await latestIdentityVersion(studentId,teacherIdentityId,tx);if(prior)return prior;
      const version=(await q(tx,`insert into public.teaching_teacher_identity_versions(
        teacher_identity_version_id,student_id,teacher_identity_id,version_no,style_envelope_schema_version,
        warmth,directness,formality,expressiveness,humor_frequency,encouragement_intensity,challenge_style,accountability_style,conversationality,
        presentation_metadata,generation_mode,broad_style_preference,influence_trace
      ) values($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,'LEGACY_BACKFILL',null,$15::jsonb) returning *`,
      [randomUUID(),studentId,teacherIdentityId,TPF08.styleEnvelopeVersion,traits.warmth,traits.directness,traits.formality,traits.expressiveness,traits.humor_frequency,traits.encouragement_intensity,traits.challenge_style,traits.accountability_style,traits.conversationality,json({display_name:displayName||root.display_name,ai_disclosure:true}),json(['KIWI_DEFAULTS','PERSISTED_IDENTITY_STATE','PRODUCT_PRESENTATION_POLICY'])])).rows[0];
      await q(tx,'update public.teaching_teacher_identities set style_envelope_version=$3,updated_at=now() where student_id=$1 and teacher_identity_id=$2',[studentId,teacherIdentityId,TPF08.styleEnvelopeVersion]);
      return version;
    });
  }

  async function ensureFamiliarity({studentId,teacherAssignmentId,initialLevel='new',sourceKind='INITIAL_ASSIGNMENT',sourceRef=null}){
    const current=await latestFamiliarity(studentId,teacherAssignmentId);if(current)return current;
    return withTransaction(async(tx)=>{
      const assignment=(await q(tx,'select * from public.teaching_course_teacher_assignments where student_id=$1 and teacher_assignment_id=$2 for update',[studentId,teacherAssignmentId])).rows?.[0];
      if(!assignment)throw err('Teacher assignment not found.','TEACHING_D22_ASSIGNMENT_NOT_FOUND',404);
      const prior=await latestFamiliarity(studentId,teacherAssignmentId,tx);if(prior)return prior;
      return (await q(tx,`insert into public.teaching_teacher_familiarity_states(
        familiarity_state_id,student_id,teacher_assignment_id,version_no,familiarity_level,source_kind,source_ref
      ) values($1,$2,$3,1,$4,$5,$6) returning *`,[randomUUID(),studentId,teacherAssignmentId,initialLevel,sourceKind,sourceRef])).rows[0];
    });
  }

  async function recordAuthorizedFamiliarity({studentId,teacherAssignmentId,familiarityLevel,sourceRef}){
    return withTransaction(async(tx)=>{
      const assignment=(await q(tx,'select * from public.teaching_course_teacher_assignments where student_id=$1 and teacher_assignment_id=$2 for update',[studentId,teacherAssignmentId])).rows?.[0];
      if(!assignment)throw err('Teacher assignment not found.','TEACHING_D22_ASSIGNMENT_NOT_FOUND',404);
      const latest=await latestFamiliarity(studentId,teacherAssignmentId,tx);const next=Number(latest?.version_no||0)+1;
      const row=(await q(tx,`insert into public.teaching_teacher_familiarity_states(
        familiarity_state_id,student_id,teacher_assignment_id,version_no,familiarity_level,source_kind,source_ref
      ) values($1,$2,$3,$4,$5,'AUTHORIZED_RELATIONSHIP_UPDATE',$6) returning *`,[randomUUID(),studentId,teacherAssignmentId,next,familiarityLevel,sourceRef])).rows[0];
      await auditUsing(tx,{studentId,action:'teacher_identity.familiarity.update',entityType:'TEACHER_ASSIGNMENT',entityId:teacherAssignmentId,stateVersionRef:next,beforeRef:{familiarity_level:latest?.familiarity_level||null},afterRef:{familiarity_level:familiarityLevel},safeMetadata:{inferred_from_age_or_message_count:false}});
      return row;
    });
  }

  async function continuityCandidate(studentId,courseId){
    // D21 repeat lineage is an explicit, authoritative continuing-Course sequence.
    // Never infer continuity merely from matching Subject/title.
    const {rows}=await query(`select ca.source_course_id,ca.source_attempt_id,a.*,t.display_name,t.active teacher_active
      from public.teaching_course_attempts ca
      join lateral (
        select x.* from public.teaching_course_teacher_assignments x
        where x.student_id=ca.student_id and x.course_id=ca.source_course_id
        order by x.version_no desc limit 1
      ) a on true
      join public.teaching_teacher_identities t on t.teacher_identity_id=a.teacher_identity_id
      where ca.student_id=$1 and ca.course_id=$2 and ca.attempt_kind='REPEAT' and t.active=true limit 1`,[studentId,courseId]);
    const row=rows?.[0]||null;if(!row)return null;
    const [version,familiarity]=await Promise.all([latestIdentityVersion(studentId,row.teacher_identity_id),latestFamiliarity(studentId,row.teacher_assignment_id)]);
    return {sourceCourseId:row.source_course_id,sourceAttemptId:row.source_attempt_id,assignment:row,version,familiarity,sourceKind:CONTINUITY_CARRY_FORWARD};
  }

  async function saveInteractionProfile({studentId,courseId,teacherIdentityId,preferences,source='D22_TEACHER_SURFACE'}){
    return withTransaction(async(tx)=>{
      await ensureCourse(studentId,courseId,tx,true);
      const stamp=now();
      await q(tx,`update public.teaching_interaction_preferences set superseded_at=$3,updated_at=$3
        where student_id=$1 and course_id=$2 and superseded_at is null`,[studentId,courseId,stamp]);
      const row=(await q(tx,`insert into public.teaching_interaction_preferences(
        interaction_preference_id,student_id,course_id,teacher_identity_id,preferences,source,effective_at
      ) values($1,$2,$3,$4,$5::jsonb,$6,$7) returning *`,[randomUUID(),studentId,courseId,teacherIdentityId||null,json(preferences),source,stamp])).rows[0];
      await auditUsing(tx,{studentId,action:'teacher_interaction_profile.update',entityType:'COURSE',entityId:courseId,afterRef:{interaction_preference_id:row.interaction_preference_id},safeMetadata:{teacher_identity_mutated:false,academic_truth_mutated:false}});
      return row;
    });
  }

  async function findTeacherChangeRequestByIdempotency(studentId,courseId,idempotencyKey){
    const {rows}=await query(`select * from public.teaching_requests
      where student_id=$1 and course_id=$2 and request_type='TEACHER_CHANGE' and idempotency_key=$3
      order by created_at desc limit 1`,[studentId,courseId,idempotencyKey]);
    return rows?.[0]||null;
  }

  async function requestAndAssignment(studentId,requestId){
    const {rows}=await query(`select r.*,a.teacher_assignment_id,a.teacher_identity_id,a.version_no assignment_version,a.effective_from,a.source_request_id,t.display_name
      from public.teaching_requests r
      left join public.teaching_course_teacher_assignments a on a.student_id=r.student_id and a.source_request_id=r.request_id
      left join public.teaching_teacher_identities t on t.teacher_identity_id=a.teacher_identity_id
      where r.student_id=$1 and r.request_id=$2 order by a.version_no desc nulls last limit 1`,[studentId,requestId]);
    return rows?.[0]||null;
  }

  async function identityById(studentId,teacherIdentityId){
    const {rows}=await query('select * from public.teaching_teacher_identities where student_id=$1 and teacher_identity_id=$2 and active=true',[studentId,teacherIdentityId]);
    const identity=rows?.[0]||null;if(!identity)return null;return {identity,version:await latestIdentityVersion(studentId,teacherIdentityId)};
  }

  return Object.freeze({assertReady,ensureCourse,latestIdentityVersion,latestFamiliarity,currentAssignment,interactionProfile,assignmentHistory,createIdentity,hydrateIdentityIfNeeded,ensureFamiliarity,recordAuthorizedFamiliarity,continuityCandidate,saveInteractionProfile,findTeacherChangeRequestByIdempotency,requestAndAssignment,identityById,auditUsing});
}

module.exports={createD22TeacherIdentityRepository};
