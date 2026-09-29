'use strict';

const { assessRequiredDiagnostic, activationCoverageDecision } = require('../d08/contracts');
const {
  ADMISSION_POLICY,DEFAULT_GRADING_POLICY,assertCourseTransition,assertRequestTransition,
  admissionCountsState,requestDefinition,
} = require('../d10/contracts');

function createD10LifecycleRequestRepository({query,withTransaction,randomUUID,clock=()=>new Date()}={}) {
  if(typeof query!=='function'||typeof withTransaction!=='function'||typeof randomUUID!=='function') {
    throw new TypeError('D10 repository requires query, withTransaction and randomUUID.');
  }
  const q=(runner,sql,params=[])=>runner ? (typeof runner==='function'?runner(sql,params):runner.query(sql,params)) : query(sql,params);
  const json=(value)=>JSON.stringify(value??null);
  const now=()=>clock() instanceof Date?clock():new Date(clock());

  function err(message,code,status=409,details=null){const e=new Error(message);e.code=code;e.status=status;if(details)e.details=details;return e;}

  async function assertReady(){
    const {rows}=await query(`
      select
        to_regclass('public.teaching_requests') requests,
        to_regclass('public.teaching_request_history') request_history,
        to_regclass('public.teaching_request_applications') request_applications,
        to_regclass('public.teaching_course_activations') activations,
        to_regclass('public.teaching_course_lifecycle_history') lifecycle_history,
        to_regclass('public.teaching_course_admission_policies') admission_policies,
        to_regclass('public.teaching_grading_policy_versions') grading_policies,
        to_regclass('public.teaching_course_teacher_assignments') teacher_assignments
    `);
    if(Object.values(rows?.[0]||{}).some((v)=>v==null)) throw err('Teaching D10 schema is not ready.','TEACHING_D10_SCHEMA_NOT_READY',503);
    return true;
  }

  async function ensureCourse(studentId,courseId,runner=null,lock=false){
    const {rows}=await q(runner,`select * from public.teaching_courses where student_id=$1 and course_id=$2 ${lock?'for update':''}`,[studentId,courseId]);
    if(!rows?.[0]) throw err('Teaching Course not found.','TEACHING_COURSE_NOT_FOUND',404);
    return rows[0];
  }

  async function auditUsing(tx,{studentId,action,entityType,entityId,stateVersionRef=null,reason=null,beforeRef={},afterRef={},safeMetadata={}}){
    await q(tx,`insert into public.teaching_academic_audit_log(
      audit_id,student_id,occurred_at,actor_type,actor_id,action,entity_type,entity_id,authoritative_owner,
      state_version_ref,reason,before_ref,after_ref,provenance_refs,safe_metadata
    ) values($1,$2,$3,'SYSTEM',null,$4,$5,$6,'course_lifecycle_request',$7,$8,$9::jsonb,$10::jsonb,'[]'::jsonb,$11::jsonb)`,
      [randomUUID(),studentId,now(),action,entityType,entityId,stateVersionRef==null?null:String(stateVersionRef),reason,json(beforeRef),json(afterRef),json(safeMetadata)]);
  }

  async function latestAcademicRules(studentId,courseId,runner=null,lock=false){
    const suffix=lock?' for update':'';
    const [policies,assignments]=await Promise.all([
      q(runner,`select * from public.teaching_grading_policy_versions where student_id=$1 and course_id=$2 order by version_no desc limit 1${suffix}`,[studentId,courseId]),
      q(runner,`select a.*,t.display_name,t.style_envelope_version,t.active teacher_active
          from public.teaching_course_teacher_assignments a
          join public.teaching_teacher_identities t on t.teacher_identity_id=a.teacher_identity_id
         where a.student_id=$1 and a.course_id=$2 and a.effective_to is null
         order by a.version_no desc limit 1${suffix}`,[studentId,courseId]),
    ]);
    return {gradingPolicy:policies.rows?.[0]||null,teacherAssignment:assignments.rows?.[0]||null};
  }

  async function ensureAcademicRulesUsing(tx,{studentId,courseId,teacherIdentityId=null}){
    const course=await ensureCourse(studentId,courseId,tx,true);
    if(!['DRAFT','READY'].includes(course.lifecycle_state)) throw err('Academic rules/teacher setup can be changed only before activation.','TEACHING_D10_PREACTIVATION_RULES_ONLY');

    let {gradingPolicy,teacherAssignment}=await latestAcademicRules(studentId,courseId,tx,true);
    if(!gradingPolicy){
      const policyId=randomUUID();
      const {rows}=await q(tx,`insert into public.teaching_grading_policy_versions(
        grading_policy_id,student_id,course_id,version_no,policy_kind,policy_version_ref,category_weights,rules
      ) values($1,$2,$3,1,$4,$5,$6::jsonb,$7::jsonb) returning *`,
      [policyId,studentId,courseId,DEFAULT_GRADING_POLICY.policyKind,DEFAULT_GRADING_POLICY.policyVersionRef,
       json(DEFAULT_GRADING_POLICY.categoryWeights),json(DEFAULT_GRADING_POLICY.rules)]);
      gradingPolicy=rows[0];
    }

    if(!teacherAssignment){
      let teacher=null;
      if(teacherIdentityId){
        const {rows}=await q(tx,'select * from public.teaching_teacher_identities where student_id=$1 and teacher_identity_id=$2 and active=true for update',[studentId,teacherIdentityId]);
        teacher=rows?.[0]||null;
        if(!teacher) throw err('Selected Teacher Identity is not available.','TEACHING_D10_TEACHER_IDENTITY_NOT_FOUND',404);
      } else {
        const {rows}=await q(tx,'select * from public.teaching_teacher_identities where student_id=$1 and active=true order by created_at limit 1 for update',[studentId]);
        teacher=rows?.[0]||null;
      }
      if(!teacher){
        const id=randomUUID();
        const {rows}=await q(tx,`insert into public.teaching_teacher_identities(
          teacher_identity_id,student_id,display_name,identity_profile,personality_profile,style_envelope_version,active
        ) values($1,$2,'KIWI Teacher',$3::jsonb,$4::jsonb,'d10-deterministic-shell.v1',true) returning *`,
        [id,studentId,json({source:'D10_DETERMINISTIC_DEFAULT',modelGenerated:false}),json({bounded:true,academicAuthority:false})]);
        teacher=rows[0];
      }
      const assignmentId=randomUUID();
      const {rows}=await q(tx,`insert into public.teaching_course_teacher_assignments(
        teacher_assignment_id,student_id,course_id,teacher_identity_id,version_no,effective_from
      ) values($1,$2,$3,$4,1,$5) returning *`,
      [assignmentId,studentId,courseId,teacher.teacher_identity_id,now()]);
      teacherAssignment={...rows[0],display_name:teacher.display_name,style_envelope_version:teacher.style_envelope_version,teacher_active:teacher.active};
    }
    return {course,gradingPolicy,teacherAssignment};
  }

  async function prepareAcademicRules({studentId,courseId,teacherIdentityId=null}){
    return withTransaction(async(tx)=>{
      const result=await ensureAcademicRulesUsing(tx,{studentId,courseId,teacherIdentityId});
      await auditUsing(tx,{studentId,action:'course.academic_rules.prepare',entityType:'COURSE',entityId:courseId,
        stateVersionRef:result.course.state_version,afterRef:{grading_policy_id:result.gradingPolicy.grading_policy_id,teacher_assignment_id:result.teacherAssignment.teacher_assignment_id},
        safeMetadata:{model_generated_teacher:false,gradebook_calculation_owned_by:'D20'}});
      return result;
    });
  }

  async function getAcademicRules(studentId,courseId){
    const course=await ensureCourse(studentId,courseId);
    const rules=await latestAcademicRules(studentId,courseId);
    return {course,...rules};
  }

  async function listTeacherIdentities(studentId){
    const {rows=[]}=await query(`select teacher_identity_id,display_name,style_envelope_version,active,created_at
      from public.teaching_teacher_identities where student_id=$1 and active=true order by created_at,teacher_identity_id`,[studentId]);
    return rows;
  }

  async function currentAdmissionPolicy(runner=null){
    const {rows}=await q(runner,`select * from public.teaching_course_admission_policies where enabled=true and effective_from<=$1 order by effective_from desc,created_at desc limit 1`,[now()]);
    const p=rows?.[0]||null;
    if(!p) throw err('No active Course admission policy is configured.','TEACHING_D10_ADMISSION_POLICY_MISSING',503);
    return p;
  }

  async function countedCourses(studentId,{excludeCourseId=null,runner=null,lock=false}={}){
    const {rows=[]}=await q(runner,`select c.course_id,c.lifecycle_state,
      exists(select 1 from public.teaching_course_closure_records cr
        where cr.student_id=c.student_id and cr.course_id=c.course_id and cr.closure_kind in ('INCOMPLETE_ADMINISTRATIVE_ARCHIVE','CANCELLATION')) incomplete_closed
      from public.teaching_courses c where c.student_id=$1 ${lock?'for update':''}`,[studentId]);
    return rows.filter((row)=>String(row.course_id)!==String(excludeCourseId||'') && admissionCountsState(row.lifecycle_state,{hasIncompleteClosure:Boolean(row.incomplete_closed)}));
  }

  async function admissionSnapshot(studentId,courseId){
    await ensureCourse(studentId,courseId);
    const policy=await currentAdmissionPolicy();
    const counted=await countedCourses(studentId,{excludeCourseId:courseId});
    return {policy,counted,allowed:counted.length<Number(policy.maximum_concurrent_courses)};
  }

  async function recordAdmissionUsing(tx,{studentId,courseId,kind,policy,countBefore,outcome,reason=null,sourceRequestId=null}){
    await q(tx,`insert into public.teaching_course_admission_decisions(
      admission_decision_id,student_id,course_id,decision_kind,policy_version,maximum_concurrent_courses,
      concurrent_count_before,outcome,reason,source_request_id,occurred_at
    ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [randomUUID(),studentId,courseId,kind,policy.policy_version,policy.maximum_concurrent_courses,countBefore,outcome,reason,sourceRequestId,now()]);
  }

  async function activationFacts(studentId,courseId,runner=null,lock=false){
    const course=await ensureCourse(studentId,courseId,runner,lock);
    const suffix=lock?' for update':'';
    const [sem,plans,audits,diagnostics,vpk,scope,timetables,rules]=await Promise.all([
      q(runner,`select * from public.teaching_semesters where student_id=$1 and semester_id=$2${suffix}`,[studentId,course.semester_id]),
      q(runner,`select * from public.teaching_course_plans where student_id=$1 and course_id=$2 order by version_no desc limit 1${suffix}`,[studentId,courseId]),
      q(runner,`select * from public.teaching_coverage_audits where student_id=$1 and course_id=$2 and audit_kind='PRE_ACTIVATION' order by created_at desc limit 1${suffix}`,[studentId,courseId]),
      q(runner,`select * from public.teaching_diagnostic_plans where student_id=$1 and course_id=$2 order by plan_version desc limit 1${suffix}`,[studentId,courseId]),
      q(runner,`select * from public.teaching_validated_prior_knowledge_decisions where student_id=$1 and course_id=$2 order by decided_at desc${suffix}`,[studentId,courseId]),
      q(runner,`select * from public.teaching_course_scope_changes where student_id=$1 and course_id=$2 and status in ('PENDING_PLAN_UPDATE','ADOPTED_PENDING_AUDIT') order by detected_at desc${suffix}`,[studentId,courseId]),
      q(runner,`select * from public.teaching_timetable_versions where student_id=$1 and semester_id=$2 and timetable_state not in ('SUPERSEDED','STALE') order by version_no desc limit 1${suffix}`,[studentId,course.semester_id]),
      latestAcademicRules(studentId,courseId,runner,lock),
    ]);
    const timetable=timetables.rows?.[0]||null;
    let feasibility=null;
    if(timetable){
      const result=await q(runner,`select * from public.teaching_schedule_feasibility where student_id=$1 and timetable_version_id=$2 order by evaluated_at desc limit 1${suffix}`,[studentId,timetable.timetable_version_id]);
      feasibility=result.rows?.[0]||null;
    }
    const policy=await currentAdmissionPolicy(runner);
    const counted=await countedCourses(studentId,{excludeCourseId:courseId,runner,lock});
    const plan=plans.rows?.[0]||null;
    const diagnostic=assessRequiredDiagnostic({diagnosticPlan:diagnostics.rows?.[0]||null,vpkDecisions:vpk.rows||[]});
    const coverage=activationCoverageDecision({preActivationAudit:audits.rows?.[0]||null,diagnosticResolved:diagnostic.resolved});
    const blockers=[];
    if(!course.semester_id||!sem.rows?.[0]) blockers.push('SEMESTER_REQUIRED');
    if(!plan) blockers.push('COURSE_PLAN_REQUIRED');
    if(plan?.plan_state==='REVIEW_REQUIRED'||plan?.plan_state==='SUPERSEDED') blockers.push('COURSE_PLAN_REVIEW_REQUIRED');
    if(plan&&String(plan.source_snapshot_ref||'')!==String(course.subject_snapshot_ref||'')) blockers.push('COURSE_PLAN_SOURCE_SNAPSHOT_STALE');
    if(scope.rows?.length) blockers.push('COURSE_SCOPE_CHANGE_PENDING_REPLAN');
    if(!coverage.allowed) blockers.push(...(coverage.blockers||[]));
    if(!timetable) blockers.push('CURRENT_TIMETABLE_REQUIRED');
    if(timetable && !['PROPOSED','EDITED_PROPOSAL','APPROVED'].includes(timetable.timetable_state)) blockers.push('CURRENT_TIMETABLE_INVALID');
    if(!feasibility) blockers.push('CURRENT_FEASIBILITY_REQUIRED');
    if(feasibility?.outcome==='INFEASIBLE') blockers.push('SCHEDULE_INFEASIBLE');
    if(!rules.gradingPolicy) blockers.push('GRADING_POLICY_REQUIRED');
    if(!rules.teacherAssignment) blockers.push('TEACHER_IDENTITY_REQUIRED');
    if(counted.length>=Number(policy.maximum_concurrent_courses)) blockers.push('CONCURRENT_COURSE_LIMIT');
    return {course,semester:sem.rows?.[0]||null,plan,coverageAudit:audits.rows?.[0]||null,diagnostic,coverage,
      timetable,feasibility,gradingPolicy:rules.gradingPolicy,teacherAssignment:rules.teacherAssignment,
      admission:{policy,counted,allowed:counted.length<Number(policy.maximum_concurrent_courses)},blockers:[...new Set(blockers)]};
  }

  async function getActivationFacts(studentId,courseId){return activationFacts(studentId,courseId);}

  async function lifecycleHistoryUsing(tx,{studentId,courseId,fromState,toState,stateVersion,reason=null,sourceRequestId=null,policyVersion=null}){
    await q(tx,`insert into public.teaching_course_lifecycle_history(
      lifecycle_event_id,student_id,course_id,from_state,to_state,state_version,actor_authority,reason,source_request_id,policy_version,occurred_at
    ) values($1,$2,$3,$4,$5,$6,'course_lifecycle',$7,$8,$9,$10)`,
    [randomUUID(),studentId,courseId,fromState,toState,stateVersion,reason,sourceRequestId,policyVersion,now()]);
  }

  async function transitionCourseUsing(tx,{studentId,courseId,toState,reason=null,sourceRequestId=null,policyVersion=null,expectedVersion=null}){
    const course=await ensureCourse(studentId,courseId,tx,true);
    if(expectedVersion!=null&&Number(course.state_version)!==Number(expectedVersion)) throw err('Course changed before lifecycle transition.','TEACHING_D10_COURSE_STALE',409);
    assertCourseTransition(course.lifecycle_state,toState);
    const {rows}=await q(tx,`update public.teaching_courses set lifecycle_state=$3,state_version=state_version+1,updated_at=now()
      where student_id=$1 and course_id=$2 returning *`,[studentId,courseId,toState]);
    const updated=rows[0];
    await lifecycleHistoryUsing(tx,{studentId,courseId,fromState:course.lifecycle_state,toState,stateVersion:updated.state_version,reason,sourceRequestId,policyVersion});
    await auditUsing(tx,{studentId,action:'course.lifecycle.transition',entityType:'COURSE',entityId:courseId,stateVersionRef:updated.state_version,
      reason,beforeRef:{lifecycle_state:course.lifecycle_state},afterRef:{lifecycle_state:toState},safeMetadata:{source_request_id:sourceRequestId||null}});
    return updated;
  }

  async function markReady({studentId,courseId,expected={}}){
    return withTransaction(async(tx)=>{
      const facts=await activationFacts(studentId,courseId,tx,true);
      if(facts.course.lifecycle_state!=='DRAFT') throw err('Only a Draft Course can become Ready.','TEACHING_D10_READY_STATE_INVALID');
      if(facts.blockers.length) {
        await recordAdmissionUsing(tx,{studentId,courseId,kind:'READY',policy:facts.admission.policy,countBefore:facts.admission.counted.length,outcome:'BLOCK',reason:facts.blockers.join(',')});
        throw err('Course is not ready for activation.','TEACHING_D10_ACTIVATION_BLOCKED',409,{blockers:facts.blockers});
      }
      if(expected.planId&&String(expected.planId)!==String(facts.plan?.course_plan_id)) throw err('Course Plan changed before readiness commit.','TEACHING_D10_ACTIVATION_STALE');
      if(expected.timetableVersionId&&String(expected.timetableVersionId)!==String(facts.timetable?.timetable_version_id)) throw err('Timetable changed before readiness commit.','TEACHING_D10_ACTIVATION_STALE');
      const updated=await transitionCourseUsing(tx,{studentId,courseId,toState:'READY',reason:'Activation prerequisites confirmed',policyVersion:facts.admission.policy.policy_version});
      await recordAdmissionUsing(tx,{studentId,courseId,kind:'READY',policy:facts.admission.policy,countBefore:facts.admission.counted.length,outcome:'ALLOW'});
      return {course:updated,facts};
    });
  }

  async function activateCourseUsing(tx,{studentId,courseId,expected={},activateScheduleUsing}){
    if(typeof activateScheduleUsing!=='function') throw new TypeError('D10 activation requires the D09 Scheduler activation owner callback.');
    const facts=await activationFacts(studentId,courseId,tx,true);
    if(facts.course.lifecycle_state!=='READY') throw err('Course must be Ready before activation.','TEACHING_D10_ACTIVATION_REQUIRES_READY');
    if(facts.blockers.length) {
      await recordAdmissionUsing(tx,{studentId,courseId,kind:'ACTIVATION',policy:facts.admission.policy,countBefore:facts.admission.counted.length,outcome:'BLOCK',reason:facts.blockers.join(',')});
      throw err('Course activation prerequisites are no longer current.','TEACHING_D10_ACTIVATION_BLOCKED',409,{blockers:facts.blockers});
    }
    if(expected.planId&&String(expected.planId)!==String(facts.plan.course_plan_id)) throw err('Course Plan changed before activation.','TEACHING_D10_ACTIVATION_STALE');
    if(expected.timetableVersionId&&String(expected.timetableVersionId)!==String(facts.timetable.timetable_version_id)) throw err('Timetable changed before activation.','TEACHING_D10_ACTIVATION_STALE');
    const activationId=randomUUID();
    const schedule=await activateScheduleUsing(tx,facts,activationId);
    const activatedAt=now();
    await q(tx,'update public.teaching_grading_policy_versions set locked_at=coalesce(locked_at,$3) where student_id=$1 and grading_policy_id=$2',
      [studentId,facts.gradingPolicy.grading_policy_id,activatedAt]);
    const nextVersion=Number(facts.course.state_version)+1;
    await q(tx,`insert into public.teaching_course_activations(
      activation_id,student_id,course_id,semester_id,course_state_version,semester_state_version,
      course_plan_id,course_plan_version,course_plan_source_snapshot_ref,grading_policy_id,grading_policy_version,
      timetable_version_id,timetable_version,teacher_assignment_id,teacher_identity_id,admission_policy_version,
      concurrent_count_before,activated_at
    ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [activationId,studentId,courseId,facts.semester.semester_id,nextVersion,facts.semester.state_version,
     facts.plan.course_plan_id,facts.plan.version_no,facts.plan.source_snapshot_ref,facts.gradingPolicy.grading_policy_id,facts.gradingPolicy.version_no,
     schedule.timetable.timetable_version_id,schedule.timetable.version_no,facts.teacherAssignment.teacher_assignment_id,facts.teacherAssignment.teacher_identity_id,
     facts.admission.policy.policy_version,facts.admission.counted.length,activatedAt]);
    const {rows}=await q(tx,`update public.teaching_courses set lifecycle_state='ACTIVE',state_version=state_version+1,
      activated_at=$3,academic_record_started_at=$3,activation_id=$4,updated_at=now()
      where student_id=$1 and course_id=$2 returning *`,[studentId,courseId,activatedAt,activationId]);
    const updated=rows[0];
    await lifecycleHistoryUsing(tx,{studentId,courseId,fromState:'READY',toState:'ACTIVE',stateVersion:updated.state_version,
      reason:'Start Course activation committed',policyVersion:facts.admission.policy.policy_version});
    await recordAdmissionUsing(tx,{studentId,courseId,kind:'ACTIVATION',policy:facts.admission.policy,countBefore:facts.admission.counted.length,outcome:'ALLOW'});
    await auditUsing(tx,{studentId,action:'course.activate',entityType:'COURSE',entityId:courseId,stateVersionRef:updated.state_version,
      beforeRef:{lifecycle_state:'READY'},afterRef:{lifecycle_state:'ACTIVE',activation_id:activationId},
      safeMetadata:{plan_version:facts.plan.version_no,timetable_version:schedule.timetable.version_no,grading_policy_version:facts.gradingPolicy.version_no,
        admission_policy_version:facts.admission.policy.policy_version}});
    return {course:updated,activationId,schedule,facts,activatedAt};
  }

  async function activateCourse(input){
    return withTransaction((tx)=>activateCourseUsing(tx,input));
  }

  async function archiveIncomplete({studentId,courseId,reason,sourceRequestId=null}){
    if(!String(reason||'').trim()) throw err('Administrative closure requires a reason.','TEACHING_D10_INCOMPLETE_CLOSURE_REASON_REQUIRED',400);
    return withTransaction(async(tx)=>{
      const course=await ensureCourse(studentId,courseId,tx,true);
      if(course.lifecycle_state!=='INCOMPLETE') throw err('Only an unresolved Incomplete Course can use this closure path.','TEACHING_D10_INCOMPLETE_CLOSURE_STATE_INVALID');
      const {rows:existing}=await q(tx,`select * from public.teaching_course_closure_records where student_id=$1 and course_id=$2 and closure_kind='INCOMPLETE_ADMINISTRATIVE_ARCHIVE' order by closed_at desc limit 1`,[studentId,courseId]);
      if(existing?.[0]) return existing[0];
      const closureId=randomUUID();
      const closedAt=now();
      const {rows}=await q(tx,`insert into public.teaching_course_closure_records(
        closure_id,student_id,course_id,lifecycle_state_at_closure,closure_kind,reason,source_request_id,closed_at
      ) values($1,$2,$3,'INCOMPLETE','INCOMPLETE_ADMINISTRATIVE_ARCHIVE',$4,$5,$6) returning *`,
      [closureId,studentId,courseId,String(reason).trim(),sourceRequestId,closedAt]);
      const policy=await currentAdmissionPolicy(tx);
      const counted=await countedCourses(studentId,{excludeCourseId:courseId,runner:tx,lock:true});
      await recordAdmissionUsing(tx,{studentId,courseId,kind:'CLOSURE',policy,countBefore:counted.length+1,outcome:'RELEASE',reason:'Incomplete administratively archived',sourceRequestId});
      await auditUsing(tx,{studentId,action:'course.incomplete.admin_archive',entityType:'COURSE',entityId:courseId,stateVersionRef:course.state_version,
        reason:String(reason).trim(),afterRef:{closure_id:closureId,lifecycle_state_preserved:'INCOMPLETE'}});
      return rows[0];
    });
  }

  async function resolveTargetUsing(tx,{studentId,courseId,definition,requestedChange}){
    let course=null;
    if(courseId) course=await ensureCourse(studentId,courseId,tx,true);
    if(definition.target==='COURSE'){
      if(!course) throw err('Course Request requires courseId.','TEACHING_D10_REQUEST_COURSE_REQUIRED',400);
      return {course,targetRef:course.course_id,targetVersionRef:`course-state:${course.state_version}`};
    }
    if(definition.target==='CLASS'){
      const classId=requestedChange.classId;
      const {rows}=await q(tx,'select * from public.teaching_classes where student_id=$1 and class_id=$2 for update',[studentId,classId]);
      const klass=rows?.[0]||null;
      if(!klass) throw err('Requested Teaching Class not found.','TEACHING_D10_REQUEST_CLASS_NOT_FOUND',404);
      if(course&&String(klass.course_id)!==String(course.course_id)) throw err('Requested Class does not belong to the supplied Course.','TEACHING_D10_REQUEST_TARGET_MISMATCH',422);
      return {course:course||await ensureCourse(studentId,klass.course_id,tx,true),klass,targetRef:klass.class_id,targetVersionRef:`class-schedule:${klass.schedule_version}`};
    }
    return {course,targetRef:requestedChange.assignmentRef,targetVersionRef:requestedChange.assignmentVersion||null};
  }

  async function appendRequestHistoryUsing(tx,{request,fromState,toState,actorType='SYSTEM',actorAuthority='request',reason=null,explanation=null,applicationRef=null,safeMetadata={}}){
    await q(tx,`insert into public.teaching_request_history(
      request_history_id,student_id,request_id,request_version,from_state,to_state,actor_type,actor_authority,
      reason,explanation,target_version_ref,application_ref,safe_metadata,occurred_at
    ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)`,
    [randomUUID(),request.student_id,request.request_id,request.state_version,fromState,toState,actorType,actorAuthority,reason,explanation,
     request.target_version_ref,applicationRef,json(safeMetadata),now()]);
  }

  async function createRequest({studentId,courseId=null,normalized,idempotencyKey=null}){
    return withTransaction(async(tx)=>{
      if(idempotencyKey){
        const {rows}=await q(tx,'select * from public.teaching_requests where student_id=$1 and idempotency_key=$2',[studentId,idempotencyKey]);
        if(rows?.[0]) return rows[0];
      }
      const target=await resolveTargetUsing(tx,{studentId,courseId,definition:normalized.definition,requestedChange:normalized.requestedChange});
      const requestId=randomUUID();
      const {rows}=await q(tx,`insert into public.teaching_requests(
        request_id,student_id,course_id,request_type,requester_type,requester_id,target_owner,target_type,target_ref,target_version_ref,
        lifecycle_state,state_version,requested_change,explanation,effective_at,idempotency_key
      ) values($1,$2,$3,$4,'STUDENT',$2,$5,$6,$7,$8,'DRAFT',1,$9::jsonb,$10,$11,$12) returning *`,
      [requestId,studentId,target.course?.course_id||courseId,normalized.definition.type,normalized.definition.owner,normalized.definition.target,
       target.targetRef,target.targetVersionRef,json(normalized.requestedChange),normalized.explanation,normalized.effectiveAt,idempotencyKey]);
      const request=rows[0];
      await appendRequestHistoryUsing(tx,{request,fromState:null,toState:'DRAFT',actorType:'STUDENT',actorAuthority:'request',reason:'Request created'});
      await auditUsing(tx,{studentId,action:'request.create',entityType:'REQUEST',entityId:requestId,stateVersionRef:1,
        afterRef:{state:'DRAFT',type:request.request_type,target_owner:request.target_owner},safeMetadata:{course_id:request.course_id||null}});
      return request;
    });
  }

  async function getRequest(studentId,requestId){
    const {rows}=await query('select * from public.teaching_requests where student_id=$1 and request_id=$2',[studentId,requestId]);
    if(!rows?.[0]) throw err('Teaching Request not found.','TEACHING_D10_REQUEST_NOT_FOUND',404);
    const history=await query('select * from public.teaching_request_history where student_id=$1 and request_id=$2 order by request_version,occurred_at',[studentId,requestId]);
    return {request:rows[0],history:history.rows||[]};
  }
  async function getRequestById(requestId){
    const {rows}=await query('select * from public.teaching_requests where request_id=$1',[requestId]);
    return rows?.[0]||null;
  }
  async function listRequests(studentId,{courseId=null,state=null}={}){
    const params=[studentId],where=['student_id=$1'];
    if(courseId){params.push(courseId);where.push(`course_id=$${params.length}`);}
    if(state){params.push(state);where.push(`lifecycle_state=$${params.length}`);}
    const {rows=[]}=await query(`select * from public.teaching_requests where ${where.join(' and ')} order by updated_at desc,created_at desc`,params);
    return rows;
  }

  async function transitionRequest({studentId,requestId,toState,reason=null,actorType='STUDENT',actorAuthority='request'}){
    return withTransaction(async(tx)=>{
      const {rows}=await q(tx,'select * from public.teaching_requests where student_id=$1 and request_id=$2 for update',[studentId,requestId]);
      const current=rows?.[0]||null;
      if(!current) throw err('Teaching Request not found.','TEACHING_D10_REQUEST_NOT_FOUND',404);
      assertRequestTransition(current.lifecycle_state,toState);
      const {rows:updatedRows}=await q(tx,`update public.teaching_requests set lifecycle_state=$3,state_version=state_version+1,
        close_reason=case when $3 in ('WITHDRAWN','CLOSED') then coalesce($4,close_reason) else close_reason end,
        closed_at=case when $3='CLOSED' then $5 else closed_at end,updated_at=now()
        where student_id=$1 and request_id=$2 returning *`,[studentId,requestId,toState,reason,now()]);
      const updated=updatedRows[0];
      await appendRequestHistoryUsing(tx,{request:updated,fromState:current.lifecycle_state,toState,actorType,actorAuthority,reason});
      await auditUsing(tx,{studentId,action:'request.transition',entityType:'REQUEST',entityId:requestId,stateVersionRef:updated.state_version,
        reason,beforeRef:{state:current.lifecycle_state},afterRef:{state:toState}});
      return updated;
    });
  }

  async function recordDecisionUsing(tx,{studentId,requestId,decisionState,decision,alternativeProposal=null,reason=null,expectedVersion=null}){
    const {rows}=await q(tx,'select * from public.teaching_requests where student_id=$1 and request_id=$2 for update',[studentId,requestId]);
    const current=rows?.[0]||null;
    if(!current) throw err('Teaching Request not found.','TEACHING_D10_REQUEST_NOT_FOUND',404);
    if(expectedVersion!=null&&Number(current.state_version)!==Number(expectedVersion)) throw err('Request changed before decision commit.','TEACHING_D10_REQUEST_STALE');
    assertRequestTransition(current.lifecycle_state,decisionState);
    const altVersion=alternativeProposal?Number(current.alternative_version||0)+1:current.alternative_version;
    const {rows:updatedRows}=await q(tx,`update public.teaching_requests set lifecycle_state=$3,state_version=state_version+1,decision=$4::jsonb,
      alternative_proposal=$5::jsonb,alternative_version=$6,updated_at=now()
      where student_id=$1 and request_id=$2 returning *`,
    [studentId,requestId,decisionState,json(decision),json(alternativeProposal),altVersion]);
    const updated=updatedRows[0];
    await appendRequestHistoryUsing(tx,{request:updated,fromState:current.lifecycle_state,toState:decisionState,actorType:'SYSTEM',actorAuthority:'request',
      reason,explanation:decision?.explanation||null,safeMetadata:{decision_code:decision?.code||null,alternative_version:altVersion||null}});
    await auditUsing(tx,{studentId,action:'request.decide',entityType:'REQUEST',entityId:requestId,stateVersionRef:updated.state_version,
      reason,beforeRef:{state:current.lifecycle_state},afterRef:{state:decisionState},safeMetadata:{decision_code:decision?.code||null}});
    return updated;
  }

  async function acceptAlternativeUsing(tx,{studentId,requestId,alternativeVersion}){
    const {rows}=await q(tx,'select * from public.teaching_requests where student_id=$1 and request_id=$2 for update',[studentId,requestId]);
    const current=rows?.[0]||null;
    if(!current) throw err('Teaching Request not found.','TEACHING_D10_REQUEST_NOT_FOUND',404);
    if(current.lifecycle_state!=='ALTERNATIVE_PROPOSED') throw err('Request has no active alternative proposal.','TEACHING_D10_ALTERNATIVE_STATE_INVALID');
    if(Number(current.alternative_version)!==Number(alternativeVersion)) throw err('Alternative proposal changed before acceptance.','TEACHING_D10_ALTERNATIVE_STALE');
    assertRequestTransition(current.lifecycle_state,'APPROVED_WITH_ADJUSTMENT');
    const {rows:updatedRows}=await q(tx,`update public.teaching_requests set lifecycle_state='APPROVED_WITH_ADJUSTMENT',
      state_version=state_version+1,student_response='ACCEPTED',responded_at=$3,updated_at=now()
      where student_id=$1 and request_id=$2 returning *`,[studentId,requestId,now()]);
    const updated=updatedRows[0];
    await appendRequestHistoryUsing(tx,{request:updated,fromState:'ALTERNATIVE_PROPOSED',toState:'APPROVED_WITH_ADJUSTMENT',
      actorType:'STUDENT',actorAuthority:'request',reason:'Student accepted referenced alternative',safeMetadata:{alternative_version:Number(alternativeVersion)}});
    return updated;
  }

  async function declineAlternative({studentId,requestId,alternativeVersion}){
    return withTransaction(async(tx)=>{
      const {rows}=await q(tx,'select * from public.teaching_requests where student_id=$1 and request_id=$2 for update',[studentId,requestId]);
      const current=rows?.[0]||null;
      if(!current) throw err('Teaching Request not found.','TEACHING_D10_REQUEST_NOT_FOUND',404);
      if(current.lifecycle_state!=='ALTERNATIVE_PROPOSED'||Number(current.alternative_version)!==Number(alternativeVersion)) throw err('Alternative proposal is stale or unavailable.','TEACHING_D10_ALTERNATIVE_STALE');
      const {rows:updatedRows}=await q(tx,`update public.teaching_requests set lifecycle_state='CLOSED',state_version=state_version+1,
        student_response='DECLINED',responded_at=$3,close_reason='ALTERNATIVE_DECLINED',closed_at=$3,updated_at=now()
        where student_id=$1 and request_id=$2 returning *`,[studentId,requestId,now()]);
      const updated=updatedRows[0];
      await appendRequestHistoryUsing(tx,{request:updated,fromState:'ALTERNATIVE_PROPOSED',toState:'CLOSED',actorType:'STUDENT',actorAuthority:'request',
        reason:'Student declined referenced alternative',safeMetadata:{alternative_version:Number(alternativeVersion),target_mutated:false}});
      await auditUsing(tx,{studentId,action:'request.alternative.decline',entityType:'REQUEST',entityId:requestId,stateVersionRef:updated.state_version,
        afterRef:{state:'CLOSED',target_mutated:false}});
      return updated;
    });
  }

  async function getClassTargetUsing(tx,{studentId,classId}){
    const {rows}=await q(tx,'select * from public.teaching_classes where student_id=$1 and class_id=$2 for update',[studentId,classId]);
    if(!rows?.[0]) throw err('Teaching Class no longer exists.','TEACHING_D10_REQUEST_CLASS_NOT_FOUND',404);
    return rows[0];
  }

  async function getClassTarget(studentId,classId){
    const {rows}=await query('select * from public.teaching_classes where student_id=$1 and class_id=$2',[studentId,classId]);
    if(!rows?.[0]) throw err('Teaching Class not found.','TEACHING_D10_REQUEST_CLASS_NOT_FOUND',404);
    return rows[0];
  }

  async function changeTeacherUsing(tx,{studentId,courseId,teacherIdentityId,sourceRequestId}){
    const course=await ensureCourse(studentId,courseId,tx,true);
    const {rows:teacherRows}=await q(tx,'select * from public.teaching_teacher_identities where student_id=$1 and teacher_identity_id=$2 and active=true for update',[studentId,teacherIdentityId]);
    const teacher=teacherRows?.[0]||null;
    if(!teacher) throw err('Requested Teacher Identity is not available.','TEACHING_D10_TEACHER_IDENTITY_NOT_FOUND',404);
    const {rows:currentRows}=await q(tx,`select * from public.teaching_course_teacher_assignments where student_id=$1 and course_id=$2 and effective_to is null order by version_no desc limit 1 for update`,[studentId,courseId]);
    const current=currentRows?.[0]||null;
    if(current&&String(current.teacher_identity_id)===String(teacherIdentityId)) return {assignment:current,course};
    if(current) await q(tx,'update public.teaching_course_teacher_assignments set effective_to=$3 where student_id=$1 and teacher_assignment_id=$2',[studentId,current.teacher_assignment_id,now()]);
    const {rows:vrows}=await q(tx,'select coalesce(max(version_no),0)+1 v from public.teaching_course_teacher_assignments where student_id=$1 and course_id=$2',[studentId,courseId]);
    const id=randomUUID();
    const {rows}=await q(tx,`insert into public.teaching_course_teacher_assignments(
      teacher_assignment_id,student_id,course_id,teacher_identity_id,version_no,effective_from,source_request_id,supersedes_teacher_assignment_id
    ) values($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
    [id,studentId,courseId,teacherIdentityId,Number(vrows[0].v),now(),sourceRequestId,current?.teacher_assignment_id||null]);
    await auditUsing(tx,{studentId,action:'course.teacher.change',entityType:'COURSE',entityId:courseId,stateVersionRef:course.state_version,
      beforeRef:{teacher_assignment_id:current?.teacher_assignment_id||null},afterRef:{teacher_assignment_id:id},safeMetadata:{source_request_id:sourceRequestId}});
    return {assignment:rows[0],course};
  }

  async function recordCancellationClosureUsing(tx,{studentId,courseId,reason,sourceRequestId}){
    const course=await ensureCourse(studentId,courseId,tx,true);
    if(course.lifecycle_state!=='INCOMPLETE') throw err('Cancellation closure requires preserved Incomplete lifecycle state.','TEACHING_D10_CANCELLATION_CLOSURE_STATE_INVALID');
    const {rows:existing}=await q(tx,`select * from public.teaching_course_closure_records where student_id=$1 and course_id=$2 and closure_kind='CANCELLATION' order by closed_at desc limit 1`,[studentId,courseId]);
    if(existing?.[0]) return existing[0];
    const id=randomUUID(), closedAt=now();
    const {rows}=await q(tx,`insert into public.teaching_course_closure_records(
      closure_id,student_id,course_id,lifecycle_state_at_closure,closure_kind,reason,source_request_id,closed_at
    ) values($1,$2,$3,'INCOMPLETE','CANCELLATION',$4,$5,$6) returning *`,
    [id,studentId,courseId,String(reason||'Course cancelled under approved Request'),sourceRequestId,closedAt]);
    const policy=await currentAdmissionPolicy(tx);
    const counted=await countedCourses(studentId,{excludeCourseId:courseId,runner:tx,lock:true});
    await recordAdmissionUsing(tx,{studentId,courseId,kind:'CLOSURE',policy,countBefore:counted.length+1,outcome:'RELEASE',reason:'Approved Course cancellation closure',sourceRequestId});
    return rows[0];
  }

  async function applyRequest({studentId,requestId,expectedVersion=null,applyTargetUsing}){
    if(typeof applyTargetUsing!=='function') throw new TypeError('D10 Request application requires target-owner callback.');
    return withTransaction(async(tx)=>{
      const {rows}=await q(tx,'select * from public.teaching_requests where student_id=$1 and request_id=$2 for update',[studentId,requestId]);
      const current=rows?.[0]||null;
      if(!current) throw err('Teaching Request not found.','TEACHING_D10_REQUEST_NOT_FOUND',404);
      const {rows:existingApps}=await q(tx,'select * from public.teaching_request_applications where student_id=$1 and request_id=$2',[studentId,requestId]);
      if(existingApps?.[0]) return {request:current,application:existingApps[0],idempotent:true};
      if(expectedVersion!=null&&Number(current.state_version)!==Number(expectedVersion)) throw err('Request changed before application.','TEACHING_D10_REQUEST_STALE');
      if(!['APPROVED','APPROVED_WITH_ADJUSTMENT'].includes(current.lifecycle_state)) throw err('Only an approved Request can be applied.','TEACHING_D10_REQUEST_NOT_APPLICABLE');
      if(current.lifecycle_state==='APPROVED_WITH_ADJUSTMENT'&&current.student_response!=='ACCEPTED') throw err('Adjusted/alternative Request requires explicit student acceptance.','TEACHING_D10_ALTERNATIVE_ACCEPTANCE_REQUIRED');
      if(current.effective_at&&Date.parse(current.effective_at)>now().getTime()) throw err('Request effective time has not arrived.','TEACHING_D10_REQUEST_NOT_EFFECTIVE_YET',409);
      const targetResult=await applyTargetUsing(tx,current);
      const applicationRef=`request-application:${requestId}:${current.state_version}`;
      const applicationId=randomUUID();
      const appliedAt=now();
      const {rows:appRows}=await q(tx,`insert into public.teaching_request_applications(
        request_application_id,student_id,request_id,request_version,target_owner,target_ref,target_version_before,
        target_version_after,application_ref,applied_at,safe_metadata
      ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) returning *`,
      [applicationId,studentId,requestId,current.state_version,current.target_owner,current.target_ref,current.target_version_ref,
       targetResult?.targetVersionAfter||null,applicationRef,appliedAt,json(targetResult?.safeMetadata||{})]);
      const {rows:appliedRows}=await q(tx,`update public.teaching_requests set lifecycle_state='APPLIED',state_version=state_version+1,
        application_ref=$3,applied_at=$4,updated_at=now() where student_id=$1 and request_id=$2 returning *`,
      [studentId,requestId,applicationRef,appliedAt]);
      const applied=appliedRows[0];
      await appendRequestHistoryUsing(tx,{request:applied,fromState:current.lifecycle_state,toState:'APPLIED',actorType:'SYSTEM',actorAuthority:current.target_owner,
        reason:'Authoritative owner applied approved Request',applicationRef,safeMetadata:targetResult?.safeMetadata||{}});
      const {rows:closedRows}=await q(tx,`update public.teaching_requests set lifecycle_state='CLOSED',state_version=state_version+1,
        close_reason='APPLIED',closed_at=$3,updated_at=now() where student_id=$1 and request_id=$2 returning *`,[studentId,requestId,appliedAt]);
      const closed=closedRows[0];
      await appendRequestHistoryUsing(tx,{request:closed,fromState:'APPLIED',toState:'CLOSED',actorType:'SYSTEM',actorAuthority:'request',
        reason:'Applied Request closed',applicationRef});
      await auditUsing(tx,{studentId,action:'request.apply',entityType:'REQUEST',entityId:requestId,stateVersionRef:closed.state_version,
        beforeRef:{state:current.lifecycle_state},afterRef:{state:'CLOSED',application_ref:applicationRef},safeMetadata:{target_owner:current.target_owner}});
      return {request:closed,application:appRows[0],targetResult,idempotent:false};
    });
  }

  return Object.freeze({
    assertReady,ensureCourse,auditUsing,getAcademicRules,prepareAcademicRules,listTeacherIdentities,currentAdmissionPolicy,countedCourses,admissionSnapshot,
    getActivationFacts,markReady,activateCourseUsing,activateCourse,transitionCourseUsing,archiveIncomplete,
    createRequest,getRequest,getRequestById,listRequests,transitionRequest,recordDecisionUsing,acceptAlternativeUsing,declineAlternative,
    getClassTargetUsing,getClassTarget,changeTeacherUsing,recordCancellationClosureUsing,applyRequest,recordAdmissionUsing,
  });
}
module.exports={createD10LifecycleRequestRepository};
