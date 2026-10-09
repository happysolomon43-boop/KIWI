'use strict';

const { getCapability } = require('../capability-registry');
const { classClosureTranslation } = require('../d14/fact-pack');
const {
  validateLessonBlueprintProposal,
  validateLiveReplanProposal,
  reserveBounds,
} = require('./contracts');

// D11 repository records originate in PostgreSQL. node-postgres materializes
// timestamptz columns as Date instances; these are trusted data values, but the
// Teaching prompt serializer deliberately accepts plain JSON only. Convert
// timestamps at this D11 feature boundary rather than weakening the shared
// prompt serializer or JSON-stringifying arbitrary object prototypes.
function normalizeD11AcademicInput(input) {
  const active=new Set();
  function invalid(reason) {
    const error=new TypeError('D11 academic input contains a value that cannot safely enter the model prompt.');
    error.code='TEACHING_D11_ACADEMIC_INPUT_UNSERIALIZABLE';
    error.reason=reason;
    throw error;
  }
  function convert(value,depth=0) {
    if(depth>16) invalid('DEPTH_LIMIT');
    if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number') return value;
    if(value instanceof Date) {
      if(!Number.isFinite(value.getTime())) invalid('INVALID_TIMESTAMP');
      return value.toISOString();
    }
    if(typeof value!=='object') invalid('UNSUPPORTED_VALUE');
    if(active.has(value)) invalid('CIRCULAR_REFERENCE');
    if(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)
      invalid('NON_JSON_OBJECT');
    active.add(value);
    try {
      if(Array.isArray(value)){
        const output=[];
        for(let i=0;i<value.length;i+=1) {
          if(!Object.hasOwn(value,i)) invalid('SPARSE_ARRAY');
          output.push(convert(value[i],depth+1));
        }
        if(Reflect.ownKeys(value).some(k=>k!=='length'&&(!Number.isInteger(Number(k))||Number(k)<0||Number(k)>=value.length||String(Number(k))!==String(k))))
          invalid('ARRAY_EXTRA_PROPERTY');
        return output;
      }
      const output={};
      for(const key of Reflect.ownKeys(value)) {
        if(typeof key!=='string')invalid('SYMBOL_PROPERTY');
        const descriptor=Object.getOwnPropertyDescriptor(value,key);
        if(!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))invalid('NON_DATA_PROPERTY');
        if(descriptor.value!==undefined) output[key]=convert(descriptor.value,depth+1);
      }
      return output;
    } finally { active.delete(value); }
  }
  if(input===null||typeof input!=='object'||Array.isArray(input))invalid('ROOT_NOT_OBJECT');
  return convert(input);
}

function ownerFor(capabilityId) {
  return getCapability(capabilityId).authoritative_owner_boundary;
}

function schema(id, declaredFields, validate) {
  return Object.freeze({
    id,
    version: '1',
    uncertainty_states: Object.freeze(['INSUFFICIENT_EVIDENCE','UNRESOLVED_CONFLICT','REVIEW_NEEDED']),
    review_needed_field: 'review_required',
    declared_fields: Object.freeze(declaredFields),
    validate,
  });
}

