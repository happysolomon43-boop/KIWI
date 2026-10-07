'use strict';

const { getCapability } = require('../capability-registry');
const { TPF10_INSTRUCTIONAL_LOAD_RESPONSE_SCHEMA } = require('./tpf10-provider-schema');

const LOAD_OUTPUT_STATUSES = new Set([
  'ok',
  'insufficient_context',
  'state_conflict',
  'deterministic_feasibility_required',
  'impossible_or_overcommitted',
  'policy_block',
  'review_required',
]);

const STRUCTURAL_UNCERTAINTY_STATES = Object.freeze([
  'INSUFFICIENT_EVIDENCE',
  'UNRESOLVED_CONFLICT',
  'REVIEW_NEEDED',
]);

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

function expectedStateRef(course) {
  return `course:${course.course_id}:state:${course.state_version}`;
}

function withSchedulerValidationInvariant(output) {
  if (!output?.validation_and_handoff || typeof output.validation_and_handoff !== 'object' || Array.isArray(output.validation_and_handoff)) return output;
  if (typeof output.validation_and_handoff.deterministic_scheduler_validation_required !== 'boolean') return output;
  if (output.validation_and_handoff.deterministic_scheduler_validation_required === true) return output;
  return {
    ...output,
    validation_and_handoff: {
      ...output.validation_and_handoff,
      // This is a runtime-owned authority invariant, not a model judgment.
      // TPF-10 may estimate demand, but D09 always performs deterministic
      // Scheduler validation before any timetable can be persisted.
      deterministic_scheduler_validation_required: true,
    },
  };
}

function validateLoadEstimationOutput(output, targets, course = null) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return { ok: false, reason: 'TEACHING_D09_LOAD_OUTPUT_INVALID' };
  if (!LOAD_OUTPUT_STATUSES.has(String(output.status || ''))) return { ok: false, reason: 'TEACHING_D09_LOAD_STATUS_INVALID' };
  if (String(output.capability_id || '') !== 'teaching.scheduling.instructional_load_estimation') return { ok: false, reason: 'TEACHING_D09_LOAD_CAPABILITY_INVALID' };
  if (String(output.task_mode || '') !== 'instructional_load_estimation') return { ok: false, reason: 'TEACHING_D09_LOAD_TASK_MODE_INVALID' };
  if (course && String(output.input_state_reference || '') !== expectedStateRef(course)) return { ok: false, reason: 'TEACHING_D09_LOAD_STATE_REFERENCE_INVALID' };
  if (!Array.isArray(output.review_reasons) || typeof output.review_required !== 'boolean') return { ok: false, reason: 'TEACHING_D09_LOAD_REVIEW_FIELDS_INVALID' };
  if (output.status !== 'ok' || output.review_required === true) return { ok: false, reason: 'TEACHING_D09_LOAD_ESTIMATION_REVIEW_REQUIRED' };
  if (!output.planning_scope || !output.constraints || !output.proposal || !output.inactivity_interpretation || !output.validation_and_handoff) return { ok: false, reason: 'TEACHING_D09_LOAD_CANONICAL_FIELDS_REQUIRED' };
  if (output.capacity_analysis?.recovery_headroom?.invented_numeric_headroom !== false) return { ok: false, reason: 'TEACHING_D09_LOAD_HEADROOM_AUTHORITY_VIOLATION' };
  if (output.inactivity_interpretation.misconduct_inference_made !== false || output.inactivity_interpretation.attendance_outcome_made !== false) return { ok: false, reason: 'TEACHING_D09_LOAD_INACTIVITY_AUTHORITY_VIOLATION' };
  if (typeof output.validation_and_handoff.deterministic_scheduler_validation_required !== 'boolean') return { ok: false, reason: 'TEACHING_D09_LOAD_SCHEDULER_VALIDATION_FIELD_INVALID' };
  const candidate = withSchedulerValidationInvariant(output);
  const estimates = candidate.capacity_analysis?.instructional_load_estimates;
  if (!Array.isArray(estimates)) return { ok: false, reason: 'TEACHING_D09_LOAD_ESTIMATES_REQUIRED' };
  const expected = new Set(targets.map((target) => target.scope_ref));
  const seen = new Set();
  for (const estimate of estimates) {
    const ref = String(estimate?.scope_ref || '');
    if (!expected.has(ref) || seen.has(ref)) return { ok: false, reason: 'TEACHING_D09_LOAD_SCOPE_INVALID' };
    seen.add(ref);
    const range = estimate?.effort_range || {};
    const min = Number(range.min), max = Number(range.max);
    if (range.unit !== 'minutes' || !Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) return { ok: false, reason: 'TEACHING_D09_LOAD_RANGE_INVALID' };
    if (!Array.isArray(estimate.estimate_basis) || !['low','medium','high'].includes(String(estimate.uncertainty || ''))) return { ok: false, reason: 'TEACHING_D09_LOAD_PROVENANCE_INVALID' };
  }
  if ([...expected].some((ref) => !seen.has(ref))) return { ok: false, reason: 'TEACHING_D09_LOAD_ESTIMATE_OMITTED' };
  return { ok: true, value: candidate };
}

function structuralOutputSchema({ id, validate, taskMode }) {
  const declaredFields = taskMode === 'instructional_load_estimation'
    ? [
        'status',
        'input_state_reference',
        'capability_id',
        'task_mode',
        'review_required',
        'review_reasons',
        'planning_scope',
        'constraints',
        'capacity_analysis',
        'proposal',
        'inactivity_interpretation',
        'validation_and_handoff',
        'confidence',
      ]
    : ['status', 'review_required'];
  return Object.freeze({
    id,
    version: '1',
    validate,
    uncertainty_states: STRUCTURAL_UNCERTAINTY_STATES,
    review_needed_field: 'review_required',
    // TPF-10 status/review flags describe an advisory candidate. They do not
    // mutate LearningEvidence or any authoritative aggregate state. Marking
    // them state-bearing incorrectly trips the global T2 no-evidence-mutation
    // guard after a model result has otherwise validated successfully.
    state_bearing_fields: Object.freeze(taskMode === 'instructional_load_estimation' ? [] : ['status', 'review_required']),
    student_facing_field: null,
    declared_fields: Object.freeze(declaredFields),
  });
}

