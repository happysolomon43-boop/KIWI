'use strict';

// D11's Class start/end events are schedule projections, never attendance
// records. A cancelled/replaced Class must not retain active timers even if it
// never received a PPL workspace. D15 attendance due events are NOT in scope.
function obsoleteClassDueReason({event,klass,course,timetable,liveSession,now=new Date()}={}){
  if(liveSession)return null;
  if(!klass)return 'CLASS_REMOVED';
  if(klass.lifecycle_state!=='SCHEDULED')return 'CLASS_NO_LONGER_SCHEDULED';
  if(!course||course.lifecycle_state!=='ACTIVE')return 'COURSE_NOT_ACTIVE';
  if(!timetable||timetable.timetable_state!=='APPROVED')return 'TIMETABLE_SUPERSEDED';
  if(String(event?.payload?.schedule_version||'')!==String(klass.schedule_version))
    return 'CLASS_SCHEDULE_VERSION_CHANGED';
  if(event?.payload?.timetable_version_id
    &&String(event.payload.timetable_version_id)!==String(klass.source_timetable_version_id))
    return 'TIMETABLE_VERSION_CHANGED';
  if(!Number.isFinite(Date.parse(klass.scheduled_end_at))||Date.parse(klass.scheduled_end_at)<=now.getTime())
    return 'CLASS_WINDOW_EXPIRED';
  return null;
}
function createD11ClassDueCancellation({query,withTransaction,clock=()=>new Date(),logger=console,
  batchSize=64,intervalMs=120000,timers={setInterval,clearInterval,queueMicrotask}}={}){
  if(typeof query!=='function'||typeof withTransaction!=='function')
    throw new TypeError('Class due cancellation requires trusted SQL and transactions.');
  const limit=Math.min(96,Math.max(1,Math.trunc(Number(batchSize)||64)));
  let running=false,timer=null;
  async function candidates(){
    const {rows=[]}=await query(`
      select e.event_id
      from teaching_runtime.due_events e
      left join public.teaching_classes c
        on c.class_id=e.payload->>'class_id' and c.student_id=e.actor_id
      left join public.teaching_courses co
        on co.student_id=c.student_id and co.course_id=c.course_id
      left join public.teaching_timetable_versions tv
        on tv.student_id=c.student_id and tv.timetable_version_id=c.source_timetable_version_id
      where e.event_type in ('teaching.class.start_due','teaching.class.end_due')
        and e.status in ('PENDING','RETRY_WAIT')
        and not exists (
          select 1 from public.teaching_class_sessions s
          where s.student_id=e.actor_id and s.class_id=e.payload->>'class_id'
            and s.lifecycle_state<>'CLOSED'
        )
        and (c.class_id is null or c.lifecycle_state<>'SCHEDULED'
          or co.course_id is null or co.lifecycle_state<>'ACTIVE'
          or tv.timetable_version_id is null or tv.timetable_state<>'APPROVED'
          or e.payload->>'schedule_version' is distinct from c.schedule_version::text
          or (e.payload ? 'timetable_version_id'
             and e.payload->>'timetable_version_id' is distinct from c.source_timetable_version_id)
          or c.scheduled_end_at<=now())
      order by e.due_at,e.event_id limit $1
    `,[limit]);
    return rows;
  }
  async function retireOne(eventId){
    return withTransaction(async(tx)=>{
      // Hold Class/owner authority and the event claim in one transaction.
      const preliminary=(await tx.query(
        'select actor_id,payload from teaching_runtime.due_events where event_id=$1',[eventId]
      )).rows?.[0];
      if(!preliminary)return {retired:false,reason:'EVENT_MISSING'};
      const id=preliminary.payload?.class_id;
      if(!id)return {retired:false,reason:'CLASS_REFERENCE_MISSING'};
      const klass=(await tx.query(
        'select * from public.teaching_classes where student_id=$1 and class_id=$2 for share',
        [preliminary.actor_id,id])).rows?.[0]||null;
      const course=klass?(await tx.query(
        'select * from public.teaching_courses where student_id=$1 and course_id=$2 for share',
        [preliminary.actor_id,klass.course_id])).rows?.[0]||null:null;
      const timetable=klass?.source_timetable_version_id?(await tx.query(
        'select * from public.teaching_timetable_versions where student_id=$1 and timetable_version_id=$2 for share',
        [preliminary.actor_id,klass.source_timetable_version_id])).rows?.[0]||null:null;
      const event=(await tx.query(
        'select * from teaching_runtime.due_events where event_id=$1 for update',[eventId]
      )).rows?.[0];
      if(!event||!['PENDING','RETRY_WAIT'].includes(event.status)
        ||!['teaching.class.start_due','teaching.class.end_due'].includes(event.event_type)
        ||String(event.actor_id)!==String(preliminary.actor_id)
        ||String(event.payload?.class_id)!==String(id))
        return {retired:false,reason:'EVENT_NO_LONGER_PENDING'};
      const live=(await tx.query(
        "select 1 from public.teaching_class_sessions where student_id=$1 and class_id=$2 and lifecycle_state<>'CLOSED' limit 1",
        [event.actor_id,id])).rows?.length>0;
      const reason=obsoleteClassDueReason({event,klass,course,timetable,liveSession:live,now:clock()});
      if(!reason)return {retired:false,reason:'CLASS_TIMER_STILL_CURRENT'};
      const done=await tx.query(`
        update teaching_runtime.due_events set status='SUPERSEDED',
          resolution='SUPERSEDED',recovery_reason=$2,last_error_code=null,
          claim_token=null,claimed_by=null,claimed_at=null,claim_expires_at=null,
          updated_at=now()
        where event_id=$1 and status in ('PENDING','RETRY_WAIT')
        returning event_id
      `,[eventId,reason]);
      return {retired:done.rows?.length===1,reason};
    });
  }
  async function runOnce(){
    if(running)return {skipped:true,reason:'CLASS_DUE_SWEEP_RUNNING'};
    running=true;
    try{
      const rows=await candidates();let retired=0,failed=0;
      for(const row of rows){
        try{if((await retireOne(row.event_id)).retired)retired++;}
        catch(err){failed++;logger.error?.('[KIWI Teaching D11] Timer cancellation failed:',err?.code||'D11_TIMER_RETIRE_FAILED');}
      }
      if(rows.length||failed)logger.info?.('[KIWI Teaching D11] Obsolete Class timers:',{candidates:rows.length,retired,failed});
      return {candidates:rows.length,retired,failed};
    }finally{running=false;}
  }
  function start(){
    if(timer)return false;
    const scan=()=>void runOnce().catch(err=>logger.error?.(
      '[KIWI Teaching D11] Timer cancellation scan failed:',err?.code||'D11_TIMER_SCAN_FAILED'));
    timer=timers.setInterval(scan,Math.max(60000,Number(intervalMs)||120000));
    timer?.unref?.();timers.queueMicrotask(scan);return true;
  }
  function stop(){if(!timer)return false;timers.clearInterval(timer);timer=null;return true;}
  return Object.freeze({runOnce,retireOne,start,stop});
}
module.exports={obsoleteClassDueReason,createD11ClassDueCancellation};