function baseRequest({
  capabilityId,
  taskMode,
  context,
  contextSpec,
  academicInput,
  outputSchema,
  provenanceRefs,
  declaredAuthorityLevel,
  validators,
  requestKey,
  preparation = null,
  repairFeedback = null,
}) {
  return {
    trigger: {
      type: 'workflow_continuation',
      ref: 'class:' + context.classRow.class_id + ':' + taskMode,
      source: 'teaching.d11',
      actor_id: context.classRow.student_id,
    },
    capabilityId,
    declaredAuthorityLevel,
    idempotencyKey: String(requestKey || (context.classRow.class_id + ':' + taskMode + ':' + (context.session?.state_version ?? context.classRow.schedule_version))),
    correlationId: String(requestKey || (context.classRow.class_id + ':' + taskMode + ':' + (context.session?.state_version ?? context.classRow.schedule_version))),
    stateReference: {
      aggregate_type: 'teaching_class_controller',
      aggregate_id: context.classRow.class_id,
      state_version: String(context.session?.state_version ?? context.classRow.schedule_version),
    },
    preconditions: {
      course_lifecycle_state: context.classRow.course_lifecycle_state,
      course_state_version: String(context.classRow.course_state_version),
      class_schedule_version: String(context.classRow.schedule_version),
      course_plan_id: context.plan?.course_plan_id || null,
      course_plan_version: context.plan?.version_no == null ? null : String(context.plan.version_no),
      controller_version: context.session?.state_version == null ? null : String(context.session.state_version),
    },
    provenanceRefs: provenanceRefs || [],
    resultContract: {
      output_schema_id: outputSchema.id,
      output_schema_version: outputSchema.version,
      validator_ids: ['schema','domain','provenance','current-state'],
    },
    taskMode,
    directive: {
      bounded_actions: ['produce only the requested provisional D11 instructional artifact from supplied authoritative context'],
      allowed_operations: ['return schema-valid provisional lesson planning, replan, closure-analysis, or translation output'],
      prohibited_operations: [
        'mutate live Controller state',
        'change Course Plan or schedule truth',
        'claim Gradebook marks or SKM mastery',
        'invent prior-Class or Work facts',
        'reveal protected active-assessment answers',
        'select provider or model',
      ],
      evidence_purpose: taskMode,
      downstream_handoff: {
        type: 'validated_candidate',
        validator_ids: ['schema','domain','provenance','current-state'],
        commit_owner_boundary: ownerFor(capabilityId),
      },
    },
    contextSpec,
    outputSchema,
    academicInput:normalizeD11AcademicInput(repairFeedback?{
      ...academicInput,
      validation_repair:Object.freeze({
        attempt:1,
        previous_validation_code:repairFeedback.reason,
        missing_field_path:repairFeedback.fieldPath||null,
        directive:'Regenerate the ENTIRE required D11 mode-specific JSON object. Repair the identified field, all other mandatory fields, objective refs and time arithmetic. Do not fabricate academic evidence; validation remains authoritative.',
      }),
    }:academicInput),
    schemaValidator: validators.schema,
    domainValidator: validators.domain,
    provenanceValidator: validators.provenance,
    preparation,
    commit: false,
  };
}

function plannerInput(context, signals) {
  return Object.freeze({
    class: Object.freeze({
      class_id: context.classRow.class_id,
      course_id: context.classRow.course_id,
      scheduled_start_at: context.classRow.scheduled_start_at,
      scheduled_end_at: context.classRow.scheduled_end_at,
      timezone: context.classRow.timezone,
      schedule_version: Number(context.classRow.schedule_version),
      timetable_version_id: context.classRow.source_timetable_version_id || null,
    }),
    course_plan: Object.freeze({
      course_plan_id: context.plan.course_plan_id,
      version_no: Number(context.plan.version_no),
      learning_units: Object.freeze(context.learningUnits.map((unit) => Object.freeze({
        learning_unit_id: unit.learning_unit_id,
        title: unit.title,
        intended_competence: unit.intended_competence,
        criticality: unit.criticality,
        foundational: unit.foundational,
        exit_conditions: unit.exit_conditions,
        metadata: unit.metadata || {},
      }))),
      prerequisite_dependencies: Object.freeze((context.learningUnitDependencies || []).map((dep)=>Object.freeze({
        dependency_id:dep.dependency_id,
        learning_unit_id:dep.learning_unit_id,
        prerequisite_learning_unit_id:dep.prerequisite_learning_unit_id,
        dependency_kind:dep.dependency_kind,
        rationale:dep.rationale || null,
      }))),
    }),
    plan_prerequisites: Object.freeze((context.planPrerequisites || []).map((item) => Object.freeze({
      prerequisite_id: item.prerequisite_id,
      prerequisite_ref: item.prerequisite_ref,
      label: item.label,
      description: item.description,
      resolution_state: item.resolution_state,
      vpk_decision_id: item.vpk_decision_id,
      policy_version: item.policy_version,
    }))),
    learning_unit_dependencies: Object.freeze((context.learningUnitDependencies || []).map((item) => Object.freeze({
      learning_unit_id: item.learning_unit_id,
      prerequisite_learning_unit_id: item.prerequisite_learning_unit_id,
      dependency_kind: item.dependency_kind,
      rationale: item.rationale,
    }))),
    diagnostic_signals: Object.freeze(signals.diagnosticSignals || []),
    validated_prior_knowledge_signals: Object.freeze(signals.validatedPriorKnowledgeSignals || []),
    pacing_signals: signals.pacingSignals || Object.freeze({source_owner:'Scheduler/Calendar',scheduleDebtEntries:Object.freeze([])}),
    governed_request_signals: Object.freeze(signals.governedRequestSignals || []),
    prior_class_facts: Object.freeze((signals.priorClassFacts || []).map((row) => Object.freeze({
      closure_fact_id: row.closure_fact_id,
      class_id: row.class_id,
      fact_pack: row.fact_pack,
      closed_at: row.closed_at,
    }))),
    prior_teacher_notes: Object.freeze((signals.teacherNotes || []).map((row) => Object.freeze({
      teacher_note_id: row.teacher_note_id,
      class_id: row.class_id,
      note_state: row.note_state,
      note_payload: row.note_payload,
      provenance_refs: row.provenance_refs,
    }))),
    correction_recovery_signals: signals.correctionRecoverySignals || {uncertainty_preserved:true},
    work_signals: signals.workSignals,
    knowledge_model_signals: signals.knowledgeModelSignals,
    active_assessment_answers_included: false,
    uncertainty_rule: 'Missing future-owner signals are UNKNOWN, never negative evidence.',
  });
}

