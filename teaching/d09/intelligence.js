'use strict';

const LOAD_OUTPUT_STATUSES = new Set([
  'ok',
  'insufficient_context',
  'state_conflict',
  'deterministic_feasibility_required',
  'impossible_or_overcommitted',
  'policy_block',
  'review_required',
]);

const LOAD_ESTIMATION_PROVIDER_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    status: Object.freeze({ type: 'string', enum: Object.freeze([...LOAD_OUTPUT_STATUSES]) }),
    task_mode: Object.freeze({ type: 'string', enum: Object.freeze(['instructional_load_estimation']) }),
    review_required: Object.freeze({ type: 'boolean' }),
    review_reasons: Object.freeze({ type: 'array', items: Object.freeze({ type: 'string' }) }),
    capacity_analysis: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        instructional_load_estimates: Object.freeze({
          type: 'array',
          items: Object.freeze({
            type: 'object',
            properties: Object.freeze({
              scope_ref: Object.freeze({ type: 'string' }),
              effort_range: Object.freeze({
                type: 'object',
                properties: Object.freeze({
                  min: Object.freeze({ type: 'number' }),
                  max: Object.freeze({ type: 'number' }),
                  unit: Object.freeze({ type: 'string', enum: Object.freeze(['minutes']) }),
                }),
                required: Object.freeze(['min', 'max', 'unit']),
              }),
              estimate_basis: Object.freeze({ type: 'array', items: Object.freeze({ type: 'string' }) }),
              uncertainty: Object.freeze({ type: 'string', enum: Object.freeze(['low', 'medium', 'high']) }),
            }),
            required: Object.freeze(['scope_ref', 'effort_range', 'estimate_basis', 'uncertainty']),
          }),
        }),
      }),
      required: Object.freeze(['instructional_load_estimates']),
    }),
  }),
  required: Object.freeze(['status', 'task_mode', 'review_required', 'review_reasons', 'capacity_analysis']),
});

function unitTreatment(unit) {
  return String(unit?.metadata?.instructional_treatment || 'FULL_INSTRUCTION');
}

function loadTargets(context) {
  const targets = [];
  for (const bundle of context?.courses || []) {
    for (const unit of bundle.units || []) {
      if (unitTreatment(unit) === 'VALIDATED_PRIOR_KNOWLEDGE_NO_INITIAL_INSTRUCTION') continue;
      const max = Number(unit.instructional_load_max_minutes) || 0;
      if (max > 0) continue;
      const unitId = String(unit.learning_unit_id);
      targets.push(Object.freeze({
        scope_ref: `course:${bundle.course.course_id}:learning-unit:${unitId}`,
        course_ref: `course:${bundle.course.course_id}`,
        course_plan_ref: `course-plan:${bundle.plan.course_plan_id}:v${bundle.plan.version_no}`,
        learning_unit_ref: unitId,
        title: String(unit.title || unitId),
        intended_competence: String(unit.intended_competence || ''),
        criticality: String(unit.criticality || ''),
        foundational: unit.foundational === true,
        instructional_treatment: unitTreatment(unit),
        instructional_emphasis: unit?.metadata?.instructional_emphasis || null,
        emphasis_basis: unit?.metadata?.emphasis_basis || null,
        prerequisite_refs: Object.freeze((bundle.dependencies || [])
          .filter((edge) => String(edge.learning_unit_id) === unitId)
          .map((edge) => String(edge.prerequisite_learning_unit_id))),
        exit_conditions: unit.exit_conditions || [],
      }));
    }
  }
  return Object.freeze(targets);
}

function validateLoadEstimationOutput(output, targets) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return { ok: false, reason: 'TEACHING_D09_LOAD_OUTPUT_INVALID' };
  if (!LOAD_OUTPUT_STATUSES.has(String(output.status || ''))) return { ok: false, reason: 'TEACHING_D09_LOAD_STATUS_INVALID' };
  if (String(output.task_mode || '') !== 'instructional_load_estimation') return { ok: false, reason: 'TEACHING_D09_LOAD_TASK_MODE_INVALID' };
  if (output.status !== 'ok' || output.review_required === true) return { ok: false, reason: 'TEACHING_D09_LOAD_ESTIMATION_REVIEW_REQUIRED' };
  const estimates = output.capacity_analysis?.instructional_load_estimates;
  if (!Array.isArray(estimates)) return { ok: false, reason: 'TEACHING_D09_LOAD_ESTIMATES_REQUIRED' };
  const expected = new Set(targets.map((target) => target.scope_ref));
  const seen = new Set();
  for (const estimate of estimates) {
    const ref = String(estimate?.scope_ref || '');
    if (!expected.has(ref) || seen.has(ref)) return { ok: false, reason: 'TEACHING_D09_LOAD_SCOPE_INVALID' };
    seen.add(ref);
    const range = estimate?.effort_range || {};
    const min = Number(range.min), max = Number(range.max);
    if (range.unit !== 'minutes' || !Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) {
      return { ok: false, reason: 'TEACHING_D09_LOAD_RANGE_INVALID' };
    }
    if (!Array.isArray(estimate.estimate_basis) || !['low', 'medium', 'high'].includes(String(estimate.uncertainty || ''))) {
      return { ok: false, reason: 'TEACHING_D09_LOAD_PROVENANCE_INVALID' };
    }
  }
  if ([...expected].some((ref) => !seen.has(ref))) return { ok: false, reason: 'TEACHING_D09_LOAD_ESTIMATE_OMITTED' };
  return { ok: true, value: output };
}

