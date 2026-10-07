'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  planningContextAt,
  extractInstructionalLoadEstimates,
  scheduleClassFacts,
  slotsForCourse,
  decorateD09Service,
} = require('../../../teaching/d09/flow-integrity-service');
const {
  loadTargets,
  validateLoadEstimationOutput,
  schedulingRequest,
} = require('../../../teaching/d09/intelligence');
const { createTeachingPromptControlPlane } = require('../../../teaching/prompt-runtime');
const { getCapability } = require('../../../teaching/capability-registry');
const { activationIntegrityBlockers } = require('../../../teaching/repositories/d10-activation-integrity');

function context() {
  return {
    semester: {
      semester_id: 'sem-1',
      state_version: 1,
      starts_at: '2026-09-25T00:00:00.000Z',
      ends_at: '2026-12-20T23:59:59.000Z',
      timezone: 'Africa/Lagos',
    },
    profile: { profile_id: 'profile-1', version_no: 1 },
    blocks: [],
    courses: [{
      course: {
        course_id: 'course-1',
        student_id: 'student-1',
        state_version: 4,
        lifecycle_state: 'DRAFT',
        subject_snapshot_ref: 'subject:s1:v2',
      },
      plan: { course_plan_id: 'plan-1', version_no: 2 },
      units: [{
        learning_unit_id: 'lu_polysaccharides',
        title: 'Polysaccharides and Energy Storage',
        intended_competence: 'Explain and compare energy-storage polysaccharides.',
        criticality: 'HIGH',
        foundational: false,
        instructional_load_min_minutes: 0,
        instructional_load_max_minutes: 0,
        exit_conditions: [{ criterion: 'Explain the storage role accurately.' }],
        metadata: { instructional_treatment: 'FULL_INSTRUCTION' },
      }],
      dependencies: [],
      coverage: [],
      scopeChanges: [],
    }],
  };
}

function canonicalOutput(target) {
  return {
    status: 'ok',
    input_state_reference: 'course:course-1:state:4',
    capability_id: 'teaching.scheduling.instructional_load_estimation',
    task_mode: 'instructional_load_estimation',
    review_required: false,
    review_reasons: [],
    planning_scope: {
      semester_ref: 'sem-1',
      course_refs: ['course:course-1'],
      time_horizon: 'remaining semester',
      timezone: 'Africa/Lagos',
      authoritative_schedule_ref: null,
    },
    constraints: {
      hard_constraints_used: [],
      soft_preferences_used: [],
      hard_deadlines: [],
      protected_periods: [],
      assumptions: [],
    },
    capacity_analysis: {
      instructional_load_estimates: [{
        scope_ref: target.scope_ref,
        effort_range: { min: 45, max: 75, unit: 'minutes' },
        estimate_basis: ['intended competence', 'criticality', 'exit evidence'],
        uncertainty: 'medium',
      }],
      recovery_headroom: {
        authoritative_status: 'not_supplied',
        model_interpretation: 'Not used to estimate true instructional demand.',
        invented_numeric_headroom: false,
      },
      schedule_debt: {
        authoritative_debt_ref: null,
        supported_causes: [],
        uncertain_causes: [],
        academic_effect: 'No debt interpretation requested.',
      },
      global_workload_risks: [],
    },
    proposal: {
      proposal_type: 'none',
      options: [],
      preferred_for_validation_option_id: null,
      preference_basis: [],
      selection_rule: 'No timetable option is selected by instructional-load estimation.',
    },
    inactivity_interpretation: {
      check_in_warranted: false,
      supported_reason: null,
      misconduct_inference_made: false,
      attendance_outcome_made: false,
    },
    validation_and_handoff: {
      deterministic_scheduler_validation_required: true,
      request_system_required: false,
      course_planner_review_required: false,
      lesson_planner_review_required: false,
      diagnostic_reentry_recommended: false,
      unresolved_dependencies: [],
    },
    confidence: 'medium',
  };
}

function structuralInvocationArgs(request, course, directive = request.directive) {
  return {
    capabilityId: request.capabilityId,
    taskMode: request.taskMode,
    directive,
    contextLanes: {
      trustedAuthoritativeState: { course_id: course.course_id, state_version: course.state_version },
      permissionConstraints: { commit_allowed: false },
      provenanceLinkedAcademicContent: {},
      untrustedContent: [],
    },
    stateReference: request.stateReference,
    outputSchema: request.outputSchema,
    audit: { correlation_id: 'd09-tpf10-handoff-regression' },
  };
}