// Give the model the precise integer-minute envelope checked by D11, rather
// than asking it to infer reserve ratios and whole minutes from timestamps.
// This is prompt input only; the authoritative validator remains independent.
function lessonBlueprintTimeBudget(context,reservePolicy) {
  const start=new Date(context.classRow.scheduled_start_at).getTime();
  const end=new Date(context.classRow.scheduled_end_at).getTime();
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start){
    const error=new Error('D11 Lesson time window is invalid.');
    error.code='TEACHING_D11_CLASS_DURATION_INVALID';throw error;
  }
  const scheduledMinutes=Math.floor((end-start)/60000);
  if(scheduledMinutes<1) {
    const error=new Error('D11 Lesson has no whole teaching minute available.');
    error.code='TEACHING_D11_CLASS_DURATION_INVALID';throw error;
  }
  const reserve=reserveBounds(scheduledMinutes,reservePolicy);
  return Object.freeze({
    scheduled_minutes:scheduledMinutes,
    adaptive_reserve_min_minutes:reserve.minimum_minutes,
    adaptive_reserve_target_minutes:reserve.target_minutes,
    adaptive_reserve_max_minutes:reserve.maximum_minutes,
    maximum_segment_minutes_total:scheduledMinutes-reserve.minimum_minutes,
    arithmetic_rule:'ALL numerical *_minutes fields MUST be JSON integer numbers, not strings, decimals, ranges, or units. adaptive_reserve_minutes MUST be an integer between min and max. sum(segments[].planned_minutes) + adaptive_reserve_minutes MUST be <= scheduled_minutes; segment minimum_safe_minutes <= segment planned_minutes. Each segment planned_minutes >= 1.',
    no_schedule_override:true
  });
}

function lessonPlanRequest({ context, signals, requestKey = null, preparation = null, reservePolicy = undefined, repairFeedback = null }) {
  const validate = async (out) => validateLessonBlueprintProposal(out, {
    learningUnits: context.learningUnits,
    scheduledStartAt: context.classRow.scheduled_start_at,
    scheduledEndAt: context.classRow.scheduled_end_at,
    ...(reservePolicy ? { reservePolicy } : {}),
  });
  const outputSchema = schema(
    'd11.lesson-blueprint',
    ['status','review_required','review_reasons','objectives','segments','adaptive_reserve_minutes',
      'stopping_conditions','prerequisite_checks','likely_misconceptions','examples','guided_work',
      'independent_evidence_opportunities','remediation_branches','homework_candidates','unresolved_items'],
    validate
  );
  const refs = [
    'course:' + context.classRow.course_id,
    'course-plan:' + context.plan.course_plan_id,
    'class:' + context.classRow.class_id,
    ...(signals.priorClassFacts || []).map((row) => 'class-closure:' + row.closure_fact_id),
    ...(signals.teacherNotes || []).map((row) => 'teacher-note:' + row.teacher_note_id),
  ];
  return baseRequest({
    capabilityId: 'teaching.lesson.pre_class_lesson_planning',
    taskMode: 'pre_class_lesson_blueprint_generation',
    context,
    contextSpec: {
      authoritative_refs: refs.slice(0,3).map((ref) => ({ ref })),
      provenance_refs: refs.slice(3).map((ref) => ({ ref })),
      untrusted_refs: [],
      context_kind: 'lesson_blueprint_planning',
      access_purpose: 'bounded_pre_class_instructional_planning',
    },
    academicInput: Object.freeze({...plannerInput(context,signals),lesson_time_budget:lessonBlueprintTimeBudget(context,reservePolicy)}),
    outputSchema,
    provenanceRefs: refs,
    declaredAuthorityLevel: 'T3',
    requestKey,
    preparation,
    repairFeedback,
    validators: {
      schema: validate,
      domain: validate,
      provenance: async (out) => {
        const allowed = new Set(context.learningUnits.map((unit) => String(unit.learning_unit_id)));
        const used = (out.objectives || []).map((objective) => String(objective.learning_unit_ref));
        return { ok: used.every((ref) => allowed.has(ref)), reason: 'TEACHING_D11_BLUEPRINT_PROVENANCE_INVALID' };
      },
    },
  });
}

