'use strict';

const {evaluateWorkspaceTransition}=require('../preparation/t0-handlers');

// A cancellation is the loss of CURRENT academic authority, not deletion of
// academic evidence. Version-bound work belonging to replaced Course Plans
// (including removed Topics/Learning Units) must also be retired.
function obsoletePreparationReason({klass,course,timetable,plan,bundle,liveSession,now=new Date()}={}){
  if(liveSession)return null; // Never dismantle an actual ongoing lesson.
  if(!klass)return 'CLASS_REMOVED';
  if(klass.lifecycle_state==='CANCELLED')return 'CLASS_CANCELLED';
  if(klass.lifecycle_state!=='SCHEDULED')return 'CLASS_NOT_SCHEDULED';
  if(!course || course.lifecycle_state!=='ACTIVE')return 'COURSE_NOT_ACTIVE';
  if(!timetable || timetable.timetable_state!=='APPROVED')return 'TIMETABLE_SUPERSEDED';
  if(!plan)return 'COURSE_PLAN_REMOVED';
  const pre=bundle?.preconditions;
  if(!pre || typeof pre!=='object')return 'INPUT_BUNDLE_MISSING';
  if(String(pre.course_plan_id||'')!==String(plan.course_plan_id))return 'COURSE_PLAN_SUPERSEDED';
  if(String(pre.course_plan_version)!==String(plan.version_no))return 'COURSE_PLAN_VERSION_CHANGED';
  if(String(pre.course_state_version)!==String(course.state_version))return 'COURSE_VERSION_CHANGED';
  if(String(pre.class_schedule_version)!==String(klass.schedule_version))return 'CLASS_SCHEDULE_CHANGED';
  if(String(pre.timetable_version_id||'')!==String(klass.source_timetable_version_id||''))return 'CLASS_TIMETABLE_CHANGED';
  if(!Number.isFinite(Date.parse(klass.scheduled_end_at))||Date.parse(klass.scheduled_end_at)<=now.getTime())return 'CLASS_PREPARATION_WINDOW_CLOSED';
  return null;
}

