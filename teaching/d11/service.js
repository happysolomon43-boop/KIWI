'use strict';

const { randomUUID } = require('node:crypto');
const {
  PRIORITY_ORDER,
  DEFAULT_ADAPTIVE_RESERVE_POLICY,
  legalNextStates,
  assertTransitionAllowed,
  validateDescriptorSelection,
  classTimeEnvelope,
  computeOvertimeCeiling,
  nextInstructionCyclePhase,
  earlyClosureReadiness,
  validateLessonBlueprintProposal,
  validateLiveReplanProposal,
} = require('./contracts');
const { TEACHING_EVENTS } = require('../events/names');
const {
  evaluateWorkspaceTransition,
  evaluateFinalizationReadiness,
  reconcileMaterialityAndStaleness,
} = require('../preparation/t0-handlers');
const { EVENT_CATEGORIES } = require('../runtime/constants');

function fail(message, code, status = 409, details = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  throw error;
}

function expectedFromContext(context) {
  return Object.freeze({
    courseLifecycleState: context.classRow.course_lifecycle_state,
    courseStateVersion: context.classRow.course_state_version,
    classScheduleVersion: context.classRow.schedule_version,
    timetableVersionId: context.classRow.source_timetable_version_id || null,
    coursePlanId: context.plan?.course_plan_id || null,
    coursePlanVersion: context.plan?.version_no || null,
  });
}

function canonicalEventField(event, camel, snake) {
  return event?.[camel] ?? event?.[snake] ?? null;
}

function scheduledEvent({
  eventType,eventId,studentId,classId,aggregateVersion,dueAt,payload={},
  correlationId=null,causationId=null,provenanceRefs=[],
}) {
  const effective=new Date(dueAt);
  if(!Number.isFinite(effective.getTime())) throw new TypeError('D11 scheduled event requires a valid dueAt.');
  const at=effective.toISOString();
  const now=new Date().toISOString();
  return Object.freeze({
    eventId,schemaVersion:1,eventType,
    eventCategory:EVENT_CATEGORIES.SCHEDULED_DUE_EVENT,triggerType:'system_time',
    source:'teaching.d11',origin:'d11',actorId:studentId,
    aggregateType:'CLASS',aggregateId:classId,aggregateVersion:Number(aggregateVersion),
    occurredAt:now,effectiveAt:at,dueAt:at,correlationId,causationId,idempotencyKey:eventId,
    payload:Object.freeze({...payload}),auditRefs:Object.freeze([]),provenanceRefs:Object.freeze(provenanceRefs),
  });
}

const LIFECYCLE_TO_PPL = Object.freeze({
  ACTIVE:'Active',
  FINALIZATION_DUE:'Finalization Due',
  FINALIZED:'Finalized / Handed Off',
  HANDED_OFF:'Finalized / Handed Off',
  SUPERSEDED:'Superseded',
  CANCELLED:'Cancelled',
});
const MATURITY_TO_PPL = Object.freeze({
  SKELETON:'Skeleton',
  STRUCTURED:'Structured',
  CANDIDATE:'Candidate',
  PRE_LOCK_READY:'Pre-Lock Ready',
});
const NEXT_MATURITY = Object.freeze({
  SKELETON:'STRUCTURED',
  STRUCTURED:'CANDIDATE',
  CANDIDATE:'PRE_LOCK_READY',
});
const ROUTE_FOR_TARGET = Object.freeze({
  STRUCTURED:'bounded_interpretive',
  CANDIDATE:'strong_design',
  PRE_LOCK_READY:'final_reconciliation',
});

