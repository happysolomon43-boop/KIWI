'use strict';

const crypto = require('node:crypto');
const { digest, assertSchedulingContextCurrent } = require('../d09/contracts');

function createD09SchedulingRepository({query,withTransaction,randomUUID,clock=()=>new Date()}={}) {
  if(typeof query!=='function'||typeof withTransaction!=='function'||typeof randomUUID!=='function') throw new TypeError('D09 repository requires query, withTransaction and randomUUID.');
  const q=(runner,sql,params=[])=>runner ? (typeof runner==='function'?runner(sql,params):runner.query(sql,params)) : query(sql,params);
  const json=(v)=>JSON.stringify(v??null);

  async function assertReady(){
    const {rows}=await query(`
      select
        to_regclass('public.teaching_schedule_profiles') profiles,
        to_regclass('public.teaching_availability_windows') availability,
        to_regclass('public.teaching_schedule_blocks') blocks,
        to_regclass('public.teaching_schedule_deadlines') deadlines,
        to_regclass('public.teaching_schedule_reserves') reserves,
        to_regclass('public.teaching_timetable_versions') timetables,
        to_regclass('public.teaching_timetable_slots') slots,
        to_regclass('public.teaching_schedule_feasibility') feasibility,
        to_regclass('public.teaching_schedule_debt_entries') debt
    `);
    if(Object.values(rows?.[0]||{}).some((v)=>v==null)){ const e=new Error('Teaching D09 schema is not ready.'); e.code='TEACHING_D09_SCHEMA_NOT_READY'; throw e; }
    return true;
  }
  async function listSemesters(studentId){
    const {rows=[]}=await query(`select s.*,
      (select count(*)::int from public.teaching_courses c where c.semester_id=s.semester_id and c.student_id=s.student_id) course_count
      from public.teaching_semesters s where s.student_id=$1 order by s.starts_at nulls last,s.created_at`,[studentId]);
    return rows;
  }
  async function ensureCourse(studentId,courseId,runner=null,lock=false){
    const {rows}=await q(runner,`select * from public.teaching_courses where student_id=$1 and course_id=$2 ${lock?'for update':''}`,[studentId,courseId]);
    if(!rows?.[0]){ const e=new Error('Teaching Course not found.'); e.status=404; e.code='TEACHING_COURSE_NOT_FOUND'; throw e; }
    return rows[0];
  }
  async function latestProfile(studentId,semesterId,runner=null){
    const {rows}=await q(runner,`select * from public.teaching_schedule_profiles where student_id=$1 and semester_id=$2 order by version_no desc limit 1`,[studentId,semesterId]);
    return rows?.[0]||null;
  }
  async function profileChildren(studentId,profileId,runner=null){
    const results=await Promise.all([
      q(runner,'select * from public.teaching_availability_windows where student_id=$1 and profile_id=$2 order by day_of_week,local_start',[studentId,profileId]),
      q(runner,'select * from public.teaching_schedule_blocks where student_id=$1 and profile_id=$2 order by starts_at',[studentId,profileId]),
      q(runner,'select * from public.teaching_schedule_deadlines where student_id=$1 and profile_id=$2 order by deadline_at',[studentId,profileId]),
      q(runner,'select * from public.teaching_schedule_reserves where student_id=$1 and profile_id=$2 order by course_id,reserve_kind',[studentId,profileId]),
    ]);
    return {availability:results[0].rows||[],blocks:results[1].rows||[],deadlines:results[2].rows||[],reserves:results[3].rows||[]};
  }
  async function latestPlanBundle(studentId,courseId,runner=null){
    const {rows:plans=[]}=await q(runner,'select * from public.teaching_course_plans where student_id=$1 and course_id=$2 order by version_no desc limit 1',[studentId,courseId]);
    const plan=plans[0]||null;
    if(!plan) return {plan:null,units:[],dependencies:[],coverage:[],scopeChanges:[]};
    const [units,deps,coverage,scope]=await Promise.all([
      q(runner,'select * from public.teaching_learning_units where student_id=$1 and course_plan_id=$2 order by created_at,learning_unit_id',[studentId,plan.course_plan_id]),
      q(runner,`select d.* from public.teaching_learning_unit_dependencies d join public.teaching_learning_units u on u.learning_unit_id=d.learning_unit_id
                  where d.student_id=$1 and u.course_plan_id=$2 order by d.created_at`,[studentId,plan.course_plan_id]),
      q(runner,'select * from public.teaching_course_coverage where student_id=$1 and course_plan_id=$2 order by found_at',[studentId,plan.course_plan_id]),
      q(runner,'select * from public.teaching_course_scope_changes where student_id=$1 and course_id=$2 order by detected_at desc',[studentId,courseId]),
    ]);
    return {plan,units:units.rows||[],dependencies:deps.rows||[],coverage:coverage.rows||[],scopeChanges:scope.rows||[]};
  }
  async function getSchedulingContext(studentId,courseId){
    const course=await ensureCourse(studentId,courseId);
    if(!course.semester_id) return {course,semester:null,profile:null,availability:[],blocks:[],deadlines:[],reserves:[],courses:[],unresolvedCourses:[]};
    const {rows:semesters}=await query('select * from public.teaching_semesters where student_id=$1 and semester_id=$2',[studentId,course.semester_id]);
    const semester=semesters?.[0]||null;
    const profile=await latestProfile(studentId,course.semester_id);
    const children=profile?await profileChildren(studentId,profile.profile_id):{availability:[],blocks:[],deadlines:[],reserves:[]};
    const {rows:siblingRows=[]}=await query('select * from public.teaching_courses where student_id=$1 and semester_id=$2 order by created_at,course_id',[studentId,course.semester_id]);
    const bundles=[], unresolvedCourses=[];
    for(const sibling of siblingRows){
      const bundle=await latestPlanBundle(studentId,sibling.course_id);
      if(!bundle.plan){ unresolvedCourses.push({courseId:sibling.course_id,title:sibling.title,stateVersion:Number(sibling.state_version),reason:'COURSE_PLAN_NOT_READY'}); continue; }
      bundles.push({...bundle,course:sibling,semesterTimezone:semester?.timezone});
    }
    const {rows:historyRows=[]}=await query(`select * from public.teaching_timetable_versions
      where student_id=$1 and semester_id=$2 order by version_no desc limit 1`,[studentId,course.semester_id]);
    const priorTimetable=historyRows[0]||null;
    const {rows:priorSlots=[]}=priorTimetable
      ? await query('select * from public.teaching_timetable_slots where student_id=$1 and timetable_version_id=$2 order by starts_at',[studentId,priorTimetable.timetable_version_id])
      : {rows:[]};
    return {course,semester,profile,...children,courses:bundles,unresolvedCourses,priorTimetable,priorSlots};
  }
  async function getSchedulingContextUsing(runner,studentId,courseId){
    const course=await ensureCourse(studentId,courseId,runner,true);
    if(!course.semester_id) return {course,semester:null,profile:null,availability:[],blocks:[],deadlines:[],reserves:[],courses:[],unresolvedCourses:[]};
    const {rows:semesters}=await q(runner,'select * from public.teaching_semesters where student_id=$1 and semester_id=$2 for update',[studentId,course.semester_id]);
    const semester=semesters?.[0]||null;
    const profile=await latestProfile(studentId,course.semester_id,runner);
    const children=profile?await profileChildren(studentId,profile.profile_id,runner):{availability:[],blocks:[],deadlines:[],reserves:[]};
    const {rows:siblingRows=[]}=await q(runner,'select * from public.teaching_courses where student_id=$1 and semester_id=$2 order by created_at,course_id for update',[studentId,course.semester_id]);
    const bundles=[], unresolvedCourses=[];
    for(const sibling of siblingRows){
      const bundle=await latestPlanBundle(studentId,sibling.course_id,runner);
      if(!bundle.plan){ unresolvedCourses.push({courseId:sibling.course_id,title:sibling.title,stateVersion:Number(sibling.state_version),reason:'COURSE_PLAN_NOT_READY'}); continue; }
      bundles.push({...bundle,course:sibling,semesterTimezone:semester?.timezone});
    }
    const {rows:historyRows=[]}=await q(runner,`select * from public.teaching_timetable_versions
      where student_id=$1 and semester_id=$2 order by version_no desc limit 1 for update`,[studentId,course.semester_id]);
    const priorTimetable=historyRows[0]||null;
    const {rows:priorSlots=[]}=priorTimetable
      ? await q(runner,'select * from public.teaching_timetable_slots where student_id=$1 and timetable_version_id=$2 order by starts_at',[studentId,priorTimetable.timetable_version_id])
      : {rows:[]};
    return {course,semester,profile,...children,courses:bundles,unresolvedCourses,priorTimetable,priorSlots};
  }
  async function assertContextCurrentUsing(tx,{studentId,context}){
    const {rows:semesterRows}=await q(tx,'select * from public.teaching_semesters where student_id=$1 and semester_id=$2 for update',[studentId,context.semester.semester_id]);
    const {rows:profileRows}=await q(tx,`select * from public.teaching_schedule_profiles
      where student_id=$1 and semester_id=$2 order by version_no desc limit 1 for update`,[studentId,context.semester.semester_id]);
    const {rows:courseRows=[]}=await q(tx,`select * from public.teaching_courses
      where student_id=$1 and semester_id=$2 order by created_at,course_id for update`,[studentId,context.semester.semester_id]);
    const current={semester:semesterRows?.[0]||null,profile:profileRows?.[0]||null,courses:[]};
    for(const currentCourse of courseRows){
      const {rows:planRows}=await q(tx,`select * from public.teaching_course_plans
        where student_id=$1 and course_id=$2 order by version_no desc limit 1 for update`,[studentId,currentCourse.course_id]);
      current.courses.push({course:currentCourse,plan:planRows?.[0]||null});
    }
    return assertSchedulingContextCurrent(context,current);
  }
  async function ensurePplBundleUsing(tx,{studentId,semester,profile,dependencies,changedRefs=[]}){
    const {rows:existingRows}=await q(tx,`select * from teaching_preparation.workspaces
      where student_id=$1 and target_kind='multi_course_schedule' and target_ref=$2 and lifecycle_state not in ('SUPERSEDED','CANCELLED')
      order by created_at desc limit 1 for update`,[studentId,semester.semester_id]);
    let workspace=existingRows?.[0]||null;
    const isNew=!workspace;
    if(!workspace){
      const id=randomUUID();
      const {rows}=await q(tx,`insert into teaching_preparation.workspaces(
        workspace_id,student_id,workspace_type,target_kind,target_ref,authoritative_owner_ref,preparation_profile_ref,
        lifecycle_state,maturity_stage,state_version,target_effective_at,protected_content_class,trigger_policy_ref,cost_execution_budget_ref
      ) values($1,$2,'SCHEDULING_HORIZON','multi_course_schedule',$3,'scheduler','teaching.preparation.scheduling_horizon@1.0',
        'ACTIVE','SKELETON',0,$4,'SCHEDULING_INTERNAL','rolling-horizon.material-event.v1','teaching.preparation.review_budget.scheduling_horizon') returning *`,
        [id,studentId,semester.semester_id,semester.ends_at]);
      workspace=rows[0];
    }
    const {rows:vrows}=await q(tx,'select coalesce(max(bundle_version),0)+1 v from teaching_preparation.authoritative_input_bundles where workspace_id=$1',[workspace.workspace_id]);
    const version=Number(vrows[0].v);
    const bundleId=randomUUID();
    const refs=dependencies.map((d)=>d.aggregate_ref);
    const contentDigest=digest({semester:[semester.semester_id,semester.state_version],profile:[profile.profile_id,profile.version_no],dependencies});
    await q(tx,`insert into teaching_preparation.authoritative_input_bundles(
      input_bundle_id,workspace_id,student_id,bundle_version,captured_at,authoritative_refs,preconditions,material_delta_summary,content_digest
    ) values($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9)`,
      [bundleId,workspace.workspace_id,studentId,version,clock(),json(refs),json({semester_state_version:semester.state_version,profile_version:profile.version_no}),json({changed_refs:changedRefs}),contentDigest]);
    for(const dep of dependencies){
      await q(tx,`insert into teaching_preparation.input_bundle_dependencies(
        input_dependency_id,input_bundle_id,student_id,dependency_kind,authoritative_owner_ref,aggregate_ref,version_ref,component_scope_key
      ) values($1,$2,$3,$4,$5,$6,$7,$8)`,
        [randomUUID(),bundleId,studentId,dep.dependency_kind,dep.authoritative_owner_ref,dep.aggregate_ref,dep.version_ref,dep.component_scope_key||null]);
    }
    const {rows:updated}=await q(tx,`update teaching_preparation.workspaces
      set current_authoritative_input_bundle_ref=$2,state_version=state_version+1,updated_at=now()
      where workspace_id=$1 returning *`,[workspace.workspace_id,bundleId]);
    workspace=updated[0];
    return {isNew,workspaceId:workspace.workspace_id,workspaceVersion:Number(workspace.state_version),changedRefs,targetEffectiveAt:semester.ends_at};
  }
  async function auditUsing(tx,{studentId,action,entityType,entityId,stateVersionRef,beforeRef={},afterRef={},reason=null,safeMetadata={}}){
    await q(tx,`insert into public.teaching_academic_audit_log(
      audit_id,student_id,occurred_at,actor_type,actor_id,action,entity_type,entity_id,authoritative_owner,
      state_version_ref,reason,before_ref,after_ref,provenance_refs,safe_metadata
    ) values($1,$2,$3,'SYSTEM',null,$4,$5,$6,'scheduler',$7,$8,$9::jsonb,$10::jsonb,'[]'::jsonb,$11::jsonb)`,
      [randomUUID(),studentId,clock(),action,entityType,entityId,stateVersionRef==null?null:String(stateVersionRef),reason,json(beforeRef),json(afterRef),json(safeMetadata)]);
  }
  async function saveScheduleInputsUsing(tx,{studentId,courseId,input,governedRequestRef=null}){
    const course=await ensureCourse(studentId,courseId,tx,true);
    if(!['DRAFT','READY','PLANNING','SETUP'].includes(String(course.lifecycle_state||'DRAFT')) && !governedRequestRef){
      const e=new Error('Direct Semester/availability edits are pre-activation only; active-course changes require the D10 formal Request workflow.'); e.status=409; e.code='TEACHING_D09_PREACTIVATION_EDIT_ONLY'; throw e;
    }
    let semester=null;
    if(input.semester.semesterId){
      const {rows}=await q(tx,'select * from public.teaching_semesters where semester_id=$1 and student_id=$2 for update',[input.semester.semesterId,studentId]);
      semester=rows?.[0]||null;
      if(!semester){ const e=new Error('Semester not found.'); e.status=404; e.code='TEACHING_D09_SEMESTER_NOT_FOUND'; throw e; }
      const {rows:updated}=await q(tx,`update public.teaching_semesters set name=$3,starts_at=$4,ends_at=$5,timezone=$6,
        state_version=state_version+1,updated_at=now() where semester_id=$1 and student_id=$2 returning *`,
        [semester.semester_id,studentId,input.semester.name,input.semester.startsAt,input.semester.endsAt,input.semester.timezone]);
      semester=updated[0];
    } else if(course.semester_id){
      const {rows}=await q(tx,'select * from public.teaching_semesters where semester_id=$1 and student_id=$2 for update',[course.semester_id,studentId]);
      semester=rows?.[0]||null;
      if(!semester){ const e=new Error('Course Semester no longer exists.'); e.status=409; e.code='TEACHING_D09_SEMESTER_MISSING'; throw e; }
      const {rows:updated}=await q(tx,`update public.teaching_semesters set name=$3,starts_at=$4,ends_at=$5,timezone=$6,
        state_version=state_version+1,updated_at=now() where semester_id=$1 and student_id=$2 returning *`,
        [semester.semester_id,studentId,input.semester.name,input.semester.startsAt,input.semester.endsAt,input.semester.timezone]);
      semester=updated[0];
    } else {
      const id=randomUUID();
      const {rows}=await q(tx,`insert into public.teaching_semesters(semester_id,student_id,name,starts_at,ends_at,timezone,metadata,state_version)
        values($1,$2,$3,$4,$5,$6,'{}'::jsonb,1) returning *`,
        [id,studentId,input.semester.name,input.semester.startsAt,input.semester.endsAt,input.semester.timezone]);
      semester=rows[0];
    }
    if(course.semester_id!==semester.semester_id){
      await q(tx,'update public.teaching_courses set semester_id=$3,state_version=state_version+1,updated_at=now() where course_id=$1 and student_id=$2',[courseId,studentId,semester.semester_id]);
    }
    const referencedCourseIds=[...new Set([...input.blocks.map((x)=>x.courseId).filter(Boolean),...input.deadlines.map((x)=>x.courseId).filter(Boolean),...input.reserves.map((x)=>x.courseId).filter(Boolean)].map(String))];
    for(const refCourseId of referencedCourseIds){const {rows:owned}=await q(tx,'select course_id from public.teaching_courses where student_id=$1 and course_id=$2 and (semester_id=$3 or course_id=$4)',[studentId,refCourseId,semester.semester_id,courseId]);if(!owned?.[0]){const e=new Error('Schedule input references a Course outside this Semester.');e.status=422;e.code='TEACHING_D09_CROSS_SEMESTER_REFERENCE';throw e;}}
    const previous=await latestProfile(studentId,semester.semester_id,tx);
    const priorChildrenFull=previous
      ? await profileChildren(studentId,previous.profile_id,tx)
      : {availability:[],blocks:[],deadlines:[],reserves:[]};
    const {rows:vrows}=await q(tx,'select coalesce(max(version_no),0)+1 v from public.teaching_schedule_profiles where semester_id=$1',[semester.semester_id]);
    const version=Number(vrows[0].v), profileId=randomUUID();
    const settings={horizon:{imminentDays:7,concreteDays:28},operational_policy_ref:'rolling-horizon.operational.v1'};
    const {rows:profiles}=await q(tx,`insert into public.teaching_schedule_profiles(
      profile_id,student_id,semester_id,version_no,semester_state_version,timezone,preferences,settings,headroom_policy_version,supersedes_profile_id,created_by
    ) values($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,'recovery-headroom.v1',$9,$10) returning *`,
      [profileId,studentId,semester.semester_id,version,semester.state_version,semester.timezone,json(input.preferences),json(settings),previous?.profile_id||null,governedRequestRef?'FORMAL_REQUEST':'STUDENT_PREACTIVATION_INPUT']);
    const profile=profiles[0];
    for(const a of input.availability) await q(tx,`insert into public.teaching_availability_windows(
      availability_window_id,student_id,profile_id,day_of_week,local_start,local_end,kind,preference_weight,effective_start_date,effective_end_date,label
    ) values($1,$2,$3,$4,$5::time,$6::time,$7,$8,$9::date,$10::date,$11)`,
      [randomUUID(),studentId,profileId,a.dayOfWeek,a.startLocal,a.endLocal,a.kind,a.preferenceWeight,a.effectiveStartDate,a.effectiveEndDate,a.label]);
    for(const b of input.blocks) await q(tx,`insert into public.teaching_schedule_blocks(
      schedule_block_id,student_id,profile_id,course_id,block_kind,starts_at,ends_at,label,reason
    ) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [randomUUID(),studentId,profileId,b.courseId||b.course_id||null,b.kind||b.block_kind,b.startsAt||b.starts_at,b.endsAt||b.ends_at,b.label||null,b.reason||null]);
    const deadlines=[...priorChildrenFull.deadlines.filter((d)=>String(d.course_id||'')!==String(courseId)),...input.deadlines.map((d)=>({...d,courseId:d.courseId||courseId}))];
    const reserves=[...priorChildrenFull.reserves.filter((r)=>String(r.course_id||'')!==String(courseId)),...input.reserves.map((r)=>({...r,courseId:r.courseId||courseId}))];
    for(const d of deadlines) await q(tx,`insert into public.teaching_schedule_deadlines(
      schedule_deadline_id,student_id,profile_id,course_id,deadline_kind,deadline_at,label
    ) values($1,$2,$3,$4,$5,$6,$7)`,
      [randomUUID(),studentId,profileId,d.courseId||d.course_id,d.kind||d.deadline_kind,d.deadlineAt||d.deadline_at,d.label||null]);
    for(const r of reserves) await q(tx,`insert into public.teaching_schedule_reserves(
      schedule_reserve_id,student_id,profile_id,course_id,reserve_kind,minutes,protected_start_at,protected_end_at
    ) values($1,$2,$3,$4,$5,$6,$7,$8)`,
      [randomUUID(),studentId,profileId,r.courseId||r.course_id,r.kind||r.reserve_kind,Number(r.minutes),r.protectedStartAt||r.protected_start_at||null,r.protectedEndAt||r.protected_end_at||null]);
    const {rowCount:staledTimetableCount=0}=await q(tx,`update public.teaching_timetable_versions
      set timetable_state='STALE'
      where student_id=$1 and semester_id=$2 and timetable_state in ('PROPOSED','EDITED_PROPOSAL','APPROVED')`,
      [studentId,semester.semester_id]);
    const deps=[
      {dependency_kind:'SEMESTER',authoritative_owner_ref:'scheduler',aggregate_ref:'semester:'+semester.semester_id,version_ref:String(semester.state_version)},
      {dependency_kind:'SCHEDULE_PROFILE',authoritative_owner_ref:'scheduler',aggregate_ref:'schedule-profile:'+profileId,version_ref:String(version)},
    ];
    const ppl=await ensurePplBundleUsing(tx,{studentId,semester,profile,dependencies:deps,changedRefs:deps.map((d)=>d.aggregate_ref)});
    await auditUsing(tx,{studentId,action:'scheduler.inputs.commit',entityType:'SEMESTER',entityId:semester.semester_id,stateVersionRef:semester.state_version,
      beforeRef:{profile_id:previous?.profile_id||null},afterRef:{profile_id:profileId,profile_version:version},safeMetadata:{course_id:courseId,staled_timetable_count:Number(staledTimetableCount)||0}});
    return {semester,profile,ppl};
  }
  async function saveProposalUsing(tx,{studentId,courseId,context,result,source='DETERMINISTIC_INITIAL'}){
    await assertContextCurrentUsing(tx,{studentId,context});
    await ensureCourse(studentId,courseId,tx,true);
    const {rows:vrows}=await q(tx,'select coalesce(max(version_no),0)+1 v from public.teaching_timetable_versions where semester_id=$1',[context.semester.semester_id]);
    const version=Number(vrows[0].v), timetableId=randomUUID();
    const {rows:previousRows}=await q(tx,`select * from public.teaching_timetable_versions where student_id=$1 and semester_id=$2 and timetable_state not in ('SUPERSEDED','STALE')
      order by version_no desc limit 1 for update`,[studentId,context.semester.semester_id]);
    const previous=previousRows?.[0]||null;
    if(previous) await q(tx,"update public.teaching_timetable_versions set timetable_state='SUPERSEDED' where timetable_version_id=$1",[previous.timetable_version_id]);
    const state=source==='FORMAL_REQUEST_APPLIED'?'APPROVED':source==='PREACTIVATION_EDIT'?'EDITED_PROPOSAL':'PROPOSED';
    const coursePlanRefs=context.courses.map((b)=>({course_id:b.course.course_id,course_plan_id:b.plan.course_plan_id,version_no:b.plan.version_no,state_version:b.course.state_version}));
    const {rows:tt}=await q(tx,`insert into public.teaching_timetable_versions(
      timetable_version_id,student_id,semester_id,profile_id,version_no,timetable_state,state_digest,source_kind,course_plan_refs,
      supersedes_timetable_version_id,created_by
    ) values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,'scheduler') returning *`,
      [timetableId,studentId,context.semester.semester_id,context.profile.profile_id,version,state,result.stateDigest,source,json(coursePlanRefs),previous?.timetable_version_id||null]);
    const slots=[];
    for(const slot of result.schedule){
      const id=randomUUID();
      const {rows}=await q(tx,`insert into public.teaching_timetable_slots(
        timetable_slot_id,student_id,timetable_version_id,course_id,slot_kind,starts_at,ends_at,timezone,horizon_stage,
        learning_unit_refs,planned_minutes,exception_codes,rationale
      ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13) returning *`,
        [id,studentId,timetableId,slot.courseId,slot.kind,slot.startsAt,slot.endsAt,slot.timezone,slot.horizonStage,json(slot.learningUnitIds),slot.plannedMinutes,json(slot.exceptionCodes||[]),slot.rationale||null]);
      slots.push(rows[0]);
    }
    const feasibilityId=randomUUID();
    const {rows:fs}=await q(tx,`insert into public.teaching_schedule_feasibility(
      feasibility_id,student_id,semester_id,timetable_version_id,profile_id,state_digest,outcome,headroom_policy_version,
      target_headroom_ratio,minimum_headroom_ratio,capacity_metrics,reasons,alternatives,course_summaries,evaluated_at
    ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15) returning *`,
      [feasibilityId,studentId,context.semester.semester_id,timetableId,context.profile.profile_id,result.stateDigest,result.outcome,
       result.policy.headroomPolicyVersion,result.policy.targetHeadroomRatio,result.policy.minimumHeadroomRatio,json(result.metrics),json(result.reasons),json(result.alternatives),json(result.courseSummaries||[]),clock()]);
    const {rows:debtRows}=await q(tx,`select coalesce(sum(delta_minutes),0)::int debt from public.teaching_schedule_debt_entries
      where student_id=$1 and semester_id=$2`,[studentId,context.semester.semester_id]);
    const priorDebt=Math.max(0,Number(debtRows[0]?.debt)||0);
    const nextDebt=Math.max(0,Number(result.metrics.debtMinutes)||0);
    const delta=nextDebt-priorDebt;
    if(delta!==0) await q(tx,`insert into public.teaching_schedule_debt_entries(
      schedule_debt_entry_id,student_id,semester_id,course_id,timetable_version_id,delta_minutes,cause_code,source_ref,recorded_at
    ) values($1,$2,$3,null,$4,$5,$6,$7,$8)`,
      [randomUUID(),studentId,context.semester.semester_id,timetableId,delta,delta>0?'UNSCHEDULED_REQUIRED_LOAD':'SCHEDULE_RECOVERY','feasibility:'+feasibilityId,clock()]);
    const dependencies=[
      {dependency_kind:'SEMESTER',authoritative_owner_ref:'scheduler',aggregate_ref:'semester:'+context.semester.semester_id,version_ref:String(context.semester.state_version)},
      {dependency_kind:'SCHEDULE_PROFILE',authoritative_owner_ref:'scheduler',aggregate_ref:'schedule-profile:'+context.profile.profile_id,version_ref:String(context.profile.version_no)},
      ...coursePlanRefs.map((p)=>({dependency_kind:'COURSE_PLAN',authoritative_owner_ref:'course_scope',aggregate_ref:'course-plan:'+p.course_plan_id,version_ref:String(p.version_no),component_scope_key:p.course_id})),
      {dependency_kind:'TIMETABLE_PROPOSAL',authoritative_owner_ref:'scheduler',aggregate_ref:'timetable:'+timetableId,version_ref:String(version)},
    ];
    const ppl=await ensurePplBundleUsing(tx,{studentId,semester:context.semester,profile:context.profile,dependencies,changedRefs:dependencies.map((d)=>d.aggregate_ref)});
    await auditUsing(tx,{studentId,action:source==='PREACTIVATION_EDIT'?'scheduler.timetable.edit':'scheduler.timetable.propose',
      entityType:'TIMETABLE',entityId:timetableId,stateVersionRef:version,beforeRef:{timetable_version_id:previous?.timetable_version_id||null},
      afterRef:{outcome:result.outcome,slot_count:slots.length,debt_minutes:nextDebt},safeMetadata:{feasibility_id:feasibilityId}});
    return {timetable:tt[0],slots,feasibility:fs[0],ppl};
  }
  async function latestTimetable(studentId,semesterId,runner=null){
    const {rows}=await q(runner,`select * from public.teaching_timetable_versions where student_id=$1 and semester_id=$2 and timetable_state not in ('SUPERSEDED','STALE')
      order by version_no desc limit 1`,[studentId,semesterId]);
    const timetable=rows?.[0]||null;
    if(!timetable) return {timetable:null,slots:[],feasibility:null};
    const [slots,fs]=await Promise.all([
      q(runner,'select * from public.teaching_timetable_slots where student_id=$1 and timetable_version_id=$2 order by starts_at',[studentId,timetable.timetable_version_id]),
      q(runner,'select * from public.teaching_schedule_feasibility where student_id=$1 and timetable_version_id=$2 order by evaluated_at desc limit 1',[studentId,timetable.timetable_version_id]),
    ]);
    return {timetable,slots:slots.rows||[],feasibility:fs.rows?.[0]||null};
  }
  async function getScheduleReview(studentId,courseId){
    const context=await getSchedulingContext(studentId,courseId);
    const latest=context.semester?await latestTimetable(studentId,context.semester.semester_id):{timetable:null,slots:[],feasibility:null};
    const {rows:debt}=context.semester?await query(`select coalesce(sum(delta_minutes),0)::int debt_minutes from public.teaching_schedule_debt_entries
      where student_id=$1 and semester_id=$2`,[studentId,context.semester.semester_id]):{rows:[{debt_minutes:0}]};
    const refs=latest.timetable?.course_plan_refs||[];
    const currentByCourse=new Map((context.courses||[]).map((bundle)=>[String(bundle.course.course_id),bundle]));
    const staleSchedule=Boolean(latest.timetable) && (
      String(latest.timetable.profile_id)!==String(context.profile?.profile_id||'')
      || refs.length!==(context.courses||[]).length
      || refs.some((ref)=>{
        const bundle=currentByCourse.get(String(ref.course_id));
        return !bundle
          || String(ref.course_plan_id)!==String(bundle.plan.course_plan_id)
          || Number(ref.version_no)!==Number(bundle.plan.version_no)
          || Number(ref.state_version)!==Number(bundle.course.state_version);
      })
    );
    return {...context,...latest,staleSchedule,debtMinutes:Math.max(0,Number(debt?.[0]?.debt_minutes)||0)};
  }
  async function listCalendar(studentId,{from,to}={}){
    const params=[studentId], filters=[];
    if(from){params.push(from);filters.push('scheduled_end_at >= $'+params.length);}
    if(to){params.push(to);filters.push('scheduled_start_at <= $'+params.length);}
    const classRows=await query(`select c.*,co.title course_title from public.teaching_classes c join public.teaching_courses co on co.course_id=c.course_id
      where c.student_id=$1 ${filters.length?'and '+filters.join(' and '):''} order by c.scheduled_start_at`,params);
    const proposalParams=[studentId], proposalFilters=[];
    if(from){proposalParams.push(from);proposalFilters.push('s.ends_at >= $'+proposalParams.length);}
    if(to){proposalParams.push(to);proposalFilters.push('s.starts_at <= $'+proposalParams.length);}
    const proposals=await query(`select s.*,co.title course_title,t.timetable_state,t.version_no timetable_version_no
      from public.teaching_timetable_slots s join public.teaching_timetable_versions t on t.timetable_version_id=s.timetable_version_id
      join public.teaching_courses co on co.course_id=s.course_id
      where s.student_id=$1 and t.timetable_state not in ('SUPERSEDED','STALE') ${proposalFilters.length?'and '+proposalFilters.join(' and '):''}
      order by s.starts_at`,proposalParams);
    return {classes:classRows.rows||[],proposals:proposals.rows||[]};
  }

  async function approveTimetableUsing(tx,{studentId,timetableVersionId}){
    const {rows}=await q(tx,`select * from public.teaching_timetable_versions where student_id=$1 and timetable_version_id=$2 for update`,[studentId,timetableVersionId]);
    const timetable=rows?.[0]||null;
    if(!timetable){ const e=new Error('Timetable version not found.'); e.status=404; e.code='TEACHING_D09_TIMETABLE_NOT_FOUND'; throw e; }
    if(['SUPERSEDED','STALE'].includes(timetable.timetable_state)){ const e=new Error('A stale/superseded timetable cannot be activated.'); e.status=409; e.code='TEACHING_D09_TIMETABLE_STALE'; throw e; }
    if(timetable.timetable_state!=='APPROVED'){
      const {rows:updated}=await q(tx,`update public.teaching_timetable_versions set timetable_state='APPROVED'
        where student_id=$1 and timetable_version_id=$2 returning *`,[studentId,timetableVersionId]);
      return updated[0];
    }
    return timetable;
  }
  async function markCurrentTimetableStaleUsing(tx,{studentId,semesterId}){
    const {rowCount=0}=await q(tx,`update public.teaching_timetable_versions set timetable_state='STALE'
      where student_id=$1 and semester_id=$2 and timetable_state in ('PROPOSED','EDITED_PROPOSAL','APPROVED')`,[studentId,semesterId]);
    return Number(rowCount)||0;
  }
  async function suspendCourseClassesUsing(tx,{studentId,courseId,requestId=null}){
    const {rowCount=0}=await q(tx,`update public.teaching_classes set lifecycle_state='CANCELLED',source_request_id=coalesce($3,source_request_id),updated_at=now()
      where student_id=$1 and course_id=$2 and lifecycle_state='SCHEDULED' and scheduled_start_at>=now()`,
      [studentId,courseId,requestId]);
    return Number(rowCount)||0;
  }
  async function materializeApprovedTimetableUsing(tx,{studentId,semesterId,timetable,slots,activationId=null,requestId=null}){
    const at=clock();
    await q(tx,`update public.teaching_classes set lifecycle_state='CANCELLED',updated_at=now()
      where student_id=$1 and lifecycle_state='SCHEDULED' and scheduled_start_at>=$2
        and course_id in (select course_id from public.teaching_courses where student_id=$1 and semester_id=$3)
        and (source_timetable_version_id is null or source_timetable_version_id<>$4)`,
      [studentId,at,semesterId,timetable.timetable_version_id]);
    const classes=[];
    for(const slot of (slots||[]).filter((s)=>String(s.slot_kind||s.kind)==='CLASS')){
      const {rows:existing}=await q(tx,`select * from public.teaching_classes where student_id=$1 and source_timetable_slot_id=$2 for update`,
        [studentId,slot.timetable_slot_id]);
      if(existing?.[0]){ classes.push(existing[0]); continue; }
      const id=randomUUID();
      const {rows}=await q(tx,`insert into public.teaching_classes(
        class_id,student_id,course_id,scheduled_start_at,scheduled_end_at,timezone,lifecycle_state,schedule_version,
        source_timetable_version_id,source_timetable_slot_id,activation_id,source_request_id
      ) values($1,$2,$3,$4,$5,$6,'SCHEDULED',$7,$8,$9,$10,$11) returning *`,
      [id,studentId,slot.course_id,slot.starts_at,slot.ends_at,slot.timezone,Number(timetable.version_no),
       timetable.timetable_version_id,slot.timetable_slot_id,activationId,requestId]);
      classes.push(rows[0]);
    }
    return classes;
  }
  return Object.freeze({
    assertReady,listSemesters,getSchedulingContext,getSchedulingContextUsing,assertContextCurrentUsing,saveScheduleInputsUsing,saveProposalUsing,
    latestTimetable,getScheduleReview,listCalendar,approveTimetableUsing,markCurrentTimetableStaleUsing,suspendCourseClassesUsing,materializeApprovedTimetableUsing,
  });
}
module.exports={createD09SchedulingRepository};