test('D09 instructional-load estimation uses frozen TPF-10 authority and canonical output contract', async () => {
  const ctx = context();
  const targets = loadTargets(ctx);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].scope_ref, 'course:course-1:learning-unit:lu_polysaccharides');
  const request = schedulingRequest({ course: ctx.courses[0].course, context: ctx, taskMode: 'instructional_load_estimation' });
  assert.equal(request.trigger.type, 'authenticated_input');
  assert.equal(request.capabilityId, 'teaching.scheduling.instructional_load_estimation');
  assert.equal(request.promptFamilyId, 'TPF-10');
  assert.equal(request.promptFamilyVersion, '1.1');
  assert.equal(request.commit, false);
  assert.equal(request.academicInput.effort_unit_required, 'minutes');
  assert.equal(request.outputSchema.id, 'tpf10.instructional-load-estimation');
  assert.ok(request.generation.structuredOutput.schema.properties.validation_and_handoff);
  const providerSchema = request.generation.structuredOutput.schema;
  assert.deepEqual(providerSchema.properties.validation_and_handoff.properties.deterministic_scheduler_validation_required.enum, [true]);
  assert.deepEqual(providerSchema.properties.capacity_analysis.properties.recovery_headroom.properties.invented_numeric_headroom.enum, [false]);
  assert.deepEqual(providerSchema.properties.inactivity_interpretation.properties.misconduct_inference_made.enum, [false]);
  assert.deepEqual(providerSchema.properties.inactivity_interpretation.properties.attendance_outcome_made.enum, [false]);
  const output = canonicalOutput(targets[0]);
  assert.deepEqual(validateLoadEstimationOutput(output, targets, ctx.courses[0].course), { ok: true, value: output });
});

test('D09 instructional-load estimation passes the frozen D03 structural invocation boundary', () => {
  const ctx = context();
  const course = ctx.courses[0].course;
  const request = schedulingRequest({ course, context: ctx, taskMode: 'instructional_load_estimation' });
  const capability = getCapability(request.capabilityId);

  assert.equal(capability.authoritative_owner_boundary, 'Curriculum/Scheduler');
  assert.equal(request.directive.downstream_handoff.commit_owner_boundary, capability.authoritative_owner_boundary);
  assert.deepEqual(request.outputSchema.uncertainty_states, [
    'INSUFFICIENT_EVIDENCE',
    'UNRESOLVED_CONFLICT',
    'REVIEW_NEEDED',
  ]);
  assert.equal(request.outputSchema.review_needed_field, 'review_required');

  const promptControl = createTeachingPromptControlPlane();
  const invocation = promptControl.createInvocation(structuralInvocationArgs(request, course));
  assert.equal(invocation.prompt.family_id, 'TPF-10');
  assert.equal(invocation.prompt.family_version, '1.1');
  assert.equal(invocation.directive.downstream_handoff.commit_owner_boundary, 'Curriculum/Scheduler');

  const forgedDirective = {
    ...request.directive,
    downstream_handoff: {
      ...request.directive.downstream_handoff,
      commit_owner_boundary: 'Scheduler/Calendar',
    },
  };
  assert.throws(
    () => promptControl.createInvocation(structuralInvocationArgs(request, course, forgedDirective)),
    (error) => error?.code === 'TEACHING_PROMPT_HANDOFF_OWNER_MISMATCH'
  );
});

test('D09 rejects missing, zero or authority-breaking workload estimates', () => {
  const ctx = context(), targets = loadTargets(ctx), good = canonicalOutput(targets[0]);
  const zero = structuredClone(good); zero.capacity_analysis.instructional_load_estimates[0].effort_range.min = 0;
  assert.equal(validateLoadEstimationOutput(zero, targets, ctx.courses[0].course).ok, false);
  const omitted = structuredClone(good); omitted.capacity_analysis.instructional_load_estimates = [];
  assert.equal(validateLoadEstimationOutput(omitted, targets, ctx.courses[0].course).reason, 'TEACHING_D09_LOAD_ESTIMATE_OMITTED');
  const headroom = structuredClone(good); headroom.capacity_analysis.recovery_headroom.invented_numeric_headroom = true;
  assert.equal(validateLoadEstimationOutput(headroom, targets, ctx.courses[0].course).reason, 'TEACHING_D09_LOAD_HEADROOM_AUTHORITY_VIOLATION');
});

test('D09 cannot let model output disable deterministic Scheduler validation', () => {
  const ctx = context(), targets = loadTargets(ctx), output = canonicalOutput(targets[0]);
  output.validation_and_handoff.deterministic_scheduler_validation_required = false;

  const validated = validateLoadEstimationOutput(output, targets, ctx.courses[0].course);

  assert.equal(validated.ok, true);
  assert.equal(validated.value.validation_and_handoff.deterministic_scheduler_validation_required, true);
  assert.deepEqual(
    validated.value.capacity_analysis.instructional_load_estimates,
    output.capacity_analysis.instructional_load_estimates
  );
  assert.equal(output.validation_and_handoff.deterministic_scheduler_validation_required, false);
});