function createD11PreparationCancellation({query,withTransaction,randomUUID,clock=()=>new Date(),logger=console,
  batchSize=32,intervalMs=120000,timers={setInterval,clearInterval,queueMicrotask}}={}){
  if(typeof query!=='function'||typeof withTransaction!=='function'||typeof randomUUID!=='function')
    throw new TypeError('D11 cancellation requires authoritative PostgreSQL transactions.');
  let running=false,timer=null;
  const batch=Math.max(1,Math.min(64,Math.trunc(Number(batchSize)||32)));

  async function candidates(){
    // This scans only PPL Class planning. Assessment, Homework, attendance and
    // already handed-off artifacts retain their respective academic owners.
    const {rows=[]}=await query(`
      select w.workspace_id
      from teaching_preparation.workspaces w
      left join public.teaching_classes c on c.class_id=w.target_ref and c.student_id=w.student_id
      left join public.teaching_courses co on co.course_id=c.course_id and co.student_id=c.student_id
      left join public.teaching_timetable_versions tv on tv.timetable_version_id=c.source_timetable_version_id
      left join teaching_preparation.authoritative_input_bundles b
        on b.input_bundle_id=w.current_authoritative_input_bundle_ref
      left join lateral (
        select p.course_plan_id,p.version_no from public.teaching_course_plans p
        where p.student_id=c.student_id and p.course_id=c.course_id and p.plan_state<>'SUPERSEDED'
        order by p.version_no desc limit 1
      ) cp on true
      where w.workspace_type='LESSON_BLUEPRINT' and w.target_kind='next_class'
        and w.lifecycle_state in ('ACTIVE','FINALIZATION_DUE','FINALIZED')
        and not exists (
          select 1 from public.teaching_class_sessions s
          where s.student_id=w.student_id and s.class_id=w.target_ref and s.lifecycle_state<>'CLOSED'
        )
        and (
          c.class_id is null or c.lifecycle_state<>'SCHEDULED'
          or co.course_id is null or co.lifecycle_state<>'ACTIVE'
          or tv.timetable_version_id is null or tv.timetable_state<>'APPROVED'
          or cp.course_plan_id is null or b.input_bundle_id is null
          or b.preconditions->>'course_plan_id' is distinct from cp.course_plan_id
          or b.preconditions->>'course_plan_version' is distinct from cp.version_no::text
          or b.preconditions->>'course_state_version' is distinct from co.state_version::text
          or b.preconditions->>'class_schedule_version' is distinct from c.schedule_version::text
          or b.preconditions->>'timetable_version_id' is distinct from c.source_timetable_version_id
          or c.scheduled_end_at<=now()
        )
      order by w.created_at,w.workspace_id
      limit $1
    `,[batch]);
    return rows;
  }

  async function retireOne(workspaceId){
    return withTransaction(async(tx)=>{
      // Match the scheduler's authority lock order: parent Class/Course first,
      // workspace last. A cancellation racing model publication must not win
      // a stale snapshot of the parent state.
      const initial=(await tx.query(
        "select student_id,target_ref from teaching_preparation.workspaces where workspace_id=$1",
        [workspaceId])).rows?.[0];
      if(!initial)return {retired:false,reason:'WORKSPACE_MISSING'};
      const klass=(await tx.query(
        'select * from public.teaching_classes where student_id=$1 and class_id=$2 for share',
        [initial.student_id,initial.target_ref])).rows?.[0]||null;
      const course=klass?(await tx.query(
        'select * from public.teaching_courses where student_id=$1 and course_id=$2 for share',
        [initial.student_id,klass.course_id])).rows?.[0]||null:null;
      const timetable=klass?.source_timetable_version_id?(await tx.query(
        'select * from public.teaching_timetable_versions where student_id=$1 and timetable_version_id=$2 for share',
        [initial.student_id,klass.source_timetable_version_id])).rows?.[0]||null:null;
      const plan=course?(await tx.query(
        "select * from public.teaching_course_plans where student_id=$1 and course_id=$2 and plan_state<>'SUPERSEDED' order by version_no desc limit 1 for share",
        [initial.student_id,course.course_id])).rows?.[0]||null:null;
      const w=(await tx.query(
        'select * from teaching_preparation.workspaces where workspace_id=$1 for update',[workspaceId])).rows?.[0];
      if(!w||!['ACTIVE','FINALIZATION_DUE','FINALIZED'].includes(w.lifecycle_state)
        ||w.workspace_type!=='LESSON_BLUEPRINT'||w.target_kind!=='next_class'
        ||w.student_id!==initial.student_id||w.target_ref!==initial.target_ref)
        return {retired:false,reason:'WORKSPACE_NO_LONGER_ELIGIBLE'};
      const live=(await tx.query(
        "select 1 from public.teaching_class_sessions where student_id=$1 and class_id=$2 and lifecycle_state<>'CLOSED' limit 1",
        [w.student_id,w.target_ref])).rows?.length>0;
      const bundle=w.current_authoritative_input_bundle_ref?(await tx.query(
        'select preconditions from teaching_preparation.authoritative_input_bundles where input_bundle_id=$1 and workspace_id=$2',
        [w.current_authoritative_input_bundle_ref,w.workspace_id])).rows?.[0]:null;
      const reason=obsoletePreparationReason({klass,course,timetable,plan,bundle,liveSession:live,now:clock()});
      if(!reason)return {retired:false,reason:'PARENT_STILL_CURRENT'};
      const decision=evaluateWorkspaceTransition({
        currentLifecycle:w.lifecycle_state,currentMaturity:w.maturity_stage,nextLifecycle:'SUPERSEDED',
      });
      const update=await tx.query(`
        update teaching_preparation.workspaces
        set lifecycle_state=$2,cancellation_reason=$3,state_version=state_version+1,
          next_review_due_at=null,updated_at=now()
        where workspace_id=$1 and state_version=$4 and lifecycle_state=$5 returning *
      `,[workspaceId,decision.nextLifecycle,reason,w.state_version,w.lifecycle_state]);
      if(!update.rows?.length)return {retired:false,reason:'VERSION_RACE'};

      // Keep audit and protected academic artifacts intact. These pending
      // jobs cannot cause any more model spend. CLAIMED jobs are not rewritten:
      // the D11 pre-commit authority fence rejects their late model results.
      const outbox=await tx.query(`
        update teaching_runtime.event_outbox set status='CANCELLED',
          last_error_code='TEACHING_PPL_PARENT_SUPERSEDED',
          next_attempt_at=null,updated_at=now()
        where aggregate_id=$1 and event_type like 'teaching.preparation.%'
          and status in ('PENDING','RETRY_WAIT')
        returning event_id
      `,[workspaceId]);
      const review=await tx.query(`
        update teaching_runtime.due_events set status='SUPERSEDED',
          resolution='WORKSPACE_PARENT_SUPERSEDED',recovery_reason=$2,
          claim_token=null,claimed_by=null,claimed_at=null,claim_expires_at=null,updated_at=now()
        where event_type='teaching.preparation.review_due'
          and payload->>'preparation_workspace_id'=$1
          and status in ('PENDING','RETRY_WAIT') returning event_id
      `,[workspaceId,reason]);
      let classDue=0;
      if(['CLASS_REMOVED','CLASS_CANCELLED','CLASS_NOT_SCHEDULED',
        'COURSE_NOT_ACTIVE','TIMETABLE_SUPERSEDED','CLASS_PREPARATION_WINDOW_CLOSED'
      ].includes(reason)){
        const due=await tx.query(`
          update teaching_runtime.due_events set status='SUPERSEDED',
            resolution='CLASS_PARENT_SUPERSEDED',recovery_reason=$3,
            claim_token=null,claimed_by=null,claimed_at=null,claim_expires_at=null,updated_at=now()
          where payload->>'class_id'=$1
            and event_type in ('teaching.class.start_due','teaching.class.end_due')
            and status in ('PENDING','RETRY_WAIT')
            and (payload->>'schedule_version')=$2
          returning event_id
        `,[w.target_ref,String(bundle?.preconditions?.class_schedule_version||klass?.schedule_version||''),reason]);
        classDue=due.rows?.length||0;
      }
      await tx.query(`
        insert into public.teaching_academic_audit_log(
          audit_id,student_id,occurred_at,actor_type,actor_id,action,entity_type,entity_id,
          authoritative_owner,state_version_ref,correlation_id,causation_id,reason,before_ref,after_ref,
          provenance_refs,safe_metadata
        ) values ($1,$2,now(),'SYSTEM',null,'preparation.workspace.parent_reconciled',
          'PREPARATION_WORKSPACE',$3,'Preparation Runtime',$4,null,null,$5,$6::jsonb,$7::jsonb,
          '[]'::jsonb,$8::jsonb)
      `,[
        randomUUID(),w.student_id,w.workspace_id,String(update.rows[0].state_version),
        reason,JSON.stringify({lifecycle_state:w.lifecycle_state}),
        JSON.stringify({lifecycle_state:'SUPERSEDED'}),
        JSON.stringify({pending_ai_events_cancelled:outbox.rows?.length||0,pending_reviews_superseded:review.rows?.length||0,class_due_superseded:classDue})
      ]);
      return {retired:true,reason,queuedAiCancelled:outbox.rows?.length||0,
        reviewsSuperseded:review.rows?.length||0,classDueSuperseded:classDue};
    });
  }
  async function runOnce(){
    if(running)return {skipped:true,reason:'CANCELLATION_SCAN_RUNNING'};
    running=true;
    try{
      const rows=await candidates();
      let retired=0,failed=0,queuedAiCancelled=0,reviewsSuperseded=0,classDueSuperseded=0;
      for(const r of rows){
        try{
          const v=await retireOne(r.workspace_id);
          if(v.retired){retired++;queuedAiCancelled+=v.queuedAiCancelled;
            reviewsSuperseded+=v.reviewsSuperseded;classDueSuperseded+=v.classDueSuperseded;}
        }catch(err){
          failed++;logger.error?.('[KIWI Teaching D11] Parent retirement failed:',err?.code||'D11_RETIRE_FAILED');
        }
      }
      if(rows.length||failed)logger.info?.('[KIWI Teaching D11] Authority cancellation sweep:',{
        candidates:rows.length,retired,failed,queuedAiCancelled,reviewsSuperseded,classDueSuperseded,
      });
      return {candidates:rows.length,retired,failed,queuedAiCancelled,reviewsSuperseded,classDueSuperseded};
    }finally{running=false;}
  }
  function start(){
    if(timer)return false;
    const run=()=>{void runOnce().catch(err=>logger.error?.(
      '[KIWI Teaching D11] Authority cancellation scan failed:',err?.code||'D11_SCAN_FAILED'))};
    timer=timers.setInterval(run,Math.max(60000,Number(intervalMs)||120000));
    timer?.unref?.();timers.queueMicrotask(run);return true;
  }
  function stop(){if(!timer)return false;timers.clearInterval(timer);timer=null;return true;}
  return Object.freeze({runOnce,start,stop,retireOne});
}
module.exports={obsoletePreparationReason,createD11PreparationCancellation};
