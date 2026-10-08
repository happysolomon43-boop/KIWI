'use strict';

// Read-only candidate discovery for D11's durable Class-runtime repair.
// The published Class reconciliation subscriber remains the sole writer of
// preparation workspaces and Class start/end due events.
function createD11RuntimeRecoveryRepository({query}={}){
  if(typeof query!=='function')throw new TypeError('D11 runtime recovery requires a database reader.');
  async function listMissingCurrentClasses({dayKey,limit=32}={}){
    if(!/^\d{8}$/.test(String(dayKey||'')))throw new TypeError('D11 runtime recovery requires an UTC day key.');
    const batch=Math.max(1,Math.min(64,Math.floor(Number(limit)||32)));
    const {rows=[]}=await query(`
      select c.class_id,c.student_id,c.course_id,c.schedule_version,c.source_timetable_version_id
      from public.teaching_classes c
      join public.teaching_courses co on co.course_id=c.course_id and co.student_id=c.student_id
      join public.teaching_timetable_versions t on t.timetable_version_id=c.source_timetable_version_id
        and t.student_id=c.student_id and t.semester_id=co.semester_id
      where c.lifecycle_state='SCHEDULED'
        and co.lifecycle_state='ACTIVE'
        and t.timetable_state='APPROVED'
        and c.scheduled_start_at>now()
        and not exists (
          select 1 from public.teaching_class_sessions sess
          where sess.student_id=c.student_id and sess.class_id=c.class_id
        )
        and (
          not exists (
            select 1 from teaching_preparation.workspaces w
            where w.student_id=c.student_id and w.target_ref=c.class_id
              and w.workspace_type='LESSON_BLUEPRINT' and w.target_kind='next_class'
              and w.lifecycle_state in ('ACTIVE','FINALIZATION_DUE','FINALIZED','HANDED_OFF')
          )
          or not exists (
            select 1 from teaching_runtime.due_events d
            where d.event_id='d11-class-start:'||c.class_id||':schedule-v'||c.schedule_version::text
          )
          or not exists (
            select 1 from teaching_runtime.due_events d
            where d.event_id='d11-class-end:'||c.class_id||':schedule-v'||c.schedule_version::text
          )
        )
        and not exists (
          select 1 from teaching_runtime.event_outbox e
          where e.event_id='d11-class-runtime-audit:'||c.class_id
            ||':schedule-v'||c.schedule_version::text||':'||$1
        )
      order by c.scheduled_start_at,c.class_id
      limit $2
    `,[dayKey,batch]);
    return rows;
  }
  return Object.freeze({listMissingCurrentClasses});
}
module.exports={createD11RuntimeRecoveryRepository};
