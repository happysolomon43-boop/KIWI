'use strict';

// D09 core feasibility/commit is deterministic. These request builders expose
// only the frozen model-eligible advisory seams for later D30 qualification;
// D09 does not require them in order to produce or validate a timetable.
function schedulingRequest({course,context,taskMode='initial_timetable_proposal'}={}) {
  const capabilityByMode={
    initial_timetable_proposal:'teaching.scheduling.initial_timetable_proposal',
    instructional_load_estimation:'teaching.scheduling.instructional_load_estimation',
    schedule_debt_interpretation:'teaching.scheduling.schedule_debt_interpretation',
    ahead_of_schedule_response_planning:'teaching.scheduling.ahead_of_schedule_response_planning',
    behind_schedule_cause_diagnosis:'teaching.scheduling.behind_schedule_cause_diagnosis',
    recovery_option_proposal:'teaching.scheduling.recovery_option_proposal',
    multi_course_workload_arbitration:'teaching.scheduling.multi_course_workload_arbitration',
    rolling_planning_horizon_adjustment:'teaching.scheduling.rolling_planning_horizon_adjustment',
  };
  const capabilityId=capabilityByMode[taskMode];
  if(!capabilityId) throw new TypeError('Unsupported D09 scheduling task mode: '+taskMode);
  const promptFamilyId=taskMode==='rolling_planning_horizon_adjustment'?'TPF-05':'TPF-10';
  const promptFamilyVersion=promptFamilyId==='TPF-10'?'1.1':'1.3';
  return {
    trigger:{type:'background_analysis',ref:'course:'+course.course_id+':'+taskMode,source:'teaching.d09',actor_id:course.student_id},
    capabilityId,
    stateReference:{aggregate_type:'teaching_course',aggregate_id:course.course_id,state_version:String(course.state_version)},
    preconditions:{semester_id:context.semester?.semester_id||null,profile_version:context.profile?.version_no||null},
    provenanceRefs:(context.courses||[]).map((b)=>'course-plan:'+b.plan.course_plan_id),
    resultContract:{output_schema_id:'d09.scheduling-advisory.v1',output_schema_version:'1',validator_ids:['schema','deterministic_feasibility','state_revalidation']},
    taskMode,
    directive:{
      bounded_actions:['produce a provisional scheduling interpretation/proposal only'],
      allowed_operations:['return advisory candidate output for deterministic Scheduler validation'],
      prohibited_operations:['commit timetable','violate hard constraints','delete required curriculum','select provider or model','claim Attendance or SKM truth'],
      downstream_handoff:{type:'validated_candidate',commit_owner_boundary:'Scheduler/Calendar'},
    },
    contextSpec:{authoritative_refs:(context.courses||[]).map((b)=>({ref:'course-plan:'+b.plan.course_plan_id})),provenance_refs:[],untrusted_refs:[],context_kind:'scheduling',access_purpose:'bounded_schedule_advisory'},
    academicInput:{semester_ref:context.semester?.semester_id||null,profile_ref:context.profile?.profile_id||null,deterministic_feasibility_remains_authoritative:true},
    outputSchema:{id:'d09.scheduling-advisory.v1',version:'1',validate:async(out)=>({ok:Boolean(out&&typeof out==='object'&&!Array.isArray(out)),value:out,reason:'TEACHING_D09_ADVISORY_SCHEMA_INVALID'})},
    declaredAuthorityLevel:['schedule_debt_interpretation','behind_schedule_cause_diagnosis','instructional_load_estimation'].includes(taskMode)?'T2':'T3',
    commit:false,
    promptFamilyId,promptFamilyVersion,
  };
}
function createD09Intelligence({orchestrator}={}) {
  if(!orchestrator||typeof orchestrator.execute!=='function') throw new TypeError('D09 intelligence requires Teaching Orchestrator.');
  return Object.freeze({execute:(args)=>orchestrator.execute(schedulingRequest(args))});
}
module.exports={schedulingRequest,createD09Intelligence};