test('D09 converts accepted validated TPF-10 output into bounded Scheduler estimates', () => {
  const ctx = context(), targets = loadTargets(ctx), output = canonicalOutput(targets[0]);
  const estimates = extractInstructionalLoadEstimates({ accepted: true, executionId: 'exec-1', validatedResult: { output } }, ctx);
  assert.deepEqual(estimates.map((item) => [item.learningUnitId, item.minMinutes, item.maxMinutes]), [['lu_polysaccharides', 45, 75]]);
});

test('D09 floors in-progress timetable generation at authoritative server time', () => {
  const derived = planningContextAt(context(), '2026-10-05T16:00:00.000Z');
  const elapsed = derived.blocks.find((block) => block.derived_by === 'D09_SERVER_TIME_FLOOR');
  assert.ok(elapsed);
  assert.equal(elapsed.block_kind, 'HARD_UNAVAILABLE');
  assert.equal(elapsed.starts_at, '2026-09-25T00:00:00.000Z');
  assert.equal(elapsed.ends_at, '2026-10-05T16:00:00.000Z');
});

test('D09/D10 reject the production reserve-only elapsed timetable shape', () => {
  const facts = scheduleClassFacts([
    { kind:'ASSESSMENT_RESERVE', startsAt:'2026-09-25T08:00:00.000Z', endsAt:'2026-09-25T08:05:00.000Z' },
    { kind:'REVISION_RESERVE', startsAt:'2026-09-25T08:05:00.000Z', endsAt:'2026-09-25T08:10:00.000Z' },
  ], '2026-10-05T16:00:00.000Z');
  assert.deepEqual(facts, { classCount:0, futureClassCount:0, elapsedClassCount:0 });
  assert.deepEqual(activationIntegrityBlockers({
    instructionalUnitCount: 8,
    estimatedInstructionalMinutes: 0,
    totalSlotCount: 2,
    classSlotCount: 0,
    futureClassSlotCount: 0,
    elapsedSlotCount: 2,
  }), [
    'INSTRUCTIONAL_LOAD_ESTIMATION_REQUIRED',
    'TIMETABLE_REQUIRES_INSTRUCTIONAL_CLASSES',
    'TIMETABLE_ELAPSED_REPLAN_REQUIRED',
  ]);
});


test('D09 flow-integrity wrapper scopes timetable health to the requested Course', async () => {
  const base = {
    async getScheduleReview() {
      return {
        serverNow: '2026-10-05T08:00:00.000Z',
        timetable: { state: 'PROPOSED' },
        slots: [
          { courseId:'course-1', kind:'CLASS', startsAt:'2026-10-05T09:00:00.000Z', endsAt:'2026-10-05T10:00:00.000Z' },
          { courseId:'course-2', kind:'CLASS', startsAt:'2026-10-05T10:00:00.000Z', endsAt:'2026-10-05T11:00:00.000Z' },
        ],
        courseSlots: [
          { courseId:'course-1', kind:'CLASS', startsAt:'2026-10-05T09:00:00.000Z', endsAt:'2026-10-05T10:00:00.000Z' },
        ],
        scheduleHealth: {},
      };
    },
  };
  const service = decorateD09Service(base, {
    repository: {},
    transactionalMutation: { mutateAndPublish: async () => { throw new Error('not used'); } },
    randomUUID: () => '00000000-0000-4000-8000-000000000001',
    clock: () => new Date('2026-10-05T08:00:00.000Z'),
  });

  const review = await service.getScheduleReview({ id:'student-1' }, 'course-1');

  assert.equal(review.scheduleIntegrity.classCount, 1);
  assert.equal(review.scheduleIntegrity.futureClassCount, 1);
  assert.deepEqual(slotsForCourse(base.getScheduleReview ? [
    { courseId:'course-1' },
    { courseId:'course-2' },
  ] : [], 'course-1'), [{ courseId:'course-1' }]);
});