function createD11Service({
  repository,
  intelligence = null,
  withTransaction,
  dueEventStore,
  outboxStore,
  preparationRepository = null,
  clock = () => new Date(),
  reservePolicy = DEFAULT_ADAPTIVE_RESERVE_POLICY,
} = {}) {
  if (!repository || typeof repository.getClassContext !== 'function') throw new TypeError('D11 service requires repository.');
  if (typeof withTransaction !== 'function') throw new TypeError('D11 service requires withTransaction().');
  if (!dueEventStore || typeof dueEventStore.enqueueUsing !== 'function') throw new TypeError('D11 service requires the D02 due-event store.');
  if (!outboxStore || typeof outboxStore.appendUsing !== 'function') throw new TypeError('D11 service requires the D05 outbox store.');

  function assertClassPlanningEligible(context) {
    if (!context?.classRow) fail('Teaching Class not found.', 'TEACHING_D11_CLASS_NOT_FOUND', 404);
    if (!context.plan) fail('Current Course Plan is required.', 'TEACHING_D11_COURSE_PLAN_REQUIRED', 409);
    if (!['ACTIVE','READY'].includes(String(context.classRow.course_lifecycle_state))) {
      fail('Course state does not permit D11 lesson planning.', 'TEACHING_D11_COURSE_STATE_INVALID', 409);
    }
    if (String(context.classRow.lifecycle_state) === 'CANCELLED') {
      fail('Cancelled Class cannot be planned or taught.', 'TEACHING_D11_CLASS_CANCELLED', 409);
    }
  }

  function assertModelRoute() {
    if (!intelligence) {
      fail(
        'Teaching intelligence route is intentionally held until D30 qualification.',
        'TEACHING_D11_MODEL_ROUTE_UNQUALIFIED',
        503
      );
    }
  }

  function blueprintCurrentForContext(context) {
    const b=context?.blueprint;
    if(!b||!context?.plan||!context?.classRow) return false;
    return (
      String(b.source_course_state_version)===String(context.classRow.course_state_version) &&
      String(b.source_course_plan_version)===String(context.plan.version_no) &&
      String(b.source_class_schedule_version)===String(context.classRow.schedule_version) &&
      String(b.source_timetable_version_id || '')===String(context.classRow.source_timetable_version_id || '')
    );
  }

  function publicContext(context, now = clock()) {
    if (!context) return null;
    const time=classTimeEnvelope({
      scheduledStartAt:context.classRow.scheduled_start_at,
      scheduledEndAt:context.classRow.scheduled_end_at,
      overtimeCeilingAt:context.session?.overtime_ceiling_at || null,
      serverNow:now,
    });
    const legal=context.session
      ? legalNextStates({
          lifecycleState:context.session.lifecycle_state,
          fromState:context.session.instructional_substate,
          resumeState:context.session.resume_instructional_substate,
        })
      : Object.freeze([]);
    return Object.freeze({
      class:Object.freeze({
        classId:context.classRow.class_id,
        courseId:context.classRow.course_id,
        lifecycleState:context.classRow.lifecycle_state,
        scheduleVersion:Number(context.classRow.schedule_version),
        scheduledStartAt:context.classRow.scheduled_start_at,
        scheduledEndAt:context.classRow.scheduled_end_at,
        timezone:context.classRow.timezone,
      }),
      course:Object.freeze({
        lifecycleState:context.classRow.course_lifecycle_state,
        stateVersion:Number(context.classRow.course_state_version),
      }),
      plan:context.plan?Object.freeze({
        coursePlanId:context.plan.course_plan_id,
        versionNo:Number(context.plan.version_no),
      }):null,
      preparation:context.workspace?Object.freeze({
        workspaceId:context.workspace.workspace_id,
        lifecycleState:context.workspace.lifecycle_state,
        maturityStage:context.workspace.maturity_stage,
        stateVersion:Number(context.workspace.state_version),
        currentArtifactVersionRef:context.workspace.current_artifact_version_ref || null,
      }):null,
      blueprint:context.blueprint?Object.freeze({
        lessonBlueprintId:context.blueprint.lesson_blueprint_id,
        versionNo:Number(context.blueprint.version_no),
        state:context.blueprint.blueprint_state,
        objectiveSummary:context.blueprint.objective_summary || null,
        currentForAuthoritativeContext:blueprintCurrentForContext(context),
        hiddenPlanPayloadExposed:false,
      }):null,
      controller:context.session?Object.freeze({
        classSessionId:context.session.class_session_id,
        lessonBlueprintId:context.session.lesson_blueprint_id || null,
        lifecycleState:context.session.lifecycle_state,
        instructionalSubstate:context.session.instructional_substate,
        stateVersion:Number(context.session.state_version),
        eventCursor:Number(context.session.event_cursor),
        cyclePhase:context.session.cycle_phase,
        learningEvidenceDescriptor:context.session.current_learning_evidence_descriptor,
        assistanceLevel:context.session.current_assistance_level,
        progressState:context.session.progress_state || {},
        resumeInstructionalSubstate:context.session.resume_instructional_substate || null,
        breakStartedAt:context.session.break_started_at || null,
        breakEndsAt:context.session.break_ends_at || null,
        overtimeStartedAt:context.session.overtime_started_at || null,
        overtimeCeilingAt:context.session.overtime_ceiling_at || null,
        closureReason:context.session.closure_reason || null,
        legalNextStates:legal,
      }):null,
      time,
      priorityOrder:PRIORITY_ORDER,
      serverAuthoritative:true,
      modelRouteQualification:intelligence?'INJECTED_FOR_VALIDATED_EXECUTION':'UNQUALIFIED_UNTIL_D30',
      invariants:Object.freeze({
        controllerIsDeterministicAuthority:true,
        modelCannotMutateControllerDirectly:true,
        browserTimeIsNotAuthoritative:true,
        descriptorsAreNotSkmStates:true,
        missingFutureOwnerSignalsAreNotNegativeEvidence:true,
      }),
    });
  }

  async function getClass(user,classId) {
    const context=await repository.getClassContext(user.id,classId);
    if(!context) fail('Teaching Class not found.','TEACHING_D11_CLASS_NOT_FOUND',404);
    return publicContext(context);
  }

  async function currentPreparationReadiness(workspaceId, context, { requireBlueprint = false } = {}) {
    if(!preparationRepository) return null;
    const snapshot=await preparationRepository.getFinalizationSnapshot(workspaceId);
    if(!snapshot?.workspace) fail('Preparation Workspace disappeared before finalization.','TEACHING_D11_PPL_WORKSPACE_NOT_FOUND',409);
    const versions=[];
    for(const dep of snapshot.dependencies || []) {
      const current=await repository.currentDependencyVersion(dep);
      versions.push({id:dep.aggregate_ref,expected:String(dep.version_ref),current:current==null?'__MISSING__':String(current)});
    }
    const openFindings=(snapshot.findings || []).map((finding)=>({
      id:finding.finding_id,
      status:finding.status,
      blocksFinalization:String(finding.severity || '').toUpperCase()==='BLOCKING',
    }));
    const requiredValidations=[
      {id:'d11-artifact-current',passed:snapshot.artifact?.validity_state==='CURRENT',reason:'PREPARED_ARTIFACT_NOT_CURRENT'},
      ...(requireBlueprint
        ? [{id:'d11-blueprint-current',passed:blueprintCurrentForContext(context),reason:'LESSON_BLUEPRINT_NOT_CURRENT'}]
        : []),
    ];
    return evaluateFinalizationReadiness({
      versions,requiredValidations,openFindings,
      protectionChecks:[{id:'unprotected-lesson-blueprint',passed:snapshot.workspace.protected_content_class==='UNPROTECTED'}],
      policyChecks:[{id:'course-active',passed:context.classRow.course_lifecycle_state==='ACTIVE'}],
      feasibilityChecks:[{id:'class-not-cancelled',passed:context.classRow.lifecycle_state!=='CANCELLED'}],
      ownerPreconditions:[{
        id:'artifact-bound-to-current-inputs',
        passed:snapshot.artifact?.input_bundle_id===snapshot.workspace.current_authoritative_input_bundle_ref,
      }],
      deadlineAt:snapshot.workspace.finalization_or_freeze_at || null,
    });
  }

  async function transitionPreparation(workspaceId,{
    nextLifecycle=null,nextMaturity=null,routePosture=null,finalizationReadiness=null,reason,
  }={}) {
    if(!preparationRepository) return null;
    const snapshot=await preparationRepository.getWorkspaceSnapshot(workspaceId);
    const workspace=snapshot?.workspace;
    if(!workspace) fail('Preparation Workspace disappeared before transition.','TEACHING_D11_PPL_WORKSPACE_NOT_FOUND',409);
    const decision=evaluateWorkspaceTransition({
      currentLifecycle:workspace.lifecycle_state,
      currentMaturity:workspace.maturity_stage,
      nextLifecycle,nextMaturity,
      gateResults:[{id:'d11-owner-validation',passed:true}],
      routePosture,finalizationReadiness,
    });
    return preparationRepository.applyWorkspaceTransition({
      workspaceId,
      expectedStateVersion:workspace.state_version,
      decision,
      reason,
    });
  }

  async function buildPreparationMetadata(context, prep, targetMaturity, routePosture, requestKey) {
    const workspace=prep.workspace;
    const payload=await repository.getPreparationArtifactPayload(context.classRow.student_id,context.classRow.class_id);
    const snapshot=preparationRepository
      ? await preparationRepository.getWorkspaceSnapshot(workspace.workspace_id)
      : {findings:[]};
    return Object.freeze({
      stage:LIFECYCLE_TO_PPL[workspace.lifecycle_state] || 'Active',
      maturity:MATURITY_TO_PPL[workspace.maturity_stage] || 'Skeleton',
      maturity_target:MATURITY_TO_PPL[targetMaturity],
      workspace_ref:workspace.workspace_id,
      workspace_version:String(workspace.state_version),
      previous_artifact:payload?Object.freeze({
        artifact_version_id:payload.artifact_version_id,
        version_no:Number(payload.version_no),
        artifact_digest:payload.artifact_digest,
        payload:payload.payload,
      }):null,
      authoritative_input_bundle:Object.freeze({
        input_bundle_id:prep.bundle?.input_bundle_id || workspace.current_authoritative_input_bundle_ref,
        bundle_version:prep.bundle?.bundle_version || null,
        content_digest:prep.bundle?.content_digest || null,
        authoritative_refs:prep.bundle?.authoritative_refs || [],
      }),
      material_delta:Object.freeze(prep.bundle?.material_delta_summary || {}),
      finding_refs:Object.freeze((snapshot?.findings || []).map((finding)=>String(finding.finding_id))),
      review_purpose:targetMaturity==='PRE_LOCK_READY'?'final_preclass_reconciliation':'progressive_next_class_preparation',
      protection_class:workspace.protected_content_class,
      route_posture:routePosture,
      idempotency_key:requestKey,
      correlation_id:requestKey,
    });
  }

  async function preparationStep(user,classId,{requestKey=randomUUID()}={}) {
    assertModelRoute();
    let context=await repository.getClassContext(user.id,classId);
    assertClassPlanningEligible(context);
    const prep=await repository.ensurePreparationWorkspace({studentId:user.id,classId,correlationId:requestKey});
    context=await repository.getClassContext(user.id,classId);
    const workspace=prep?.workspace || context.workspace;
    if(!workspace) fail('Preparation Workspace could not be established.','TEACHING_D11_PPL_WORKSPACE_NOT_FOUND',409);
    if(workspace.maturity_stage==='PRE_LOCK_READY' || workspace.lifecycle_state==='HANDED_OFF') {
      return Object.freeze({done:true,context:publicContext(context),workspace});
    }

    const target=NEXT_MATURITY[workspace.maturity_stage];
    if(!target) fail('Unsupported D11 preparation maturity transition.','TEACHING_D11_PPL_MATURITY_INVALID',409);
    const routePosture=ROUTE_FOR_TARGET[target];
    const preparation=await buildPreparationMetadata(context,prep,target,routePosture,requestKey);
    const signals=await repository.getPlanningSignals(user.id,context.classRow);
    const result=await intelligence.planLesson({
      context,signals,requestKey,preparation,reservePolicy,
    });
    const output=result?.validatedResult?.output;
    if(!result?.accepted || !output) {
      fail('Lesson Planner did not produce an accepted provisional Blueprint.','TEACHING_D11_BLUEPRINT_NOT_ACCEPTED',422);
    }
    const validation=validateLessonBlueprintProposal(output,{
      learningUnits:context.learningUnits,
      scheduledStartAt:context.classRow.scheduled_start_at,
      scheduledEndAt:context.classRow.scheduled_end_at,
      ...(reservePolicy ? { reservePolicy } : {}),
    });
    if(!validation.ok) {
      fail('Lesson Blueprint failed deterministic D11 validation.',validation.reason || 'TEACHING_D11_BLUEPRINT_INVALID',422,validation);
    }

    const artifact=await repository.recordPreparationArtifact({
      studentId:user.id,classId,blueprint:validation.value,
      capabilityId:'teaching.lesson.pre_class_lesson_planning',promptFamilyRef:'TPF-05',
    });
    const refreshedBeforeTransition=await repository.getClassContext(user.id,classId);
    const candidateReadiness=target==='PRE_LOCK_READY'
      ? await currentPreparationReadiness(workspace.workspace_id,refreshedBeforeTransition,{requireBlueprint:false})
      : null;
    await transitionPreparation(workspace.workspace_id,{
      nextMaturity:target,
      routePosture,
      finalizationReadiness:candidateReadiness,
      reason:'D11 progressive next-Class preparation advanced to '+target,
    });

    if(target!=='PRE_LOCK_READY') {
      const next=await repository.getClassContext(user.id,classId);
      return Object.freeze({
        done:false,
        preparation:Object.freeze({workspaceId:workspace.workspace_id,maturityStage:target,artifactVersionId:artifact.artifact.artifact_version_id}),
        context:publicContext(next),
      });
    }

    // PRE_LOCK_READY candidate becomes authoritative only after a fresh short
    // owner transaction revalidates Course/Plan/Class versions.
    context=await repository.getClassContext(user.id,classId);
    const saved=await repository.saveBlueprint({
      studentId:user.id,classId,
      expected:expectedFromContext(context),
      blueprint:validation.value,
      validationMetadata:{
        deterministic_validation:'PASS',
        reserve_policy:validation.value.adaptive_reserve_policy,
        orchestrator_execution_id:result.executionId || null,
        ppl_workspace_id:workspace.workspace_id,
        ppl_artifact_version_id:artifact.artifact.artifact_version_id,
      },
      generationProvenance:{
        capability_id:'teaching.lesson.pre_class_lesson_planning',
        prompt_family_id:'TPF-05',
        authority_ceiling:'T3',
        route_posture:routePosture,
        orchestrator_execution_id:result.executionId || null,
        provisional_until_owner_commit:true,
      },
      preparationRef:artifact.artifact.artifact_version_id,
    });
    context=await repository.getClassContext(user.id,classId);
    const finalReadiness=await currentPreparationReadiness(workspace.workspace_id,context,{requireBlueprint:true});
    if(!finalReadiness?.ready) {
      fail('Prepared Lesson Blueprint failed final current-state reconciliation.','TEACHING_D11_PPL_FINALIZATION_NOT_READY',409,finalReadiness);
    }
    let ws=(await preparationRepository.getWorkspaceSnapshot(workspace.workspace_id)).workspace;
    if(ws.lifecycle_state==='ACTIVE') {
      await transitionPreparation(workspace.workspace_id,{nextLifecycle:'FINALIZATION_DUE',finalizationReadiness:finalReadiness,reason:'D11 pre-Class finalization due'});
      ws=(await preparationRepository.getWorkspaceSnapshot(workspace.workspace_id)).workspace;
    }
    if(ws.lifecycle_state==='FINALIZATION_DUE') {
      await transitionPreparation(workspace.workspace_id,{nextLifecycle:'FINALIZED',finalizationReadiness:finalReadiness,reason:'D11 Lesson Blueprint finalized'});
      ws=(await preparationRepository.getWorkspaceSnapshot(workspace.workspace_id)).workspace;
    }
    if(ws.lifecycle_state==='FINALIZED') {
      await transitionPreparation(workspace.workspace_id,{nextLifecycle:'HANDED_OFF',finalizationReadiness:finalReadiness,reason:'D11 Blueprint handed to Teaching Controller'});
    }
    const next=await repository.getClassContext(user.id,classId);
    return Object.freeze({
      done:true,
      preparation:Object.freeze({workspaceId:workspace.workspace_id,maturityStage:'PRE_LOCK_READY',artifactVersionId:artifact.artifact.artifact_version_id}),
      lessonBlueprintId:saved.blueprint.lesson_blueprint_id,
      context:publicContext(next),
    });
  }

  async function prepareLesson(user,classId,input={}) {
    assertModelRoute();
    const maxSteps=Math.max(1,Math.min(Number(input.maxSteps) || 3,3));
    let result=null;
    for(let i=0;i<maxSteps;i+=1) {
      result=await preparationStep(user,classId,{requestKey:randomUUID()});
      if(result.done) break;
    }
    return result;
  }

  async function handlePreparationEvent(event) {
    if(!intelligence) return Object.freeze({accepted:true,modelWorkStarted:false,routeQualification:'UNQUALIFIED_UNTIL_D30'});
    if(!preparationRepository) return Object.freeze({accepted:true,modelWorkStarted:false,reason:'PREPARATION_REPOSITORY_UNAVAILABLE'});
    const workspace=await preparationRepository.getWorkspace(canonicalEventField(event,'aggregateId','aggregate_id'));
    if(!workspace || workspace.target_kind!=='next_class') return Object.freeze({accepted:true,noop:true});
    if(['HANDED_OFF','SUPERSEDED','CANCELLED'].includes(workspace.lifecycle_state)) return Object.freeze({accepted:true,noop:true,reason:'WORKSPACE_TERMINAL'});
    try {
      const result=await preparationStep({id:workspace.student_id},workspace.target_ref,{requestKey:canonicalEventField(event,'eventId','event_id') || randomUUID()});
      return Object.freeze({accepted:true,modelWorkStarted:true,done:Boolean(result.done)});
    } catch(error) {
      // Preparation model work is provisional. Failure must never consume the
      // authoritative PPL event or replace the T0 state machine.
      return Object.freeze({accepted:true,modelWorkStarted:true,failedSafely:true,code:error?.code || 'TEACHING_D11_PREPARATION_FAILED'});
    }
  }

  async function startController(user,classId,sourceEventRef=null,idempotencyKey=null,options={}) {
    let context=await repository.getClassContext(user.id,classId);
    assertClassPlanningEligible(context);
    if(String(context.classRow.course_lifecycle_state)!=='ACTIVE') {
      fail('Only an Active Course may start a live Class Controller.','TEACHING_D11_COURSE_NOT_ACTIVE',409);
    }
    const now=clock();
    if(now.getTime()<new Date(context.classRow.scheduled_start_at).getTime()) {
      fail('Class cannot start before its authoritative scheduled time.','TEACHING_D11_CLASS_START_EARLY',409);
    }
    const prep=await repository.ensurePreparationWorkspace({studentId:user.id,classId,correlationId:sourceEventRef || null});
    context=await repository.getClassContext(user.id,classId);
    const workspaceReady=!context.workspace || ['FINALIZED','HANDED_OFF'].includes(String(context.workspace.lifecycle_state));
    const bindBlueprint=Boolean(
      context.blueprint &&
      blueprintCurrentForContext(context) &&
      prep?.changed!==true &&
      workspaceReady
    );
    const result=await withTransaction((tx)=>repository.ensureControllerStartedUsing(tx,{
      studentId:user.id,classId,
      expectedBlueprintId:bindBlueprint?context.blueprint.lesson_blueprint_id:null,
      bindBlueprint,
      allowRouteHeldStart:!bindBlueprint,
      sourceEventRef,idempotencyKey,
    }));
    const refreshed=await repository.getClassContext(user.id,classId);
    return publicContext({...refreshed,session:result.session});
  }

  async function replanLesson(user,classId,input={}) {
    assertModelRoute();
    let context=await repository.getClassContext(user.id,classId);
    assertClassPlanningEligible(context);
    const live=await repository.assertLiveContextCurrent(user.id,classId);
    if(!live.ok) fail('Controller is stale against authoritative state.','TEACHING_D11_STALE_LIVE_CONTEXT',409,live);
    context=live.context;
    if(!context.session || context.session.lifecycle_state==='CLOSED') fail('Live replanning requires an active Controller session.','TEACHING_D11_CONTROLLER_NOT_ACTIVE',409);
    if(!context.blueprint || String(context.session.lesson_blueprint_id || '')!==String(context.blueprint.lesson_blueprint_id)) {
      fail('Live replanning requires a current bound Lesson Blueprint.','TEACHING_D11_BLUEPRINT_REQUIRED',409);
    }
    const time=classTimeEnvelope({
      scheduledStartAt:context.classRow.scheduled_start_at,
      scheduledEndAt:context.classRow.scheduled_end_at,
      overtimeCeilingAt:context.session.overtime_ceiling_at,
      serverNow:clock(),
    });
    if(time.remaining_minutes<=0) fail('No authoritative Class time remains for replanning.','TEACHING_D11_REPLAN_NO_TIME',409);
    const signals=await repository.getPlanningSignals(user.id,context.classRow);
    const result=await intelligence.replanLesson({
      context,signals,remainingMinutes:time.remaining_minutes,requestKey:randomUUID(),reservePolicy,
    });
    const output=result?.validatedResult?.output;
    if(!result?.accepted || !output) fail('Live Lesson replan was not accepted.','TEACHING_D11_REPLAN_NOT_ACCEPTED',422);
    let value;
    try {
      value=validateLiveReplanProposal(output,{
        blueprintContext:{learningUnits:context.learningUnits,currentBlueprint:context.blueprint.blueprint_payload || {}},
        remainingMinutes:time.remaining_minutes,
        completedObjectiveRefs:context.session.progress_state?.completed_objective_refs || [],
        reservePolicy,
      });
    } catch(error) {
      fail('Live Lesson replan failed deterministic D11 validation.',error.code || 'TEACHING_D11_REPLAN_INVALID',422);
    }
    await repository.saveBlueprint({
      studentId:user.id,classId,expected:expectedFromContext(context),blueprint:value,
      validationMetadata:{
        deterministic_validation:'PASS',
        remaining_minutes:time.remaining_minutes,
        controller_version:Number(context.session.state_version),
        orchestrator_execution_id:result.executionId || null,
      },
      generationProvenance:{
        capability_id:'teaching.lesson.live_lesson_replanning',
        prompt_family_id:'TPF-05',
        authority_ceiling:'T3',
        orchestrator_execution_id:result.executionId || null,
        live_replanning_separate_from_ppl:true,
      },
      preparationRef:context.workspace?.current_artifact_version_ref || null,
      expectedControllerVersion:Number(context.session.state_version),
    });
    context=await repository.getClassContext(user.id,classId);
    return publicContext(context);
  }

  async function transition(user,classId,input={}) {
    const live=await repository.assertLiveContextCurrent(user.id,classId);
    const context=live.context;
    if(!context?.session) fail('Controller has not started.','TEACHING_D11_CONTROLLER_NOT_STARTED',409);
    if(!live.ok) fail('Controller is stale against authoritative Course/Plan/Schedule state.','TEACHING_D11_STALE_LIVE_CONTEXT',409,live);
    const toState=String(input.toState || '').toUpperCase();
    if(['BREAK','CLOSURE'].includes(toState)) fail('Use the dedicated Break/Closure command so durable time authority is preserved.','TEACHING_D11_DEDICATED_COMMAND_REQUIRED',409);
    assertTransitionAllowed({
      lifecycleState:context.session.lifecycle_state,
      fromState:context.session.instructional_substate,
      toState,
      resumeState:context.session.resume_instructional_substate,
    });
    const leavingInterrupted=context.session.instructional_substate==='INTERRUPTED';
    const enteringInterrupted=toState==='INTERRUPTED';
    const changed=await withTransaction((tx)=>repository.transitionUsing(tx,{
      studentId:user.id,classId,expectedVersion:Number(input.expectedVersion),toState,
      lifecycleState:enteringInterrupted?'INTERRUPTED':'ACTIVE',
      resumeState:context.session.resume_instructional_substate,
      reason:String(input.reason || 'Deterministic D11 Controller transition'),
      actionKind:enteringInterrupted?'CLASS_INTERRUPTED':(leavingInterrupted?'CLASS_RESUMED':'STATE_TRANSITION'),
      extraUpdates:{
        ...(enteringInterrupted?{resume_instructional_substate:context.session.instructional_substate}:{}),
        ...(leavingInterrupted?{resume_instructional_substate:null}:{}),
      },
    }));
    return publicContext({...context,session:changed.session});
  }

  async function advanceInstructionCycle(user,classId,input={}) {
    const live=await repository.assertLiveContextCurrent(user.id,classId);
    const context=live.context;
    if(!context?.session) fail('Controller has not started.','TEACHING_D11_CONTROLLER_NOT_STARTED',409);
    if(!live.ok) fail('Controller is stale against authoritative state.','TEACHING_D11_STALE_LIVE_CONTEXT',409,live);
    if(!['OPENING','DIAGNOSTIC','INSTRUCTION','GUIDED_PRACTICE','INDEPENDENT_PRACTICE','CLASSWORK','REMEDIATION'].includes(context.session.instructional_substate)) {
      fail('Instruction cycle cannot advance in this Controller substate.','TEACHING_D11_CYCLE_STATE_BLOCKED',409);
    }
    const next=nextInstructionCyclePhase(context.session.cycle_phase || 'TEACH');
    const changed=await withTransaction((tx)=>repository.transitionUsing(tx,{
      studentId:user.id,classId,expectedVersion:Number(input.expectedVersion),
      toState:context.session.instructional_substate,lifecycleState:context.session.lifecycle_state,
      reason:'Teach → Elicit/Check → Diagnose → Respond → Verify cycle progression',
      actionKind:'INSTRUCTION_CYCLE_ADVANCED',
      safeMetadata:{from_cycle_phase:context.session.cycle_phase,to_cycle_phase:next},
      extraUpdates:{cycle_phase:next},
    }));
    return publicContext({...context,session:changed.session});
  }

  async function setEvidenceDescriptor(user,classId,input={}) {
    const live=await repository.assertLiveContextCurrent(user.id,classId);
    const context=live.context;
    if(!context?.session) fail('Controller has not started.','TEACHING_D11_CONTROLLER_NOT_STARTED',409);
    if(!live.ok) fail('Controller is stale against authoritative state.','TEACHING_D11_STALE_LIVE_CONTEXT',409,live);
    if(['ASSESSMENT','BREAK','INTERRUPTED','CLOSURE'].includes(context.session.instructional_substate)) {
      fail('Evidence descriptor/assistance changes are blocked in the current substate.','TEACHING_D11_DESCRIPTOR_STATE_BLOCKED',409);
    }
    const selection=validateDescriptorSelection({
      descriptor:input.descriptor,
      assistanceLevel:input.assistanceLevel || context.session.current_assistance_level || 'NONE',
    });
    const changed=await withTransaction((tx)=>repository.transitionUsing(tx,{
      studentId:user.id,classId,expectedVersion:Number(input.expectedVersion),
      toState:context.session.instructional_substate,lifecycleState:context.session.lifecycle_state,
      reason:'Optional non-universal learning/evidence descriptor update',
      actionKind:'EVIDENCE_DESCRIPTOR_UPDATED',
      safeMetadata:{
        descriptor:selection.descriptor,
        assistance_level:selection.assistance_level,
        descriptor_is_not_skm_state:true,
        mandatory_sequence_position:null,
      },
      extraUpdates:{
        current_learning_evidence_descriptor:selection.descriptor,
        current_assistance_level:selection.assistance_level,
      },
    }));
    return publicContext({...context,session:changed.session});
  }

  async function recordProgress(user,classId,input={}) {
    const live=await repository.assertLiveContextCurrent(user.id,classId);
    const context=live.context;
    if(!context?.session) fail('Controller has not started.','TEACHING_D11_CONTROLLER_NOT_STARTED',409);
    if(!live.ok) fail('Controller is stale against authoritative state.','TEACHING_D11_STALE_LIVE_CONTEXT',409,live);
    if(!context.session.lesson_blueprint_id) fail('Progress against Lesson objectives requires a bound Lesson Blueprint.','TEACHING_D11_BLUEPRINT_REQUIRED',409);
    const changed=await withTransaction((tx)=>repository.recordProgressUsing(tx,{
      studentId:user.id,classId,expectedVersion:Number(input.expectedVersion),
      completedSegmentRefs:Array.isArray(input.completedSegmentRefs)?input.completedSegmentRefs:[],
      completedObjectiveRefs:Array.isArray(input.completedObjectiveRefs)?input.completedObjectiveRefs:[],
      evidenceRefs:Array.isArray(input.evidenceRefs)?input.evidenceRefs:[],
      independentEvidenceObjectiveRefs:Array.isArray(input.independentEvidenceObjectiveRefs)?input.independentEvidenceObjectiveRefs:[],
    }));
    return publicContext({...context,session:changed.session});
  }

  async function startBreak(user,classId,input={}) {
    const live=await repository.assertLiveContextCurrent(user.id,classId);
    const context=live.context;
    if(!context?.session || context.session.lifecycle_state!=='ACTIVE') fail('Break requires an active Controller.','TEACHING_D11_CONTROLLER_NOT_ACTIVE',409);
    if(!live.ok) fail('Controller is stale against authoritative state.','TEACHING_D11_STALE_LIVE_CONTEXT',409,live);
    if(['BREAK','ASSESSMENT','CLOSURE','INTERRUPTED'].includes(context.session.instructional_substate)) fail('Break is not legal in the current substate.','TEACHING_D11_BREAK_STATE_INVALID',409);
    if(context.session.overtime_started_at) fail('Breaks belong inside the scheduled Class block, not overtime.','TEACHING_D11_BREAK_OVERTIME_FORBIDDEN',409);
    const duration=Number(input.durationMinutes);
    if(!Number.isInteger(duration)||duration<=0) fail('Break durationMinutes must be a positive integer.','TEACHING_D11_BREAK_DURATION_INVALID',400);
    const now=clock();
    const endsAt=new Date(now.getTime()+duration*60000);
    if(endsAt.getTime()>new Date(context.classRow.scheduled_end_at).getTime()) fail('Break cannot extend beyond the scheduled Class end.','TEACHING_D11_BREAK_END_INVALID',409);

    const eventId='d11-break-end:'+context.session.class_session_id+':v'+(Number(input.expectedVersion)+1);
    const changed=await withTransaction(async(tx)=>{
      const result=await repository.transitionUsing(tx,{
        studentId:user.id,classId,expectedVersion:Number(input.expectedVersion),toState:'BREAK',lifecycleState:'ACTIVE',
        reason:'Server-authoritative Class break started',actionKind:'BREAK_STARTED',
        extraUpdates:{resume_instructional_substate:context.session.instructional_substate,break_started_at:now,break_ends_at:endsAt},
      });
      await dueEventStore.enqueueUsing(tx.query.bind(tx),scheduledEvent({
        eventType:TEACHING_EVENTS.BREAK_END_DUE,eventId,studentId:user.id,classId,
        aggregateVersion:Number(result.session.state_version),dueAt:endsAt,
        payload:{class_id:classId,class_session_id:result.session.class_session_id,expected_controller_version:Number(result.session.state_version)},
        provenanceRefs:[
          'class:'+classId,
          ...(context.blueprint?['lesson-blueprint:'+context.blueprint.lesson_blueprint_id]:[]),
        ],
      }));
      return result;
    });
    return publicContext({...context,session:changed.session});
  }

  async function resumeBreakFromDueEvent(event) {
    const studentId=canonicalEventField(event,'actorId','actor_id');
    const classId=canonicalEventField(event,'aggregateId','aggregate_id') || event?.payload?.class_id;
    const eventId=canonicalEventField(event,'eventId','event_id');
    const idempotencyKey=canonicalEventField(event,'idempotencyKey','idempotency_key');
    const context=await repository.getClassContext(studentId,classId);
    if(!context?.session) return Object.freeze({idempotent:true,reason:'CONTROLLER_NOT_STARTED'});
    const session=context.session;
    if(session.lifecycle_state==='CLOSED') return Object.freeze({idempotent:true,reason:'CONTROLLER_CLOSED'});
    if(session.instructional_substate!=='BREAK') return Object.freeze({idempotent:true,reason:'NO_LONGER_IN_BREAK'});
    const now=clock();
    if(session.break_ends_at && now.getTime()<new Date(session.break_ends_at).getTime()) {
      fail('Break-end event fired before the authoritative break deadline.','TEACHING_D11_BREAK_EVENT_EARLY',409);
    }
    const resume=session.resume_instructional_substate;
    if(!resume) fail('Break resume state is missing.','TEACHING_D11_BREAK_RESUME_STATE_MISSING',409);
    assertTransitionAllowed({lifecycleState:session.lifecycle_state,fromState:'BREAK',toState:resume,resumeState:resume});
    const changed=await withTransaction((tx)=>repository.transitionUsing(tx,{
      studentId,classId,expectedVersion:Number(session.state_version),toState:resume,lifecycleState:'ACTIVE',resumeState:resume,
      reason:'Server-authoritative Break expiry',actionKind:'BREAK_ENDED',
      sourceEventRef:eventId,idempotencyKey,
      extraUpdates:{resume_instructional_substate:null,break_started_at:null,break_ends_at:null},
    }));
    return Object.freeze({idempotent:false,session:changed.session});
  }

  async function refreshCoursePreparation(studentId,courseId,{correlationId=null,interruptActive=true}={}) {
    const classes=await repository.listClassesForCourse(studentId,courseId);
    const results=[];
    for(const klass of classes) {
      const before=await repository.getClassContext(studentId,klass.class_id);
      if(before?.session?.lifecycle_state==='ACTIVE' || before?.session?.lifecycle_state==='INTERRUPTED') {
        const live=await repository.assertLiveContextCurrent(studentId,klass.class_id);
        if(interruptActive && before.session.lifecycle_state==='ACTIVE' && !live.ok) {
          await withTransaction((tx)=>repository.transitionUsing(tx,{
            studentId,classId:klass.class_id,expectedVersion:Number(before.session.state_version),
            toState:'INTERRUPTED',lifecycleState:'INTERRUPTED',resumeState:before.session.instructional_substate,
            reason:'Authoritative upstream Course/Plan/Schedule state changed during Class',
            actionKind:'UPSTREAM_STATE_CHANGED',
            safeMetadata:{mismatches:live.mismatches || []},
            extraUpdates:{resume_instructional_substate:before.session.instructional_substate},
          }));
        }
        results.push(Object.freeze({classId:klass.class_id,live:true,workspaceChanged:false}));
        continue;
      }
      const prep=await repository.ensurePreparationWorkspace({studentId,classId:klass.class_id,correlationId});
      if(prep?.changed && preparationRepository && prep.workspace?.current_artifact_version_ref) {
        const snapshot=await preparationRepository.getMaterialitySnapshot(prep.workspace.workspace_id);
        if(snapshot?.artifact) {
          const decision=reconcileMaterialityAndStaleness({
            changedDependencyRefs:(prep.dependencies || []).map((dep)=>dep.aggregate_ref),
            componentDependencies:snapshot.componentDependencies || [],
            allComponentIds:snapshot.componentIds || [],
          });
          if(decision.material) {
            await preparationRepository.applyMaterialityDecision({
              workspaceId:prep.workspace.workspace_id,
              artifactVersionId:snapshot.artifact.artifact_version_id,
              expectedStateVersion:snapshot.workspace.state_version,
              decision,correlationId,causationId:null,
            });
          }
        }
      }
      results.push(Object.freeze({
        classId:klass.class_id,live:false,workspaceChanged:Boolean(prep?.changed),
        workspaceId:prep?.workspace?.workspace_id || null,
      }));
    }
    return Object.freeze(results);
  }

  async function authorizeOvertime(user,classId,input={}) {
    const live=await repository.assertLiveContextCurrent(user.id,classId);
    const context=live.context;
    if(!context?.session || context.session.lifecycle_state!=='ACTIVE') fail('Overtime requires an active Controller.','TEACHING_D11_CONTROLLER_NOT_ACTIVE',409);
    if(!live.ok) fail('Controller is stale against authoritative state.','TEACHING_D11_STALE_LIVE_CONTEXT',409,live);
    if(context.session.instructional_substate==='BREAK') fail('Overtime cannot be authorized during Break.','TEACHING_D11_OVERTIME_BREAK_FORBIDDEN',409);
    if(context.session.overtime_ceiling_at) fail('Overtime ceiling is already fixed and cannot be reset or extended.','TEACHING_D11_OVERTIME_ALREADY_FIXED',409);
    const ceiling=computeOvertimeCeiling({
      scheduledEndAt:context.classRow.scheduled_end_at,
      requestedMinutes:Number(input.minutes),
      serverNow:clock(),
    });
    const now=clock();
    const start=now.getTime()>=new Date(context.classRow.scheduled_end_at).getTime()?now:null;
    const eventId='d11-class-overtime-ceiling:'+context.session.class_session_id+':'+ceiling;
    const changed=await withTransaction(async(tx)=>{
      const result=await repository.transitionUsing(tx,{
        studentId:user.id,classId,expectedVersion:Number(input.expectedVersion),
        toState:context.session.instructional_substate,lifecycleState:'ACTIVE',
        reason:'Deterministic overtime ceiling authorized',actionKind:'OVERTIME_AUTHORIZED',
        safeMetadata:{absolute_ceiling_minutes:15,requested_minutes:Number(input.minutes)},
        extraUpdates:{overtime_ceiling_at:ceiling,...(start?{overtime_started_at:start}:{})},
      });
      await dueEventStore.enqueueUsing(tx.query.bind(tx),scheduledEvent({
        eventType:TEACHING_EVENTS.CLASS_END_DUE,eventId,studentId:user.id,classId,
        aggregateVersion:Number(context.classRow.schedule_version),dueAt:ceiling,
        payload:{
          class_id:classId,class_session_id:result.session.class_session_id,kind:'OVERTIME_CEILING',
          schedule_version:Number(context.classRow.schedule_version),
        },
        provenanceRefs:['class:'+classId],
      }));
      return result;
    });
    return publicContext({...context,session:changed.session});
  }

  async function markOvertimeStarted(user,classId,input={}) {
    const context=await repository.getClassContext(user.id,classId);
    if(!context?.session||context.session.lifecycle_state!=='ACTIVE') fail('Overtime start requires an active Controller.','TEACHING_D11_CONTROLLER_NOT_ACTIVE',409);
    if(!context.session.overtime_ceiling_at) fail('Overtime has not been authorized.','TEACHING_D11_OVERTIME_NOT_AUTHORIZED',409);
    const now=clock();
    if(now.getTime()<new Date(context.classRow.scheduled_end_at).getTime()) fail('Overtime cannot start before scheduled Class end.','TEACHING_D11_OVERTIME_START_EARLY',409);
    if(now.getTime()>new Date(context.session.overtime_ceiling_at).getTime()) fail('Overtime ceiling has elapsed.','TEACHING_D11_OVERTIME_WINDOW_EXPIRED',409);
    if(context.session.overtime_started_at) return publicContext(context);
    const changed=await withTransaction((tx)=>repository.transitionUsing(tx,{
      studentId:user.id,classId,expectedVersion:Number(input.expectedVersion),
      toState:context.session.instructional_substate,lifecycleState:'ACTIVE',
      reason:'Scheduled end reached; authorized overtime entered',actionKind:'OVERTIME_STARTED',
      safeMetadata:{overtime_ceiling_at:context.session.overtime_ceiling_at},
      extraUpdates:{overtime_started_at:now},
    }));
    return publicContext({...context,session:changed.session});
  }

  async function closeClassInternal(user,classId,input={}, { systemForce = false } = {}) {
    let context=await repository.getClassContext(user.id,classId);
    if(!context?.session) fail('Controller has not started.','TEACHING_D11_CONTROLLER_NOT_STARTED',409);
    if(context.session.lifecycle_state==='CLOSED') {
      const closure=await repository.getClosureFact(user.id,classId);
      return Object.freeze({...publicContext(context),closureFact:closure,idempotent:true});
    }
    const now=clock();
    const beforeScheduledEnd=now.getTime()<new Date(context.classRow.scheduled_end_at).getTime();
    const readiness=earlyClosureReadiness({
      blueprintPayload:context.blueprint?.blueprint_payload || {},
      progressState:context.session.progress_state || {},
    });
    if(beforeScheduledEnd && !readiness.allowed && !systemForce) {
      fail('Early Closure requires completed core objectives and required independent evidence.','TEACHING_D11_EARLY_CLOSE_NOT_READY',409,readiness);
    }
    if(systemForce===false && input.force===true) {
      fail('Client input cannot force a Class Closure or bypass early-closure evidence gates.','TEACHING_D11_CLIENT_FORCE_FORBIDDEN',403);
    }

    const stableEventId='d11-class-ended:'+context.session.class_session_id;
    const committed=await withTransaction(async(tx)=>{
      const closure=await repository.commitClosureUsing(tx,{
        studentId:user.id,classId,expectedVersion:Number(input.expectedVersion),
        reason:String(input.reason || (beforeScheduledEnd?'EARLY_CORE_EVIDENCE_SATISFIED':'CONTROLLER_CLOSURE')),
        sourceEventRef:input.sourceEventRef || null,
        idempotencyKey:input.idempotencyKey || stableEventId,
      });
      await outboxStore.appendUsing(tx.query.bind(tx),{
        eventId:stableEventId,
        schemaVersion:1,
        eventType:TEACHING_EVENTS.CLASS_ENDED,
        eventCategory:EVENT_CATEGORIES.COMMITTED_DOMAIN_EVENT,
        triggerType:'committed_domain_event',
        source:'teaching.d11',
        origin:'d11',
        actorId:user.id,
        aggregateType:'CLASS_SESSION',
        aggregateId:closure.session.class_session_id,
        aggregateVersion:Number(closure.session.state_version),
        occurredAt:new Date(closure.closureFact.closed_at).toISOString(),
        effectiveAt:new Date(closure.closureFact.closed_at).toISOString(),
        dueAt:null,
        correlationId:stableEventId,
        causationId:input.sourceEventRef || null,
        idempotencyKey:stableEventId,
        payload:{
          student_id:user.id,
          course_id:context.classRow.course_id,
          class_id:classId,
          class_session_id:closure.session.class_session_id,
          closure_fact_id:closure.closureFact.closure_fact_id,
        },
        auditRefs:[],
        provenanceRefs:['class-closure:'+closure.closureFact.closure_fact_id],
      });
      return closure;
    });
    context=await repository.getClassContext(user.id,classId);
    return Object.freeze({...publicContext({...context,session:committed.session}),closureFact:committed.closureFact,idempotent:committed.idempotent});
  }

  async function closeClass(user,classId,input={}) {
    return closeClassInternal(user,classId,input,{systemForce:false});
  }

  async function handleClassEndDue(event) {
    const studentId=canonicalEventField(event,'actorId','actor_id') || event?.payload?.student_id;
    const classId=event?.payload?.class_id || canonicalEventField(event,'aggregateId','aggregate_id');
    const eventId=canonicalEventField(event,'eventId','event_id');
    const idempotencyKey=canonicalEventField(event,'idempotencyKey','idempotency_key');
    const context=await repository.getClassContext(studentId,classId);
    if(!context?.session) return Object.freeze({idempotent:true,reason:'CONTROLLER_NOT_STARTED'});
    if(context.session.lifecycle_state==='CLOSED') return Object.freeze({idempotent:true,reason:'ALREADY_CLOSED'});
    const now=clock();
    const scheduledEnd=new Date(context.classRow.scheduled_end_at);
    const ceiling=context.session.overtime_ceiling_at?new Date(context.session.overtime_ceiling_at):null;
    if(event?.payload?.kind!=='OVERTIME_CEILING' && ceiling && ceiling.getTime()>now.getTime()) {
      if(!context.session.overtime_started_at && now.getTime()>=scheduledEnd.getTime()) {
        await markOvertimeStarted({id:studentId},classId,{expectedVersion:context.session.state_version});
      }
      return Object.freeze({deferred:true,overtimeCeilingAt:ceiling.toISOString()});
    }
    return closeClassInternal({id:studentId},classId,{
      expectedVersion:context.session.state_version,
      reason:event?.payload?.kind==='OVERTIME_CEILING'?'OVERTIME_CEILING_REACHED':'SCHEDULED_CLASS_END',
      sourceEventRef:eventId,idempotencyKey,
    },{systemForce:true});
  }

  async function processClassClosureArtifacts(event) {
    const studentId=event?.payload?.student_id || canonicalEventField(event,'actorId','actor_id');
    const classId=event?.payload?.class_id;
    const closure=await repository.getClosureFact(studentId,classId);
    if(!closure) fail('Committed Class closure fact is missing.','TEACHING_D11_CLOSURE_FACT_MISSING',409);
    const context=await repository.closureContext(studentId,classId);
    const summaryKey='d11-class-summary:'+closure.closure_fact_id;
    const noteKey='d11-teacher-note:'+closure.closure_fact_id;

    let summaryState='ROUTE_HELD';
    let summaryPayload={fact_pack_ref:closure.closure_fact_id,translation_pending:true};
    let summaryProvenance={route_qualification:'UNQUALIFIED_UNTIL_D30',translation_only:true};
    let noteState='ROUTE_HELD';
    let notePayload={fact_pack_ref:closure.closure_fact_id,planning_note_pending:true};
    let noteProvenance={route_qualification:'UNQUALIFIED_UNTIL_D30'};

    if(intelligence) {
      let closureAnalysis=null;
      try {
        const analyzed=await intelligence.analyzeClosure({
          context,
          closureFact:closure,
          requestKey:'d11-closure-analysis:'+closure.closure_fact_id,
        });
        if(analyzed?.accepted && analyzed.validatedResult?.output) {
          closureAnalysis=analyzed.validatedResult.output;
        }
      } catch (_) {
        closureAnalysis=null;
      }
      try {
        const translated=await intelligence.translateSummary({context,closureFact:closure,requestKey:summaryKey});
        if(translated?.accepted && translated.validatedResult?.output) {
          summaryState='TRANSLATED';
          summaryPayload=translated.validatedResult.output;
          summaryProvenance={
            execution_id:translated.executionId || null,
            capability_id:'teaching.lesson.student_facing_class_summary_generation',
            prompt_family_id:'TPF-19',
            translation_only:true,
          };
        } else summaryState='REVIEW_NEEDED';
      } catch(error) {
        summaryState='REVIEW_NEEDED';
        summaryProvenance={...summaryProvenance,safe_failure_code:error?.code || 'TEACHING_D11_SUMMARY_TRANSLATION_FAILED'};
      }
      try {
        const note=await intelligence.writeTeacherNote({context,closureFact:closure,closureAnalysis,requestKey:noteKey});
        if(note?.accepted && note.validatedResult?.output) {
          noteState='PRIVATE_NOTE';
          notePayload=note.validatedResult.output;
          noteProvenance={
            execution_id:note.executionId || null,
            capability_id:'teaching.lesson.internal_post_class_teacher_note_generation',
            prompt_family_id:'TPF-09',
          };
        } else noteState='REVIEW_NEEDED';
      } catch(error) {
        noteState='REVIEW_NEEDED';
        noteProvenance={...noteProvenance,safe_failure_code:error?.code || 'TEACHING_D11_TEACHER_NOTE_FAILED'};
      }
    }

    const [summary,teacherNote]=await Promise.all([
      repository.persistSummary({
        studentId,classId,classSessionId:closure.class_session_id,closureFactId:closure.closure_fact_id,
        state:summaryState,payload:summaryPayload,provenance:summaryProvenance,idempotencyKey:summaryKey,
      }),
      repository.persistTeacherNote({
        studentId,courseId:closure.course_id,classId,classSessionId:closure.class_session_id,closureFactId:closure.closure_fact_id,
        state:noteState,payload:notePayload,provenanceRefs:['class-closure:'+closure.closure_fact_id],
        generationProvenance:noteProvenance,idempotencyKey:noteKey,
      }),
    ]);
    return Object.freeze({
      accepted:true,
      classSummaryId:summary.class_summary_id,
      teacherNoteId:teacherNote.teacher_note_id,
      modelRouteQualification:intelligence?'INJECTED_FOR_VALIDATED_EXECUTION':'UNQUALIFIED_UNTIL_D30',
    });
  }

  async function getSummary(user,classId) {
    const summary=await repository.latestSummary(user.id,classId);
    if(!summary) fail('Class Summary not found.','TEACHING_D11_SUMMARY_NOT_FOUND',404);
    return Object.freeze({
      classSummaryId:summary.class_summary_id,classId:summary.class_id,versionNo:Number(summary.version_no),
      state:summary.summary_state,payload:summary.summary_payload,createdAt:summary.created_at,translationOnly:true,
    });
  }

  async function getTeacherNote(user,classId) {
    const note=await repository.latestTeacherNote(user.id,classId);
    if(!note) fail('Teacher Note not found.','TEACHING_D11_TEACHER_NOTE_NOT_FOUND',404);
    return Object.freeze({
      teacherNoteId:note.teacher_note_id,classId:note.class_id,versionNo:Number(note.version_no),
      state:note.note_state,payload:note.note_payload,provenanceRefs:note.provenance_refs,createdAt:note.created_at,
      visibility:'PRIVATE_INTERNAL',gradebookOwner:false,skmOwner:false,behaviorLedger:false,
    });
  }

  return Object.freeze({
    getClass,
    prepareLesson,
    preparationStep,
    handlePreparationEvent,
    replanLesson,
    startController,
    transition,
    advanceInstructionCycle,
    setEvidenceDescriptor,
    recordProgress,
    startBreak,
    resumeBreakFromDueEvent,
    refreshCoursePreparation,
    authorizeOvertime,
    markOvertimeStarted,
    closeClass,
    handleClassEndDue,
    processClassClosureArtifacts,
    getSummary,
    getTeacherNote,
    publicContext,
    blueprintCurrentForContext,
  });
}

module.exports={createD11Service,scheduledEvent,expectedFromContext};