function liveReplanRequest({ context, signals, remainingMinutes, requestKey = null, reservePolicy = undefined }) {
  const current = context.blueprint?.blueprint_payload || {};
  const completed = context.session?.progress_state?.completed_objective_refs || [];
  const blueprintContext = {
    learningUnits: context.learningUnits,
    scheduledStartAt: context.classRow.scheduled_start_at,
    scheduledEndAt: new Date(Date.now() + Number(remainingMinutes) * 60_000).toISOString(),
    currentBlueprint: current,
  };
  const validate = async (out) => {
    try {
      return { ok:true, value:validateLiveReplanProposal(out, {
        blueprintContext,
        remainingMinutes,
        completedObjectiveRefs: completed,
        ...(reservePolicy ? { reservePolicy } : {}),
      })};
    } catch (error) {
      return { ok:false, reason:error.code || 'TEACHING_D11_REPLAN_INVALID', message:error.message };
    }
  };
  const outputSchema = schema(
    'd11.live-replan',
    ['status','review_required','review_reasons','objectives','segments','adaptive_reserve_minutes',
      'stopping_conditions','prerequisite_checks','likely_misconceptions','examples','guided_work',
      'independent_evidence_opportunities','remediation_branches','homework_candidates','replan_basis','unresolved_items'],
    validate
  );
  const refs = [
    'class:' + context.classRow.class_id,
    'lesson-blueprint:' + context.blueprint.lesson_blueprint_id,
    'course-plan:' + context.plan.course_plan_id,
  ];
  return baseRequest({
    capabilityId:'teaching.lesson.live_lesson_replanning',
    taskMode:'live_lesson_replanning',
    context,
    contextSpec:{
      authoritative_refs:refs.map((ref)=>({ref})),
      provenance_refs:(signals.priorClassFacts || []).map((row)=>({ref:'class-closure:' + row.closure_fact_id})),
      untrusted_refs:[],
      context_kind:'live_lesson_replanning',
      access_purpose:'bounded_remaining_time_replan',
    },
    academicInput:{
      ...plannerInput(context,signals),
      current_lesson_blueprint:current,
      controller_state:{
        state_version:Number(context.session.state_version),
        instructional_substate:context.session.instructional_substate,
        progress_state:context.session.progress_state || {},
      },
      remaining_minutes:Number(remainingMinutes),
      core_protection_rule:'unfinished CORE objectives may not be silently removed; sacrifice enrichment then secondary first',
    },
    outputSchema,
    provenanceRefs:refs,
    declaredAuthorityLevel:'T3',
    requestKey,
    validators:{schema:validate,domain:validate,provenance:async()=>({ok:true})},
  });
}

function closureAnalysisRequest({ context, closureFact, requestKey = null }) {
  const validate = async (out) => {
    if (!out || typeof out !== 'object' || Array.isArray(out)) return {ok:false,reason:'TEACHING_D11_CLOSURE_ANALYSIS_SCHEMA_INVALID'};
    if (!['OK','REVIEW_NEEDED','INSUFFICIENT_EVIDENCE','UNRESOLVED_CONFLICT'].includes(String(out.status || '').toUpperCase())) {
      return {ok:false,reason:'TEACHING_D11_CLOSURE_ANALYSIS_STATUS_INVALID'};
    }
    if (Object.hasOwn(out,'mastery_state') || Object.hasOwn(out,'official_mark')) {
      return {ok:false,reason:'TEACHING_D11_CLOSURE_ANALYSIS_AUTHORITY_EXCEEDED'};
    }
    return {ok:true,value:out};
  };
  const outputSchema = schema(
    'd11.lesson-closure-analysis',
    ['status','review_required','review_reasons','completed_core','unfinished_core','evidence_observations','recovery_handoffs','uncertainty'],
    validate
  );
  return baseRequest({
    capabilityId:'teaching.lesson.lesson_closure_analysis',
    taskMode:'lesson_closure_analysis',
    context,
    contextSpec:{
      authoritative_refs:[{ref:'class-closure:' + closureFact.closure_fact_id}],
      provenance_refs:[],
      untrusted_refs:[],
      context_kind:'lesson_closure',
      access_purpose:'bounded_post_class_analysis',
    },
    academicInput:{fact_pack:closureFact.fact_pack},
    outputSchema,
    provenanceRefs:['class-closure:' + closureFact.closure_fact_id],
    declaredAuthorityLevel:'T2',
    requestKey,
    validators:{schema:validate,domain:validate,provenance:async()=>({ok:true})},
  });
}

