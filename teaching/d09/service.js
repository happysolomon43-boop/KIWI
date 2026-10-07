'use strict';

const { normalizeScheduleInputs, assertCurrentCoursePlan, assertIanaTimezone, digest } = require('./contracts');
const { computeSchedule, validateEditedSchedule, projectCalendarSlot } = require('./scheduler');
const { buildPreparationEvent } = require('../preparation/events');
const { TEACHING_EVENTS } = require('../events/names');
const {
  PREACTIVATION_STATES,
  isGovernedSchedulingLifecycle,
  instructionalUnits,
  scheduleClassFacts,
  slotsForCourse,
  ensureInstructionalLoads,
  schedulableScheduleContext,
  computeSharedSemesterSchedule,
} = require('./schedule-preparation');

function createD09Service({repository,transactionalMutation,randomUUID,clock=()=>new Date(),intelligence=null,outboxStore=null,logger=console}={}) {
  if(!repository) throw new TypeError('D09 service requires repository.');
  if(!transactionalMutation||typeof transactionalMutation.mutateAndPublish!=='function') throw new TypeError('D09 service requires the D05 transactional Teaching mutation boundary.');
  if(typeof randomUUID!=='function') throw new TypeError('D09 service requires randomUUID().');

  const backgroundQueueUnavailable=()=>{
    const error=new Error('Background timetable building is temporarily unavailable.');
    error.status=503;
    error.code='TEACHING_D09_BACKGROUND_TIMETABLE_UNAVAILABLE';
    throw error;
  };
  function backgroundBuildProjection(job){
    if(!job)return null;
    const status=String(job.status||'').toUpperCase();
    const payload=job.payload&&typeof job.payload==='object'&&!Array.isArray(job.payload)?job.payload:{};
    return Object.freeze({
      eventId:job.event_id,
      status,
      operation:String(payload.operation||'BUILD'),
      source:payload.source||null,
      attemptCount:Number(job.attempt_count||0),
      lastErrorCode:job.last_error_code||null,
      nextAttemptAt:job.next_attempt_at||null,
      createdAt:job.created_at||null,
      updatedAt:job.updated_at||null,
      publishedAt:job.published_at||null,
      aggregateVersion:job.aggregate_version==null?null:Number(job.aggregate_version),
      active:['PENDING','CLAIMED','RETRY_WAIT'].includes(status),
    });
  }
  function timetableBuildBasis(context,{operation='BUILD',source=null}={}){
    const normalizedOperation=String(operation||'BUILD').toUpperCase();
    const bundles=[...(context?.courses||[])];
    const inherited=context?.inheritedCourseBundle||null;
    if(inherited?.course?.course_id&&!bundles.some((bundle)=>String(bundle.course?.course_id||'')===String(inherited.course.course_id))){
      bundles.push(inherited);
    }
    const planBasis=bundles.map((bundle)=>({
      courseId:String(bundle.course?.course_id||''),
      courseStateVersion:Number(bundle.course?.state_version||0),
      planId:String(bundle.plan?.course_plan_id||''),
      planVersion:Number(bundle.plan?.version_no||0),
    })).sort((a,b)=>a.courseId.localeCompare(b.courseId));
    const basisDigest=digest({
      semesterId:context?.semester?.semester_id||null,
      semesterStateVersion:Number(context?.semester?.state_version||0),
      profileId:context?.profile?.profile_id||null,
      profileVersion:Number(context?.profile?.version_no||0),
      plans:planBasis,
      operation:normalizedOperation,
      source:source||null,
    });
    return Object.freeze({normalizedOperation,planBasis,basisDigest});
  }
  async function validateQueuedTimetableBuild(user,courseId,payload={}){
    const context=await repository.getSchedulingContext(user.id,courseId);
    if(!context.semester||!context.profile)return Object.freeze({current:false,reason:'SCHEDULE_INPUTS_REQUIRED'});
    const basis=timetableBuildBasis(context,{
      operation:payload.operation||'BUILD',
      source:payload.source||null,
    });
    const current=String(payload.basis_digest||'')===basis.basisDigest;
    return Object.freeze({
      current,
      reason:current?null:'SCHEDULING_BASIS_CHANGED',
      basisDigest:basis.basisDigest,
      expectedBasisDigest:payload.basis_digest||null,
    });
  }
  function pplEvent(result,correlationId){
    const p=result.ppl;
    return buildPreparationEvent({
      eventId:randomUUID(),
      eventType:p.isNew?TEACHING_EVENTS.PREPARATION_WORKSPACE_SEEDED:TEACHING_EVENTS.PREPARATION_INPUT_CHANGED,
      workspaceId:p.workspaceId,workspaceVersion:p.workspaceVersion,occurredAt:clock().toISOString(),
      correlationId,changedDependencyRefs:p.changedRefs,
      payload:{target_ref:'semester-schedule',idempotency_scope_ref:result.profile?.profile_id||result.timetable?.timetable_version_id||correlationId},
      provenanceRefs:p.changedRefs,
    });
  }
  async function commitWithPpl(mutate){
    const correlationId=randomUUID();
    const wrapped=await transactionalMutation.mutateAndPublish({
      mutate,
      buildEvent:(result)=>pplEvent(result,correlationId),
    });
    return wrapped.mutationResult;
  }
  function requireReadyContext(context,requestedCourseId){
    if(!context.semester){ const e=new Error('Save the semester and availability before creating a timetable.'); e.status=409; e.code='TEACHING_D09_SEMESTER_REQUIRED'; throw e; }
    if(!context.profile){ const e=new Error('A current availability/scheduling profile is required.'); e.status=409; e.code='TEACHING_D09_SCHEDULE_PROFILE_REQUIRED'; throw e; }
    const requested=context.courses.find((b)=>String(b.course.course_id)===String(requestedCourseId));
    if(!requested){ const e=new Error('The requested Course has no current Course Plan to schedule.'); e.status=409; e.code='TEACHING_D09_CURRENT_COURSE_PLAN_REQUIRED'; throw e; }
    for(const bundle of context.courses) assertCurrentCoursePlan(bundle.course,bundle.plan,bundle.scopeChanges);
    return requested;
  }
  const iso=(value)=>{const t=Date.parse(value||'');return Number.isFinite(t)?new Date(t).toISOString():String(value||'');};
  const stableValue=(value)=>{
    if(Array.isArray(value))return value.map(stableValue);
    if(value&&typeof value==='object'){
      return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stableValue(value[key])]));
    }
    return value;
  };
  const sortedAvailability=(items=[])=>[...items].map((item)=>({
    dayOfWeek:Number(item.dayOfWeek??item.day_of_week),
    startLocal:String(item.startLocal??item.local_start??'').slice(0,5),
    endLocal:String(item.endLocal??item.local_end??'').slice(0,5),
    kind:String(item.kind||''),
    effectiveStartDate:item.effectiveStartDate??item.effective_start_date??null,
    effectiveEndDate:item.effectiveEndDate??item.effective_end_date??null,
  })).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const sortedGlobalBlocks=(items=[])=>[...items]
    .filter((item)=>!(item.courseId??item.course_id))
    .map((item)=>({
      kind:String(item.kind??item.block_kind??''),
      startsAt:iso(item.startsAt??item.starts_at),
      endsAt:iso(item.endsAt??item.ends_at),
      label:item.label??null,
      reason:item.reason??null,
    }))
    .sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  function sharedScheduleAuthorityFingerprint({semester,availability=[],preferences={},blocks=[]}={}){
    if(!semester)return null;
    return JSON.stringify(stableValue({
      semester:{
        name:String(semester.name||''),
        startsAt:iso(semester.startsAt??semester.starts_at),
        endsAt:iso(semester.endsAt??semester.ends_at),
        timezone:String(semester.timezone||''),
      },
      availability:sortedAvailability(availability),
      preferences:preferences||{},
      globalBlocks:sortedGlobalBlocks(blocks),
    }));
  }
  function semesterHasActivatedCourses(context){
    return (context?.courses||[]).some((bundle)=>isGovernedSchedulingLifecycle(bundle.course?.lifecycle_state));
  }
  function schedulableCourseIds(context){
    return Object.freeze([...(context?.courses||[])].map((bundle)=>String(bundle.course?.course_id||'')).filter(Boolean));
  }
  async function rebuildSharedSemesterTimetable(user,courseId,context,{source='DETERMINISTIC_INITIAL'}={}){
    if(!context?.semester||!context?.profile) return Object.freeze({
      recalculated:false,reason:'SCHEDULE_INPUTS_REQUIRED',scope:'SEMESTER_SHARED',semesterId:context?.semester?.semester_id||null,
      affectedCourseIds:Object.freeze([]),affectedCourseCount:0,
    });

    let authoritativeContext=context;
    let eligibleContext=schedulableScheduleContext(authoritativeContext);
    let affectedCourseIds=schedulableCourseIds(eligibleContext);
    if(!affectedCourseIds.length) return Object.freeze({
      recalculated:false,reason:'CURRENT_COURSE_PLAN_REQUIRED',scope:'SEMESTER_SHARED',semesterId:authoritativeContext.semester.semester_id,
      affectedCourseIds,affectedCourseCount:0,
    });

    const requestedReady=eligibleContext.courses.some((bundle)=>String(bundle.course?.course_id||'')===String(courseId));
    const anchorCourseId=requestedReady?courseId:eligibleContext.courses[0].course.course_id;
    authoritativeContext=await ensureInstructionalLoads({
      user,courseId,anchorCourseId,initialContext:eligibleContext,intelligence,repository,requireReadyContext,
    });
    eligibleContext=schedulableScheduleContext(authoritativeContext);
    affectedCourseIds=schedulableCourseIds(eligibleContext);
    for(const bundle of eligibleContext.courses||[]) assertCurrentCoursePlan(bundle.course,bundle.plan,bundle.scopeChanges);

    const now=clock().toISOString();
    const {planningContext,result}=computeSharedSemesterSchedule(authoritativeContext,{now});
    const instructionalCourseIds=new Set(instructionalUnits(planningContext).map(({bundle})=>String(bundle.course.course_id)));
    for(const affectedCourseId of instructionalCourseIds){
      const facts=scheduleClassFacts(slotsForCourse(result.schedule,affectedCourseId),now);
      if(facts.classCount<=0){
        const error=new Error('The Scheduler produced no instructional Classes for a Course that requires instruction.');
        error.status=422;error.code='TEACHING_D09_EMPTY_INSTRUCTIONAL_TIMETABLE';
        error.details={courseId:affectedCourseId,reasons:result.reasons||[]};
        throw error;
      }
    }
    const globalFacts=scheduleClassFacts(result.schedule,now);
    if(globalFacts.elapsedClassCount>0){
      const error=new Error('The proposed Semester timetable contains elapsed Classes and must be recalculated from server time.');
      error.status=422;error.code='TEACHING_D09_ELAPSED_TIMETABLE_REJECTED';throw error;
    }

    const saved=await commitWithPpl((tx)=>repository.saveProposalUsing(tx,{
      studentId:user.id,
      courseId,
      context:authoritativeContext,
      planningContext,
      result,
      source,
    }));
    return Object.freeze({
      recalculated:true,
      scope:'SEMESTER_SHARED',
      semesterId:authoritativeContext.semester.semester_id,
      affectedCourseIds,
      affectedCourseCount:affectedCourseIds.length,
      timetableVersionId:saved.timetable?.timetable_version_id||null,
      timetableVersion:saved.timetable?.version_no==null?null:Number(saved.timetable.version_no),
      outcome:saved.feasibility?.outcome||result.outcome||null,
      source,
    });
  }
  async function listSemesters(user){ return repository.listSemesters(user.id); }
  async function saveScheduleInputs(user,courseId,input){
    const normalized=normalizeScheduleInputs(input);
    const before=await repository.getSchedulingContext(user.id,courseId);
    const activatedCourseIds=new Set((before.courses||[])
      .filter((bundle)=>isGovernedSchedulingLifecycle(bundle.course?.lifecycle_state))
      .map((bundle)=>String(bundle.course.course_id)));
    const changesSharedAuthority=Boolean(before.semester&&before.profile)
      && sharedScheduleAuthorityFingerprint({
        semester:before.semester,availability:before.availability,preferences:before.profile?.preferences,blocks:before.blocks,
      })!==sharedScheduleAuthorityFingerprint({
        semester:normalized.semester,availability:normalized.availability,preferences:normalized.preferences,blocks:normalized.blocks,
      });
    const touchesActivatedSibling=[...normalized.blocks,...normalized.deadlines,...normalized.reserves]
      .map((item)=>String(item.courseId||''))
      .filter(Boolean)
      .some((id)=>id!==String(courseId)&&activatedCourseIds.has(id));
    if((changesSharedAuthority||touchesActivatedSibling)&&activatedCourseIds.size){
      const e=new Error('This change affects an active Semester. Use the formal scheduling-change Request so the approved timetable remains authoritative until the replacement is applied.');
      e.status=409;
      e.code='TEACHING_D09_ACTIVE_SEMESTER_AVAILABILITY_REQUIRES_REQUEST';
      throw e;
    }

    await commitWithPpl((tx)=>repository.saveScheduleInputsUsing(tx,{studentId:user.id,courseId,input:normalized}));

    let automaticRecalculation=null,recalculationContext=null;
    try{
      recalculationContext=await repository.getSchedulingContext(user.id,courseId);
      const expansion=semesterHasActivatedCourses(recalculationContext)
        && PREACTIVATION_STATES.has(String(recalculationContext.course?.lifecycle_state||'DRAFT'));
      const source=expansion
        ? 'COURSE_ADMISSION_EXPANSION_PROPOSAL'
        : changesSharedAuthority
          ? 'AVAILABILITY_AUTO_RECALC'
          : 'SCHEDULE_INPUT_AUTO_RECALC';
      const queued=await queueTimetableBuild(user,courseId,{operation:'REFLOW',source});
      const affectedCourseIds=schedulableCourseIds(schedulableScheduleContext(recalculationContext));
      automaticRecalculation=Object.freeze({
        recalculated:false,
        queued:true,
        background:true,
        jobId:queued.jobId,
        status:queued.status,
        scope:'SEMESTER_SHARED',
        semesterId:recalculationContext?.semester?.semester_id||null,
        affectedCourseIds,
        affectedCourseCount:affectedCourseIds.length,
        source,
      });
    }catch(error){
      const affectedCourseIds=schedulableCourseIds(recalculationContext);
      automaticRecalculation=Object.freeze({
        recalculated:false,
        queued:false,
        reason:error?.code||'SEMESTER_TIMETABLE_REBUILD_QUEUE_FAILED',
        scope:'SEMESTER_SHARED',
        semesterId:recalculationContext?.semester?.semester_id||null,
        affectedCourseIds,
        affectedCourseCount:affectedCourseIds.length,
      });
      logger?.warn?.('[KIWI Teaching D09] Schedule inputs saved but background Semester timetable rebuild could not be queued.',{
        courseId:String(courseId),
        code:error?.code||null,
        message:String(error?.message||error).slice(0,300),
      });
    }
    const review=await getScheduleReview(user,courseId);
    return Object.freeze({...review,automaticRecalculation});
  }
  function sanitizeReview(review,serverNow){
    if(!review.semester) return Object.freeze({
      stage:'SEMESTER_AND_AVAILABILITY',semester:null,profile:null,feasibility:null,timetable:null,slots:[],
      backgroundBuild:backgroundBuildProjection(review.backgroundTimetableBuild),
      serverNow,routeQualification:'DETERMINISTIC_RUNTIME_READY',
    });
    const coverageByCourse=new Map();
    for(const bundle of review.courses||[]){
      const required=bundle.coverage.filter((r)=>!r.excluded_at);
      coverageByCourse.set(bundle.course.course_id,{
        requiredItems:required.length,
        instructionallyCompleteItems:required.filter((r)=>r.instructionally_complete_at).length,
      });
    }
    const slots=(review.slots||[]).map((s)=>Object.freeze({
      slotId:s.timetable_slot_id,courseId:s.course_id,kind:s.slot_kind,startsAt:s.starts_at,endsAt:s.ends_at,timezone:s.timezone,
      horizonStage:s.horizon_stage,learningUnitRefs:s.learning_unit_refs,plannedMinutes:s.planned_minutes,
      exceptionCodes:s.exception_codes,rationale:s.rationale,
    }));
    const scheduleStale=Boolean(review.staleSchedule);
    const requestedCourseId=String(review.course?.course_id||'');
    const requestedBundle=(review.courses||[]).find((bundle)=>String(bundle.course?.course_id||'')===requestedCourseId)
      || (String(review.inheritedCourseBundle?.course?.course_id||'')===requestedCourseId?review.inheritedCourseBundle:null);
    let requestedPlanReady=false;
    if(requestedBundle){
      try{assertCurrentCoursePlan(requestedBundle.course,requestedBundle.plan,requestedBundle.scopeChanges);requestedPlanReady=true;}
      catch(_error){requestedPlanReady=false;}
    }
    const courseSlots=slots.filter((slot)=>String(slot.courseId||'')===requestedCourseId);
    const timetableCourseIds=Object.freeze([...(review.timetable?.course_plan_refs||[])]
      .map((ref)=>String(ref.course_id||'')).filter(Boolean));
    const eligibleCourseIds=schedulableCourseIds(review);
    const rawCourseSummary=(review.feasibility?.course_summaries||[]).find((summary)=>String(summary.courseId??summary.course_id??'')===requestedCourseId)||null;
    const courseSummary=rawCourseSummary?Object.freeze({
      courseId:requestedCourseId,
      requiredMinutes:Number(rawCourseSummary.requiredMinutes??rawCourseSummary.required_minutes??0),
      scheduledMinutes:Number(rawCourseSummary.scheduledMinutes??rawCourseSummary.scheduled_minutes??0),
      instructionalLoadMinMinutes:Number(rawCourseSummary.instructionalLoadMinMinutes??rawCourseSummary.instructional_load_min_minutes??0),
      instructionalLoadMaxMinutes:Number(rawCourseSummary.instructionalLoadMaxMinutes??rawCourseSummary.instructional_load_max_minutes??0),
      reserveMinutes:Number(rawCourseSummary.reserveMinutes??rawCourseSummary.reserve_minutes??0),
      deadlineKind:rawCourseSummary.deadlineKind??rawCourseSummary.deadline_kind??null,
      targetAt:rawCourseSummary.targetAt??rawCourseSummary.target_at??null,
    }):null;
    const past=courseSlots.filter((s)=>Date.parse(s.endsAt)<=Date.parse(serverNow)).length;
    return Object.freeze({
      stage:'PROPOSED_TIMETABLE_AND_FEASIBILITY',
      serverNow,
      semester:Object.freeze({
        semesterId:review.semester.semester_id,name:review.semester.name,startsAt:review.semester.starts_at,endsAt:review.semester.ends_at,
        timezone:review.semester.timezone,stateVersion:Number(review.semester.state_version),
        inheritedDefault:review.inheritedDefault===true,
      }),
      availabilityScope:'SEMESTER_GLOBAL_DEFAULT',
      inheritedAvailability:review.inheritedDefault===true,
      semesterHasActivatedCourses:semesterHasActivatedCourses(review),
      timetableScope:Object.freeze({
        kind:'SEMESTER_SHARED',
        semesterId:review.semester.semester_id,
        courseIds:timetableCourseIds,
        courseCount:timetableCourseIds.length,
        requestedCourseOnlyView:true,
      }),
      rebuildScope:Object.freeze({
        kind:'SEMESTER_SCHEDULABLE_SET',
        semesterId:review.semester.semester_id,
        courseIds:eligibleCourseIds,
        courseCount:eligibleCourseIds.length,
      }),
      requestedCourse:Object.freeze({
        courseId:requestedCourseId,
        lifecycleState:String(review.course?.lifecycle_state||'DRAFT'),
        stateVersion:Number(review.course?.state_version||0),
        planReady:requestedPlanReady,
        attachedToSemester:review.inheritedDefault!==true,
      }),
      profile:review.profile?Object.freeze({
        profileId:review.profile.profile_id,version:Number(review.profile.version_no),timezone:review.profile.timezone,
        preferences:review.profile.preferences,settings:review.profile.settings,
        availability:(review.availability||[]).map((a)=>({dayOfWeek:a.day_of_week,startLocal:String(a.local_start).slice(0,5),endLocal:String(a.local_end).slice(0,5),kind:a.kind,label:a.label})),
        blocks:(review.blocks||[]).map((b)=>({courseId:b.course_id,kind:b.block_kind,startsAt:b.starts_at,endsAt:b.ends_at,label:b.label,reason:b.reason})),
        deadlines:(review.deadlines||[]).map((d)=>({courseId:d.course_id,kind:d.deadline_kind,deadlineAt:d.deadline_at,label:d.label})),
        reserves:(review.reserves||[]).map((r)=>({courseId:r.course_id,kind:r.reserve_kind,minutes:r.minutes,protectedStartAt:r.protected_start_at,protectedEndAt:r.protected_end_at})),
      }):null,
      timetable:review.timetable?Object.freeze({
        timetableVersionId:review.timetable.timetable_version_id,version:Number(review.timetable.version_no),
        state:scheduleStale?'STALE':review.timetable.timetable_state,sourceKind:review.timetable.source_kind,createdAt:review.timetable.created_at,
      }):null,
      slots:Object.freeze(slots),
      courseSlots:Object.freeze(courseSlots),
      feasibility:review.feasibility?Object.freeze({
        outcome:scheduleStale?'STALE':review.feasibility.outcome,evaluatedAt:review.feasibility.evaluated_at,
        metrics:review.feasibility.capacity_metrics,courseSummary,reasons:review.feasibility.reasons,alternatives:review.feasibility.alternatives,
        headroomPolicyVersion:review.feasibility.headroom_policy_version,
      }):null,
      progressTruths:Object.freeze({
        calendar:Object.freeze({elapsedScheduledSlots:past,totalScheduledSlots:courseSlots.length,source:'SCHEDULER_SERVER_TIME',scope:'REQUESTED_COURSE'}),
        curriculumCoverage:Object.freeze(Object.fromEntries(coverageByCourse)),
        verifiedLearning:Object.freeze({status:'UNAVAILABLE_UNTIL_D13',source:'STUDENT_KNOWLEDGE_MODEL_OWNER_NOT_IMPLEMENTED_IN_D09'}),
      }),
      scheduleHealth:Object.freeze({
        state:scheduleStale?'STALE_RECALCULATION_REQUIRED':'CURRENT',
        debtState:Number(review.debtMinutes)>0?'SCHEDULE_DEBT_PRESENT':'NO_SCHEDULE_DEBT',
        rawDebtMinutesExposedToStudent:false,
        behindDiagnosis:Number(review.debtMinutes)>0
          ? Object.freeze(['REQUIRED_WORK_NOT_YET_PLACED_WITHIN_CURRENT_FEASIBLE_CAPACITY'])
          : Object.freeze([]),
        aheadOptions:Number(review.debtMinutes)===0 && review.feasibility?.outcome==='FEASIBLE'
          ? Object.freeze(['BUILD_BUFFER','OPTIONAL_TRANSFER_OR_ENRICHMENT','ACCELERATION_ONLY_WITH_TRUSTWORTHY_EVIDENCE'])
          : Object.freeze([]),
      }),
      backgroundBuild:backgroundBuildProjection(review.backgroundTimetableBuild),
      unresolvedSemesterCourses:Object.freeze(review.unresolvedCourses||[]),
      invariants:Object.freeze({
        hardConstraintsMayBeViolated:false,requiredCurriculumMayBeDeletedToFit:false,serverTimeAuthoritative:true,
        scheduleDebtIsNotMastery:true,pplIsNotScheduler:true,activationOwnedByD10:true,
        noIndependentCourseTimetableAuthority:true,availabilityChangeReflowsAllSchedulableCourses:true,
      }),
      routeQualification:'DETERMINISTIC_RUNTIME_READY',
    });
  }
  async function getScheduleReview(user,courseId){
    const review=await repository.getScheduleReview(user.id,courseId);
    return sanitizeReview(review,clock().toISOString());
  }

  async function queueTimetableBuild(user,courseId,{operation='BUILD',source=null}={}){
    if(!outboxStore||typeof outboxStore.append!=='function') backgroundQueueUnavailable();
    const normalizedOperation=String(operation||'BUILD').toUpperCase();
    if(!['BUILD','REFLOW'].includes(normalizedOperation)){
      const error=new Error('Unsupported timetable background operation.');
      error.status=400;
      error.code='TEACHING_D09_BACKGROUND_OPERATION_INVALID';
      throw error;
    }
    const context=await repository.getSchedulingContext(user.id,courseId);
    if(!context.semester||!context.profile){
      const error=new Error('Save Semester availability before building the timetable.');
      error.status=409;
      error.code='TEACHING_D09_SCHEDULE_INPUTS_REQUIRED';
      throw error;
    }
    const {planBasis,basisDigest}=timetableBuildBasis(context,{operation:normalizedOperation,source});
    const current=typeof repository.latestBackgroundTimetableBuild==='function'
      ? await repository.latestBackgroundTimetableBuild(user.id,courseId)
      : null;
    const currentStatus=String(current?.status||'').toUpperCase();
    const currentBasis=String(current?.payload?.basis_digest||'');
    if(['PENDING','CLAIMED','RETRY_WAIT'].includes(currentStatus)&&currentBasis===basisDigest){
      return Object.freeze({
        accepted:true,background:true,jobId:current.event_id,status:currentStatus,joinedExisting:true,
        operation:current?.payload?.operation||normalizedOperation,
      });
    }
    const eventId=randomUUID();
    const now=clock().toISOString();
    const queued=await outboxStore.append({
      eventId,
      schemaVersion:1,
      eventType:'teaching.timetable.build_requested',
      eventCategory:'operational_recovery_event',
      triggerType:'background_analysis',
      source:'teaching.d09',
      origin:normalizedOperation==='BUILD'?'teaching.schedule_manual_build':'teaching.schedule_auto_reflow',
      actorId:String(user.id),
      aggregateType:'teaching_course',
      aggregateId:String(courseId),
      aggregateVersion:Number(context.course.state_version),
      occurredAt:now,
      correlationId:eventId,
      causationId:current&&['PENDING','CLAIMED','RETRY_WAIT','CANCELLED'].includes(currentStatus)
        ? String(current.event_id)
        : null,
      idempotencyKey:`d09:timetable:${courseId}:${basisDigest}`,
      payload:{
        course_id:String(courseId),
        expected_state_version:String(context.course.state_version),
        semester_id:String(context.semester.semester_id),
        semester_state_version:Number(context.semester.state_version||0),
        profile_id:String(context.profile.profile_id),
        profile_version:Number(context.profile.version_no),
        basis_digest:basisDigest,
        operation:normalizedOperation,
        source:source||null,
      },
      auditRefs:[],
      provenanceRefs:planBasis.filter((item)=>item.planId).map((item)=>`course-plan:${item.planId}:v${item.planVersion}`),
    });
    return Object.freeze({
      accepted:true,
      background:true,
      jobId:queued.event.event_id,
      status:queued.event.status,
      joinedExisting:queued.inserted===false,
      operation:normalizedOperation,
      supersedesJobId:current&&currentBasis!==basisDigest&&['PENDING','CLAIMED','RETRY_WAIT'].includes(currentStatus)
        ? String(current.event_id)
        : null,
    });
  }
  async function attachInheritedDefaultForScheduling(user,courseId,context){
    if(!context?.inheritedDefault) return context;
    const inherited=context.inheritedCourseBundle||null;
    if(!inherited){
      const e=new Error('The requested Course could not inherit the current Semester scheduling context.'); e.status=409; e.code='TEACHING_D09_DEFAULT_SEMESTER_CONTEXT_REQUIRED'; throw e;
    }
    assertCurrentCoursePlan(inherited.course,inherited.plan,inherited.scopeChanges);
    if(typeof repository.attachCourseToSemester!=='function'){
      const e=new Error('Shared Semester inheritance is temporarily unavailable.'); e.status=503; e.code='TEACHING_D09_DEFAULT_SEMESTER_ATTACH_UNAVAILABLE'; throw e;
    }
    await repository.attachCourseToSemester({studentId:user.id,courseId,semesterId:context.semester.semester_id});
    return repository.getSchedulingContext(user.id,courseId);
  }
  async function recalculateAfterCoursePlanChange(user,courseId,{source=null}={}){
    let context=await repository.getSchedulingContext(user.id,courseId);
    if(!context.semester||!context.profile) return Object.freeze({recalculated:false,reason:'SCHEDULE_INPUTS_REQUIRED'});
    if(context.inheritedDefault){
      try{context=await attachInheritedDefaultForScheduling(user,courseId,context);}
      catch(error){return Object.freeze({recalculated:false,reason:error?.code||'DEFAULT_SEMESTER_ATTACH_FAILED'});}
    }
    const eligible=schedulableScheduleContext(context);
    if(!(eligible.courses||[]).length) return Object.freeze({recalculated:false,reason:'CURRENT_COURSE_PLAN_REQUIRED'});
    const expansion=semesterHasActivatedCourses(context)&&PREACTIVATION_STATES.has(String(context.course?.lifecycle_state||'DRAFT'));
    return rebuildSharedSemesterTimetable(user,courseId,context,{
      // Active-Semester expansion is an authority rule, not caller metadata.
      // Background orchestration may describe why the rebuild was queued, but
      // it cannot downgrade an expansion proposal into an ordinary reflow.
      source:expansion?'COURSE_ADMISSION_EXPANSION_PROPOSAL':(source||'COURSE_PLAN_AUTO_RECALC'),
    });
  }
  async function proposeTimetable(user,courseId){
    let context=await repository.getSchedulingContext(user.id,courseId);
    if(context.inheritedDefault) context=await attachInheritedDefaultForScheduling(user,courseId,context);
    requireReadyContext(context,courseId);
    const expansion=semesterHasActivatedCourses(context)&&PREACTIVATION_STATES.has(String(context.course?.lifecycle_state||'DRAFT'));
    await rebuildSharedSemesterTimetable(user,courseId,context,{
      source:expansion?'COURSE_ADMISSION_EXPANSION_PROPOSAL':'DETERMINISTIC_INITIAL',
    });
    return getScheduleReview(user,courseId);
  }
  async function editTimetable(user,courseId,input={}){
    const context=await repository.getSchedulingContext(user.id,courseId);
    requireReadyContext(context,courseId);
    if(!['DRAFT','READY','PLANNING','SETUP'].includes(String(context.course.lifecycle_state||'DRAFT'))){
      const e=new Error('Direct timetable editing is pre-activation only.'); e.status=409; e.code='TEACHING_D09_PREACTIVATION_EDIT_ONLY'; throw e;
    }
    const latest=await repository.latestTimetable(user.id,context.semester.semester_id);
    if(!latest.timetable){ const e=new Error('Create a proposed timetable before editing it.'); e.status=409; e.code='TEACHING_D09_TIMETABLE_REQUIRED'; throw e; }
    if(!Array.isArray(input.edits)||!input.edits.length){ const e=new Error('At least one timetable slot edit is required.'); e.status=400; e.code='TEACHING_D09_TIMETABLE_EDIT_REQUIRED'; throw e; }
    const result=validateEditedSchedule(context,latest.slots,input.edits,{now:clock().toISOString()});
    if(result.outcome==='INFEASIBLE'){
      const e=new Error('The edit violates feasibility or recovery-headroom requirements.'); e.status=422; e.code='TEACHING_D09_EDIT_INFEASIBLE'; e.details={reasons:result.reasons,alternatives:result.alternatives}; throw e;
    }
    await commitWithPpl((tx)=>repository.saveProposalUsing(tx,{studentId:user.id,courseId,context,result,source:'PREACTIVATION_EDIT'}));
    return getScheduleReview(user,courseId);
  }
  async function getCalendar(user,input={}){
    const from=input.from||null,to=input.to||null;
    if(from) require('../domain/time').assertAcademicTimestamp(from,'from');
    if(to) require('../domain/time').assertAcademicTimestamp(to,'to');
    const currentTimeZone=assertIanaTimezone(input.currentTimeZone||'UTC','currentTimeZone');
    const rows=await repository.listCalendar(user.id,{from,to});
    return Object.freeze({
      serverNow:clock().toISOString(),currentTimeZone,
      authoritativeClasses:Object.freeze(rows.classes.map((row)=>projectCalendarSlot({...row,sourceKind:'APPROVED_CLASS',authoritative:true},currentTimeZone))),
      preactivationProposals:Object.freeze(rows.proposals.map((row)=>projectCalendarSlot({...row,sourceKind:'PREACTIVATION_PROPOSAL',authoritative:false},currentTimeZone))),
      note:'Device/current timezone is display-only. Scheduled academic timestamps remain server-held and timezone-aware.',
    });
  }

  return Object.freeze({listSemesters,saveScheduleInputs,getScheduleReview,queueTimetableBuild,validateQueuedTimetableBuild,recalculateAfterCoursePlanChange,rebuildSharedSemesterTimetable,proposeTimetable,editTimetable,getCalendar});
}
module.exports={createD09Service};