// D09 core feasibility/commit is deterministic. These request builders expose
// only frozen model-eligible advisory seams. The Scheduler remains authoritative
// for feasibility, placement, persistence, activation and recovery.
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
  const capability=getCapability(capabilityId);
  const promptFamilyId=taskMode==='rolling_planning_horizon_adjustment'?'TPF-05':'TPF-10';
  const promptFamilyVersion=promptFamilyId==='TPF-10'?'1.1':'1.3';
  const targets=taskMode==='instructional_load_estimation'?loadTargets(context):Object.freeze([]);
  const validate=taskMode==='instructional_load_estimation'
    ? async(out)=>validateLoadEstimationOutput(out,targets,course)
    : async(out)=>({ok:Boolean(out&&typeof out==='object'&&!Array.isArray(out)),value:out,reason:'TEACHING_D09_ADVISORY_SCHEMA_INVALID'});
  const outputSchemaId=taskMode==='instructional_load_estimation'?'tpf10.instructional-load-estimation':'d09.scheduling-advisory.v1';
  const triggerType=taskMode==='instructional_load_estimation'?'authenticated_input':'background_analysis';
  const request={
    trigger:{type:triggerType,ref:'course:'+course.course_id+':'+taskMode,source:'teaching.d09',actor_id:course.student_id},
    capabilityId,
    stateReference:{aggregate_type:'teaching_course',aggregate_id:course.course_id,state_version:String(course.state_version)},
    preconditions:{lifecycle_state:course.lifecycle_state,subject_snapshot_ref:course.subject_snapshot_ref||null},
    provenanceRefs:(context.courses||[]).map((b)=>'course-plan:'+b.plan.course_plan_id),
    resultContract:{output_schema_id:outputSchemaId,output_schema_version:'1',validator_ids:['schema','domain','provenance','state_revalidation']},
    taskMode,
    directive:{
      bounded_actions:['produce a provisional scheduling interpretation/proposal only'],
      allowed_operations:['return advisory candidate output for deterministic Scheduler validation'],
      prohibited_operations:['commit timetable','violate hard constraints','delete required curriculum','select provider or model','claim Attendance or SKM truth'],
      evidence_purpose:taskMode,
      downstream_handoff:{
        type:'validated_candidate',
        validator_ids:['schema','domain','provenance','state_revalidation'],
        commit_owner_boundary:capability.authoritative_owner_boundary,
      },
    },
    contextSpec:{authoritative_refs:[{ref:'course:'+course.course_id}],provenance_refs:[],untrusted_refs:[],context_kind:'scheduling',access_purpose:'bounded_schedule_advisory'},
    academicInput:taskMode==='instructional_load_estimation'
      ? {
          state_reference:{aggregate_type:'teaching_course',aggregate_id:course.course_id,state_version:String(course.state_version)},
          canonical_output_input_state_reference:expectedStateRef(course),
          semester_ref:context.semester?.semester_id||null,
          timezone:context.semester?.timezone||null,
          task_mode:'instructional_load_estimation',
          estimate_only_these_learning_units:targets,
          effort_unit_required:'minutes',
          estimate_true_learning_demand_not_calendar_fit:true,
          minimum_safe_instructional_load_is_academic_not_calendar_derived:true,
          deterministic_feasibility_remains_authoritative:true,
          runtime_owned_output_invariants:{
            deterministic_scheduler_validation_required:true,
          },
          do_not_commit_or_place_classes:true,
        }
      : {semester_ref:context.semester?.semester_id||null,profile_ref:context.profile?.profile_id||null,deterministic_feasibility_remains_authoritative:true},
    outputSchema:structuralOutputSchema({id:outputSchemaId,validate,taskMode}),
    declaredAuthorityLevel:['schedule_debt_interpretation','behind_schedule_cause_diagnosis','instructional_load_estimation'].includes(taskMode)?'T2':'T3',
    commit:false,
    promptFamilyId,promptFamilyVersion,
  };
  if(triggerType==='background_analysis')request.idempotencyKey=`d09:${course.course_id}:${taskMode}:${course.state_version}`;
  if(taskMode==='instructional_load_estimation'){
    request.generation={maxOutputTokens:12_000,structuredOutput:{schema:TPF10_INSTRUCTIONAL_LOAD_RESPONSE_SCHEMA}};
    request.schemaValidator=validate;
    request.domainValidator=validate;
    request.provenanceValidator=async(out)=>{
      const refs=new Set(targets.map((target)=>target.scope_ref));
      return {ok:(out?.capacity_analysis?.instructional_load_estimates||[]).every((estimate)=>refs.has(String(estimate.scope_ref||''))),reason:'TEACHING_D09_LOAD_PROVENANCE_INVALID'};
    };
  }
  return request;
}
function createD09Intelligence({orchestrator}={}) {
  if(!orchestrator||typeof orchestrator.execute!=='function') throw new TypeError('D09 intelligence requires Teaching Orchestrator.');
  return Object.freeze({execute:(args)=>orchestrator.execute(schedulingRequest(args))});
}
module.exports={loadTargets,withSchedulerValidationInvariant,validateLoadEstimationOutput,schedulingRequest,createD09Intelligence};