function translationRequest({ context, closureFact, requestKey = null }) {
  const translation = classClosureTranslation(closureFact);
  const validate = async (out) => {
    if (!out || typeof out !== 'object' || Array.isArray(out)) return {ok:false,reason:'TEACHING_D11_SUMMARY_SCHEMA_INVALID'};
    if (!String(out.student_summary || '').trim()) return {ok:false,reason:'TEACHING_D11_SUMMARY_TEXT_REQUIRED'};
    if (Object.hasOwn(out,'new_mark') || Object.hasOwn(out,'mastery_update') || Object.hasOwn(out,'attendance_outcome')) {
      return {ok:false,reason:'TEACHING_D11_SUMMARY_MUTATION_FORBIDDEN'};
    }
    return {ok:true,value:out};
  };
  const outputSchema = schema(
    'd11.class-summary-translation',
    ['status','review_required','review_reasons','student_summary','completed','unfinished','next_actions','uncertainty'],
    validate
  );
  return baseRequest({
    capabilityId:'teaching.lesson.student_facing_class_summary_generation',
    taskMode:'class_summary_translation',
    context,
    contextSpec:{
      authoritative_refs:[{ref:'class-closure:' + closureFact.closure_fact_id}],
      provenance_refs:[],
      untrusted_refs:[],
      context_kind:'class_summary',
      access_purpose:'student_facing_fact_translation',
    },
    academicInput:{translation_directive:translation.directive,fact_pack:translation.factPack,translation_only:true,source_fact_pack_ref:'class-closure:' + closureFact.closure_fact_id},
    outputSchema,
    provenanceRefs:['class-closure:' + closureFact.closure_fact_id],
    declaredAuthorityLevel:'T1',
    requestKey,
    validators:{schema:validate,domain:async()=>({ok:true}),provenance:async()=>({ok:true})},
  });
}

function teacherNoteRequest({ context, closureFact, closureAnalysis = null, requestKey = null }) {
  const validate = async (out) => {
    if (!out || typeof out !== 'object' || Array.isArray(out)) return {ok:false,reason:'TEACHING_D11_TEACHER_NOTE_SCHEMA_INVALID'};
    if (Object.hasOwn(out,'official_mark') || Object.hasOwn(out,'mastery_state') || Object.hasOwn(out,'behavior_judgment')) {
      return {ok:false,reason:'TEACHING_D11_TEACHER_NOTE_AUTHORITY_EXCEEDED'};
    }
    return {ok:true,value:out};
  };
  const outputSchema = schema(
    'd11.post-class-teacher-note',
    ['status','review_required','review_reasons','observed_errors','assistance_context','independent_evidence','next_class_attention','uncertainty'],
    validate
  );
  return baseRequest({
    capabilityId:'teaching.lesson.internal_post_class_teacher_note_generation',
    taskMode:'post_class_teacher_note',
    context,
    contextSpec:{
      authoritative_refs:[{ref:'class-closure:' + closureFact.closure_fact_id}],
      provenance_refs:[],
      untrusted_refs:[],
      context_kind:'private_teacher_note',
      access_purpose:'grounded_next_class_continuity',
    },
    academicInput:{
      fact_pack:closureFact.fact_pack,
      closure_analysis:closureAnalysis,
      private_internal_note:true,
      not_gradebook:true,
      not_skm_state:true,
      not_behavior_ledger:true,
    },
    outputSchema,
    provenanceRefs:['class-closure:' + closureFact.closure_fact_id],
    declaredAuthorityLevel:'T2',
    requestKey,
    validators:{schema:validate,domain:validate,provenance:async()=>({ok:true})},
  });
}

function createD11Intelligence({ orchestrator } = {}) {
  if (!orchestrator || typeof orchestrator.execute !== 'function') throw new TypeError('D11 intelligence requires the Teaching Orchestrator.');
  return Object.freeze({
    planLesson:(args)=>orchestrator.execute(lessonPlanRequest(args)),
    replanLesson:(args)=>orchestrator.execute(liveReplanRequest(args)),
    analyzeClosure:(args)=>orchestrator.execute(closureAnalysisRequest(args)),
    translateSummary:(args)=>orchestrator.execute(translationRequest(args)),
    writeTeacherNote:(args)=>orchestrator.execute(teacherNoteRequest(args)),
  });
}

module.exports = {
  normalizeD11AcademicInput,
  plannerInput,
  lessonBlueprintTimeBudget,
  lessonPlanRequest,
  liveReplanRequest,
  closureAnalysisRequest,
  translationRequest,
  teacherNoteRequest,
  createD11Intelligence,
};