// D09 core feasibility/commit is deterministic. These request builders expose
// only the frozen model-eligible advisory seams. The Scheduler remains the
// authority for feasibility, placement, persistence, activation and recovery.
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
  const targets = taskMode === 'instructional_load_estimation' ? loadTargets(context) : Object.freeze([]);
  const validate = taskMode === 'instructional_load_estimation'
    ? async (out) => validateLoadEstimationOutput(out, targets)
    : async (out) => ({ok:Boolean(out&&typeof out==='object'&&!Array.isArray(out)),value:out,reason:'TEACHING_D09_ADVISORY_SCHEMA_INVALID'});
  const outputSchemaId = taskMode === 'instructional_load_estimation'
    ? 'd09.instructional-load-estimation.v1'
    : 'd09.scheduling-advisory.v1';
  const request = {
    trigger:{type:'background_analysis',ref:'course:'+course.course_id+':'+taskMode,source:'teaching.d09',actor_id:course.student_id},
    capabilityId,
    stateReference:{aggregate_type:'teaching_course',aggregate_id:course.course_id,state_version:String(course.state_version)},
    preconditions:{semester_id:context.semester?.semester_id||null,profile_version:context.profile?.version_no||null},
    provenanceRefs:(context.courses||[]).map((b)=>'course-plan:'+b.plan.course_plan_id),
    resultContract:{output_schema_id:outputSchemaId,output_schema_version:'1',validator_ids:['schema','deterministic_feasibility','state_revalidation']},
    taskMode,
    directive:{
      bounded_actions:['produce a provisional scheduling interpretation/proposal only'],
      allowed_operations:['return advisory candidate output for deterministic Scheduler validation'],
      prohibited_operations:['commit timetable','violate hard constraints','delete required curriculum','select provider or model','claim Attendance or SKM truth'],
      evidence_purpose:taskMode,
      downstream_handoff:{type:'validated_candidate',commit_owner_boundary:'Scheduler/Calendar'},
    },
    contextSpec:{authoritative_refs:(context.courses||[]).map((b)=>({ref:'course-plan:'+b.plan.course_plan_id})),provenance_refs:[],untrusted_refs:[],context_kind:'scheduling',access_purpose:'bounded_schedule_advisory'},
    academicInput: taskMode === 'instructional_load_estimation'
      ? {
          state_reference:{aggregate_type:'teaching_course',aggregate_id:course.course_id,state_version:String(course.state_version)},
          semester_ref:context.semester?.semester_id||null,
          timezone:context.semester?.timezone||null,
          task_mode:'instructional_load_estimation',
          estimate_only_these_learning_units:targets,
          effort_unit_required:'minutes',
          estimate_true_learning_demand_not_calendar_fit:true,
          minimum_safe_instructional_load_is_academic_not_calendar_derived:true,
          deterministic_feasibility_remains_authoritative:true,
          do_not_commit_or_place_classes:true,
        }
      : {semester_ref:context.semester?.semester_id||null,profile_ref:context.profile?.profile_id||null,deterministic_feasibility_remains_authoritative:true},
    outputSchema:{id:outputSchemaId,version:'1',validate},
    declaredAuthorityLevel:['schedule_debt_interpretation','behind_schedule_cause_diagnosis','instructional_load_estimation'].includes(taskMode)?'T2':'T3',
    commit:false,
    promptFamilyId,promptFamilyVersion,
  };
  if (taskMode === 'instructional_load_estimation') {
    request.generation = {
      maxOutputTokens: 12_000,
      structuredOutput: { schema: LOAD_ESTIMATION_PROVIDER_SCHEMA },
    };
  }
  return request;
}
function createD09Intelligence({orchestrator}={}) {
  if(!orchestrator||typeof orchestrator.execute!=='function') throw new TypeError('D09 intelligence requires Teaching Orchestrator.');
  return Object.freeze({execute:(args)=>orchestrator.execute(schedulingRequest(args))});
}
module.exports={LOAD_ESTIMATION_PROVIDER_SCHEMA,loadTargets,validateLoadEstimationOutput,schedulingRequest,createD09Intelligence};
