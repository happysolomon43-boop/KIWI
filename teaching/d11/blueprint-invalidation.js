'use strict';

// A published D11 Blueprint is only usable against its original authoritative
// Course, Course Plan, Class and timetable versions. Keep completed lesson
// history intact: a Class that ever had a session owns a historical Blueprint
// and is NEVER rewritten by this pre-Class reconciler.
function staleBlueprintReason({blueprint,klass,course,plan,timetable,sessionExists}={}){
  if(sessionExists)return null;
  if(!blueprint || blueprint.blueprint_state!=='VALIDATED')return null;
  if(!klass || klass.lifecycle_state!=='SCHEDULED')return 'CLASS_NO_LONGER_PREPARABLE';
  if(!course || course.lifecycle_state!=='ACTIVE')return 'COURSE_NO_LONGER_ACTIVE';
  if(!timetable || timetable.timetable_state!=='APPROVED')return 'TIMETABLE_SUPERSEDED';
  if(!plan || String(blueprint.course_plan_id)!==String(plan.course_plan_id)
    || String(blueprint.source_course_plan_version)!==String(plan.version_no))return 'COURSE_PLAN_SUPERSEDED';
  if(String(blueprint.source_course_state_version)!==String(course.state_version))return 'COURSE_VERSION_CHANGED';
  if(String(blueprint.source_class_schedule_version)!==String(klass.schedule_version))return 'CLASS_SCHEDULE_CHANGED';
  if(String(blueprint.source_timetable_version_id||'')!==String(klass.source_timetable_version_id||''))
    return 'CLASS_TIMETABLE_CHANGED';
  return null;
}
function createD11BlueprintInvalidation({query,withTransaction,randomUUID,
  logger=console,batchSize=32,intervalMs=120000,timers={setInterval,clearInterval,queueMicrotask}}={}){
  if(typeof query!=='function'||typeof withTransaction!=='function'||typeof randomUUID!=='function')
    throw new TypeError('D11 Blueprint invalidation requires trusted PostgreSQL dependencies.');
  let running=false,timer=null;
  async function candidates(){
    const {rows=[]}=await query(`
      select b.lesson_blueprint_id
      from public.teaching_lesson_blueprints b
      left join public.teaching_classes c on c.student_id=b.student_id and c.class_id=b.class_id
      left join public.teaching_courses co on co.student_id=c.student_id and co.course_id=c.course_id
      left join public.teaching_timetable_versions tv
        on tv.student_id=c.student_id and tv.timetable_version_id=c.source_timetable_version_id
      left join lateral (
        select p.course_plan_id,p.version_no from public.teaching_course_plans p
        where p.student_id=b.student_id and p.course_id=c.course_id and p.plan_state<>'SUPERSEDED'
        order by p.version_no desc limit 1
      ) cp on true
      where b.blueprint_state='VALIDATED'
        and not exists(select 1 from public.teaching_class_sessions s
          where s.student_id=b.student_id and s.class_id=b.class_id)
        and (c.class_id is null or c.lifecycle_state<>'SCHEDULED'
          or co.course_id is null or co.lifecycle_state<>'ACTIVE'
          or tv.timetable_version_id is null or tv.timetable_state<>'APPROVED'
          or cp.course_plan_id is null or b.course_plan_id is distinct from cp.course_plan_id
          or b.source_course_plan_version is distinct from cp.version_no
          or b.source_course_state_version is distinct from co.state_version
          or b.source_class_schedule_version is distinct from c.schedule_version
          or b.source_timetable_version_id is distinct from c.source_timetable_version_id)
      order by b.created_at,b.lesson_blueprint_id limit $1
    `,[Math.max(1,Math.min(64,Math.floor(Number(batchSize)||32)))]);
    return rows;
  }
  async function retireOne(blueprintId){
    return withTransaction(async(tx)=>{
      const initial=(await tx.query(
        'select class_id,student_id from public.teaching_lesson_blueprints where lesson_blueprint_id=$1',
        [blueprintId])).rows?.[0];
      if(!initial)return {retired:false,reason:'BLUEPRINT_MISSING'};
      const klass=(await tx.query(
        'select * from public.teaching_classes where class_id=$1 and student_id=$2 for share',
        [initial.class_id,initial.student_id])).rows?.[0]||null;
      const course=klass?(await tx.query(
        'select * from public.teaching_courses where student_id=$1 and course_id=$2 for share',
        [initial.student_id,klass.course_id])).rows?.[0]||null:null;
      const timetable=klass?.source_timetable_version_id?(await tx.query(
        'select * from public.teaching_timetable_versions where student_id=$1 and timetable_version_id=$2 for share',
        [initial.student_id,klass.source_timetable_version_id])).rows?.[0]||null:null;
      const plan=course?(await tx.query(
        "select * from public.teaching_course_plans where student_id=$1 and course_id=$2 and plan_state<>'SUPERSEDED' order by version_no desc limit 1 for share",
        [initial.student_id,course.course_id])).rows?.[0]||null:null;
      const blueprint=(await tx.query(
        'select * from public.teaching_lesson_blueprints where lesson_blueprint_id=$1 for update',
        [blueprintId])).rows?.[0];
      if(!blueprint || blueprint.student_id!==initial.student_id||blueprint.class_id!==initial.class_id
        ||blueprint.blueprint_state!=='VALIDATED')return {retired:false,reason:'BLUEPRINT_CHANGED'};
      const sessions=(await tx.query(
        'select 1 from public.teaching_class_sessions where student_id=$1 and class_id=$2 limit 1',
        [blueprint.student_id,blueprint.class_id])).rows?.length>0;
      const reason=staleBlueprintReason({blueprint,klass,course,plan,timetable,sessionExists:sessions});
      if(!reason)return {retired:false,reason:'ACADEMIC_BLUEPRINT_CURRENT_OR_HISTORICAL'};
      const updated=await tx.query(`
        update public.teaching_lesson_blueprints set blueprint_state='SUPERSEDED'
        where lesson_blueprint_id=$1 and blueprint_state='VALIDATED'
        returning lesson_blueprint_id
      `,[blueprintId]);
      if(!updated.rows?.length)return {retired:false,reason:'BLUEPRINT_VERSION_RACE'};
      await tx.query(`
        insert into public.teaching_academic_audit_log(
          audit_id,student_id,occurred_at,actor_type,actor_id,action,entity_type,entity_id,
          authoritative_owner,state_version_ref,correlation_id,causation_id,reason,before_ref,after_ref,
          provenance_refs,safe_metadata
        ) values ($1,$2,now(),'SYSTEM',null,'lesson_blueprint.parent_reconciled',
          'LESSON_BLUEPRINT',$3,'Teaching Controller / Lesson Planner',$4,
          null,null,$5,$6::jsonb,$7::jsonb,'[]'::jsonb,'{}'::jsonb)
      `,[randomUUID(),blueprint.student_id,blueprint.lesson_blueprint_id,
        String(blueprint.version_no),reason,
        JSON.stringify({blueprint_state:'VALIDATED'}),
        JSON.stringify({blueprint_state:'SUPERSEDED'})]);
      return {retired:true,reason};
    });
  }
  async function runOnce(){
    if(running)return {skipped:true,reason:'BLUEPRINT_INVALIDATION_ALREADY_RUNNING'};
    running=true;
    try{
      const rows=await candidates();let retired=0,failed=0;
      for(const row of rows){
        try{if((await retireOne(row.lesson_blueprint_id)).retired)retired++;}
        catch(err){failed++;logger.error?.('[KIWI Teaching D11] Blueprint parent invalidation failed:',err?.code||'D11_BLUEPRINT_INVALIDATION_FAILED');}
      }
      if(rows.length||failed)logger.info?.('[KIWI Teaching D11] Blueprint parent reconciliation:',{candidates:rows.length,retired,failed});
      return {candidates:rows.length,retired,failed};
    }finally{running=false;}
  }
  function start(){
    if(timer)return false;
    const scan=()=>void runOnce().catch(err=>logger.error?.(
      '[KIWI Teaching D11] Blueprint sweep failed:',err?.code||'D11_BLUEPRINT_SCAN_FAILED'));
    timer=timers.setInterval(scan,Math.max(60000,Number(intervalMs)||120000));
    timer?.unref?.();timers.queueMicrotask(scan);return true;
  }
  function stop(){if(!timer)return false;timers.clearInterval(timer);timer=null;return true;}
  return Object.freeze({runOnce,retireOne,start,stop});
}
module.exports={staleBlueprintReason,createD11BlueprintInvalidation};
