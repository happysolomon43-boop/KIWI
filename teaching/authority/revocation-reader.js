'use strict';

/**
 * D05 immutable, version-scoped cancellation reader. Parent mutations write
 * revocations in their own PostgreSQL transaction (DB triggers), so every
 * KIWI instance sees the same authority result. No in-process state cache.
 */
function createAcademicAuthorityCancellationReader({query}={}) {
  if(typeof query!=='function')throw new TypeError('Authoritative revocation reader requires PostgreSQL query().');

  async function read(envelope,{phase='before_model'}={}) {
    const studentId=String(envelope?.trigger?.actor_id||'').trim();
    const state=envelope?.state_reference||{};
    const pre=envelope?.preconditions||{};
    if(!studentId)return {cancelled:false};
    const claims=[];
    const claim=(kind,ref,version)=>{
      if(ref!=null && String(ref).trim() && version!=null && String(version).trim())
        claims.push([kind,String(ref),String(version)]);
    };
    const aggregate=String(state.aggregate_type||'');
    if(aggregate==='teaching_course')claim('COURSE',state.aggregate_id,state.state_version);
    if(aggregate==='teaching_class_controller'){
      claim('CLASS',state.aggregate_id,pre.class_schedule_version);
      // Resolve the authoritative parent graph on every read instead of
      // trusting arbitrary user-provided links.
      const {rows=[]}=await query(
        'select c.course_id,c.source_timetable_version_id,t.version_no timetable_version from public.teaching_classes c left join public.teaching_timetable_versions t on t.student_id=c.student_id and t.timetable_version_id=c.source_timetable_version_id where c.student_id=$1 and c.class_id=$2',
        [studentId,state.aggregate_id]
      );
      if(!rows[0])return {cancelled:true,reason:'CLASS_PARENT_NOT_FOUND'};
      const parent=rows[0];
      claim('COURSE',parent.course_id,pre.course_state_version);
      claim('TIMETABLE',parent.source_timetable_version_id,parent.timetable_version);
    }
    if(aggregate==='teaching_course_plan')claim('COURSE_PLAN',state.aggregate_id,state.state_version);
    if(aggregate==='teaching_preparation_workspace')claim('PREPARATION_WORKSPACE',state.aggregate_id,state.state_version);
    claim('COURSE_PLAN',pre.course_plan_id,pre.course_plan_version);
    claim('LESSON_BLUEPRINT',pre.lesson_blueprint_id,pre.lesson_blueprint_version);
    // A Course-level planning job may also carry its parent Course version.
    if(aggregate!=='teaching_course')claim('COURSE',pre.course_id,pre.course_state_version);
    if(!claims.length)return {cancelled:false};
    const values=[];
    const tuples=claims.map(([owner,ref,version],i)=>{
      const n=i*3+2;values.push(owner,ref,version);
      return '('+'$'+n+'::text,$'+(n+1)+'::text,$'+(n+2)+'::text)';
    });
    const sql=`select owner_kind,reason_code from teaching_runtime.academic_authority_revocations
      where student_id=$1 and (owner_kind,owner_ref,authority_version) in (${tuples.join(',')})
      order by revoked_at asc limit 1`;
    const {rows=[]}=await query(sql,[studentId,...values]);
    const revoked=rows[0];
    return revoked
      ? {cancelled:true,reason:'CANCELLED_PARENT_SUPERSEDED',ownerKind:revoked.owner_kind,reasonCode:revoked.reason_code,phase}
      : {cancelled:false};
  }
  return Object.freeze({read});
}
module.exports={createAcademicAuthorityCancellationReader};