test('D09 flow-integrity proposal automatically attaches a plan-ready Course to inherited Semester availability', async () => {
  const plan = {
    course_plan_id:'plan-1',
    version_no:1,
    plan_state:'REVIEW_READY',
    source_snapshot_ref:'subject:s1:v2',
  };
  const unit = {
    learning_unit_id:'unit-1',
    instructional_load_min_minutes:60,
    instructional_load_max_minutes:60,
    metadata:{ instructional_treatment:'FULL_INSTRUCTION' },
  };
  const requestedCourse = {
    course_id:'course-1',
    lifecycle_state:'DRAFT',
    state_version:1,
    semester_id:null,
    subject_snapshot_ref:'subject:s1:v2',
  };
  const semester = {
    semester_id:'sem-1',
    state_version:1,
    starts_at:'2026-10-01T00:00:00.000Z',
    ends_at:'2026-10-31T23:59:59.000Z',
    timezone:'UTC',
  };
  const profile = {
    profile_id:'profile-1',
    version_no:1,
    semester_state_version:1,
    preferences:{ avoidConsecutiveSameCourseDays:true, preferredStartTimes:['09:00'] },
    settings:{ horizon:{ imminentDays:7, concreteDays:28 } },
  };
  const inheritedBundle = {
    course:requestedCourse,
    plan,
    units:[unit],
    dependencies:[],
    coverage:[],
    scopeChanges:[],
    semesterTimezone:'UTC',
  };
  const before = {
    course:requestedCourse,
    semester,
    profile,
    availability:[{ day_of_week:1, local_start:'09:00', local_end:'12:00', kind:'AVAILABLE' }],
    blocks:[],
    deadlines:[],
    reserves:[],
    courses:[],
    unresolvedCourses:[{ courseId:'course-1', reason:'COURSE_NOT_ATTACHED_TO_DEFAULT_SEMESTER' }],
    priorSlots:[],
    inheritedDefault:true,
    inheritedCourseBundle:inheritedBundle,
  };
  const attachedCourse = { ...requestedCourse, semester_id:'sem-1', state_version:2 };
  const after = {
    ...before,
    course:attachedCourse,
    courses:[{ ...inheritedBundle, course:attachedCourse }],
    unresolvedCourses:[],
    inheritedDefault:false,
    inheritedCourseBundle:null,
  };

  let reads=0, attachCalls=0, proposalSource=null;
  const repository = {
    async getSchedulingContext() { reads += 1; return reads === 1 ? before : after; },
    async attachCourseToSemester({ studentId, courseId, semesterId }) {
      attachCalls += 1;
      assert.equal(studentId, 'student-1');
      assert.equal(courseId, 'course-1');
      assert.equal(semesterId, 'sem-1');
      return { attached:true };
    },
    async saveProposalUsing(_tx, { result, source }) {
      proposalSource = source;
      assert.equal(result.courseSummaries.length, 1);
      return {
        timetable:{ timetable_version_id:'tt-1', version_no:1 },
        slots:[],
        feasibility:{ outcome:result.outcome },
        ppl:{ isNew:false, workspaceId:'w1', workspaceVersion:2, changedRefs:['timetable:tt-1'], targetEffectiveAt:semester.ends_at },
      };
    },
  };
  const base = {
    async getScheduleReview() {
      return {
        serverNow:'2026-09-29T04:00:00.000Z',
        timetable:{ state:'PROPOSED' },
        slots:[{ courseId:'course-1', kind:'CLASS', startsAt:'2026-10-05T09:00:00.000Z', endsAt:'2026-10-05T10:00:00.000Z' }],
        courseSlots:[{ courseId:'course-1', kind:'CLASS', startsAt:'2026-10-05T09:00:00.000Z', endsAt:'2026-10-05T10:00:00.000Z' }],
        scheduleHealth:{},
      };
    },
  };
  let id=0;
  const transactionalMutation = {
    async mutateAndPublish({ mutate, buildEvent }) {
      const result = await mutate({});
      buildEvent(result);
      return { mutationResult:result };
    },
  };
  const service = decorateD09Service(base, {
    repository,
    transactionalMutation,
    randomUUID:() => `00000000-0000-4000-8000-${String(++id).padStart(12,'0')}`,
    clock:() => new Date('2026-09-29T04:00:00.000Z'),
  });

  await service.proposeTimetable({ id:'student-1' }, 'course-1');

  assert.equal(attachCalls, 1);
  assert.equal(proposalSource, 'DETERMINISTIC_INITIAL');
});


test('D09 does not flag a draft Course for active timetable recovery just because another Course owns an approved Semester timetable', async () => {
  const base = {
    async getScheduleReview() {
      return {
        serverNow:'2026-10-05T08:00:00.000Z',
        requestedCourse:{ courseId:'draft-course', lifecycleState:'DRAFT', planReady:true, attachedToSemester:false },
        timetable:{ state:'APPROVED' },
        slots:[{ courseId:'active-course', kind:'CLASS', startsAt:'2026-10-05T09:00:00.000Z', endsAt:'2026-10-05T10:00:00.000Z' }],
        courseSlots:[],
        scheduleHealth:{},
      };
    },
  };
  const service = decorateD09Service(base, {
    repository:{},
    transactionalMutation:{ mutateAndPublish:async()=>{ throw new Error('not used'); } },
    randomUUID:()=> '00000000-0000-4000-8000-000000000099',
    clock:()=> new Date('2026-10-05T08:00:00.000Z'),
  });

  const review = await service.getScheduleReview({ id:'student-1' }, 'draft-course');

  assert.equal(review.scheduleIntegrity.recoveryRequired, false);
  assert.equal(review.scheduleIntegrity.classCount, 0);
});
