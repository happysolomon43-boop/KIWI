'use strict';

const { normalizeScheduleInputs, assertCurrentCoursePlan, assertIanaTimezone } = require('./contracts');
const { computeSchedule, validateEditedSchedule, projectCalendarSlot } = require('./scheduler');
const { buildPreparationEvent } = require('../preparation/events');
const { TEACHING_EVENTS } = require('../events/names');

function createD09Service({repository,transactionalMutation,randomUUID,clock=()=>new Date(),intelligence=null,logger=console}={}) {
  if(!repository) throw new TypeError('D09 service requires repository.');
  if(!transactionalMutation||typeof transactionalMutation.mutateAndPublish!=='function') throw new TypeError('D09 service requires the D05 transactional Teaching mutation boundary.');
  if(typeof randomUUID!=='function') throw new TypeError('D09 service requires randomUUID().');

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
  const PREACTIVATION_STATES=new Set(['DRAFT','READY','PLANNING','SETUP']);
  const iso=(value)=>{const t=Date.parse(value||'');return Number.isFinite(t)?new Date(t).toISOString():String(value||'');};
  const sortedAvailability=(items=[])=>[...items].map((item)=>({
    dayOfWeek:Number(item.dayOfWeek??item.day_of_week),
    startLocal:String(item.startLocal??item.local_start??'').slice(0,5),
    endLocal:String(item.endLocal??item.local_end??'').slice(0,5),
    kind:String(item.kind||''),
    effectiveStartDate:item.effectiveStartDate??item.effective_start_date??null,
    effectiveEndDate:item.effectiveEndDate??item.effective_end_date??null,
  })).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  function globalAvailabilityFingerprint({semester,availability=[]}={}){
    if(!semester)return null;
    return JSON.stringify({
      semester:{
        name:String(semester.name||''),
        startsAt:iso(semester.startsAt??semester.starts_at),
        endsAt:iso(semester.endsAt??semester.ends_at),
        timezone:String(semester.timezone||''),
      },
      availability:sortedAvailability(availability),
    });
  }
  function semesterHasActivatedCourses(context){
    return (context?.courses||[]).some((bundle)=>!PREACTIVATION_STATES.has(String(bundle.course?.lifecycle_state||'DRAFT')));
  }
  async function listSemesters(user){ return repository.listSemesters(user.id); }
  async function saveScheduleInputs(user,courseId,input){
    const normalized=normalizeScheduleInputs(input);
    const before=await repository.getSchedulingContext(user.id,courseId);
    const changesSharedAvailability=Boolean(before.semester&&before.profile)
      && globalAvailabilityFingerprint({semester:before.semester,availability:before.availability})
        !== globalAvailabilityFingerprint({semester:normalized.semester,availability:normalized.availability});
    if(changesSharedAvailability&&semesterHasActivatedCourses(before)){
      const e=new Error('This availability is shared by an active Semester. Use the formal availability-change Request so the authoritative timetable can be recalculated safely.');
      e.status=409;
      e.code='TEACHING_D09_ACTIVE_SEMESTER_AVAILABILITY_REQUIRES_REQUEST';
      throw e;
    }

    await commitWithPpl((tx)=>repository.saveScheduleInputsUsing(tx,{studentId:user.id,courseId,input:normalized}));

    // Availability is semester-global. Once a new profile version is committed,
    // immediately rebuild the timetable proposal for every currently schedulable
    // Course instead of leaving a stale timetable that requires another click.
    try{
      const context=await repository.getSchedulingContext(user.id,courseId);
      if(context.semester&&context.profile&&(context.courses||[]).length){
        for(const bundle of context.courses) assertCurrentCoursePlan(bundle.course,bundle.plan,bundle.scopeChanges);
        const result=computeSchedule(context,{now:clock().toISOString()});
        await commitWithPpl((tx)=>repository.saveProposalUsing(tx,{
          studentId:user.id,
          courseId,
          context,
          result,
          source:'AVAILABILITY_AUTO_RECALC',
        }));
      }
    }catch(error){
      logger?.warn?.('[KIWI Teaching D09] Availability saved but automatic timetable recalculation could not complete.',{
        courseId:String(courseId),
        code:error?.code||null,
        message:String(error?.message||error).slice(0,300),
      });
    }
    return getScheduleReview(user,courseId);
  }
  function sanitizeReview(review,serverNow){
    if(!review.semester) return Object.freeze({
      stage:'SEMESTER_AND_AVAILABILITY',semester:null,profile:null,feasibility:null,timetable:null,slots:[],
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
      requestedCourse:Object.freeze({
        courseId:requestedCourseId,
        lifecycleState:String(review.course?.lifecycle_state||'DRAFT'),
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
      unresolvedSemesterCourses:Object.freeze(review.unresolvedCourses||[]),
      invariants:Object.freeze({
        hardConstraintsMayBeViolated:false,requiredCurriculumMayBeDeletedToFit:false,serverTimeAuthoritative:true,
        scheduleDebtIsNotMastery:true,pplIsNotScheduler:true,activationOwnedByD10:true,
      }),
      routeQualification:'DETERMINISTIC_RUNTIME_READY',
    });
  }
  async function getScheduleReview(user,courseId){
    const review=await repository.getScheduleReview(user.id,courseId);
    return sanitizeReview(review,clock().toISOString());
  }
  async function attachInheritedDefaultForScheduling(user,courseId,context){
    if(!context?.inheritedDefault) return context;
    if(semesterHasActivatedCourses(context)){
      const e=new Error('This shared Semester already contains an active Course. Adding another Course requires the governed scheduling-change path.');
      e.status=409;
      e.code='TEACHING_D09_ACTIVE_SEMESTER_REQUIRES_GOVERNED_RECALCULATION';
      throw e;
    }
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
  async function recalculateAfterCoursePlanChange(user,courseId){
    let context=await repository.getSchedulingContext(user.id,courseId);
    if(!context.semester||!context.profile) return Object.freeze({recalculated:false,reason:'SCHEDULE_INPUTS_REQUIRED'});
    if(semesterHasActivatedCourses(context)) return Object.freeze({recalculated:false,reason:'ACTIVE_SEMESTER_REQUIRES_GOVERNED_RECALCULATION'});
    if(context.inheritedDefault){
      try{context=await attachInheritedDefaultForScheduling(user,courseId,context);}
      catch(error){return Object.freeze({recalculated:false,reason:error?.code||'DEFAULT_SEMESTER_ATTACH_FAILED'});}
    }
    const requested=(context.courses||[]).find((bundle)=>String(bundle.course?.course_id||'')===String(courseId));
    if(!requested) return Object.freeze({recalculated:false,reason:'CURRENT_COURSE_PLAN_REQUIRED'});
    for(const bundle of context.courses||[]) assertCurrentCoursePlan(bundle.course,bundle.plan,bundle.scopeChanges);
    const result=computeSchedule(context,{now:clock().toISOString()});
    const saved=await commitWithPpl((tx)=>repository.saveProposalUsing(tx,{
      studentId:user.id,
      courseId,
      context,
      result,
      source:'COURSE_PLAN_AUTO_RECALC',
    }));
    return Object.freeze({
      recalculated:true,
      timetableVersionId:saved.timetable?.timetable_version_id||null,
      timetableVersion:saved.timetable?.version_no==null?null:Number(saved.timetable.version_no),
      outcome:saved.feasibility?.outcome||result.outcome||null,
    });
  }
  async function proposeTimetable(user,courseId){
    let context=await repository.getSchedulingContext(user.id,courseId);
    if(context.inheritedDefault) context=await attachInheritedDefaultForScheduling(user,courseId,context);
    requireReadyContext(context,courseId);
    const serverNow=clock().toISOString();
    const result=computeSchedule(context,{now:serverNow});
    await commitWithPpl((tx)=>repository.saveProposalUsing(tx,{studentId:user.id,courseId,context,result,source:'DETERMINISTIC_INITIAL'}));
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

  return Object.freeze({listSemesters,saveScheduleInputs,getScheduleReview,recalculateAfterCoursePlanChange,proposeTimetable,editTimetable,getCalendar});
}
module.exports={createD09Service};
