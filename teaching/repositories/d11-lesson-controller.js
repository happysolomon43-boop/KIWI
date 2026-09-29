'use strict';

const crypto = require('node:crypto');
const { buildClosureFactPack } = require('../d11/contracts');

function createD11LessonControllerRepository({
  query,
  withTransaction,
  randomUUID,
  clock = () => new Date(),
} = {}) {
  if (typeof query !== 'function') throw new TypeError('D11 repository requires query().');
  if (typeof withTransaction !== 'function') throw new TypeError('D11 repository requires withTransaction().');
  if (typeof randomUUID !== 'function') throw new TypeError('D11 repository requires randomUUID().');

  const q = (runner, text, params = []) => runner && typeof runner.query === 'function'
    ? runner.query(text, params)
    : query(text, params);

  function stableDigest(value) {
    const canonical = JSON.stringify(value, Object.keys(value || {}).sort());
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  async function assertReady() {
    const { rows } = await query(
      "select to_regclass('public.teaching_lesson_blueprints') lesson_blueprints," +
      " to_regclass('public.teaching_class_sessions') class_sessions," +
      " to_regclass('public.teaching_class_controller_history') controller_history," +
      " to_regclass('public.teaching_class_closure_facts') closure_facts," +
      " to_regclass('public.teaching_class_summaries') class_summaries," +
      " to_regclass('public.teaching_post_class_teacher_notes') teacher_notes," +
      " to_regclass('teaching_preparation.workspaces') preparation_workspaces"
    );
    const row = rows?.[0] || {};
    if (Object.values(row).some((value) => value == null)) {
      const error = new Error('Teaching D11 persistence is not installed.');
      error.code = 'TEACHING_D11_SCHEMA_MISSING';
      throw error;
    }
    return true;
  }

  async function loadClassBase(studentId, classId, runner = null, lock = false) {
    const suffix = lock ? ' for update of c,co' : '';
    const { rows } = await q(runner,
      "select c.*,co.lifecycle_state course_lifecycle_state,co.state_version course_state_version," +
      " co.subject_id,co.semester_id,a.course_plan_id activation_course_plan_id," +
      " a.course_plan_version activation_course_plan_version,a.activation_id activation_snapshot_id" +
      " from public.teaching_classes c" +
      " join public.teaching_courses co on co.course_id=c.course_id and co.student_id=c.student_id" +
      " left join public.teaching_course_activations a on a.activation_id=c.activation_id" +
      " where c.student_id=$1 and c.class_id=$2" + suffix,
      [studentId, classId]
    );
    return rows?.[0] || null;
  }

  async function loadCurrentPlan(studentId, courseId, runner = null, lock = false) {
    const suffix = lock ? ' for update' : '';
    const { rows } = await q(runner,
      "select * from public.teaching_course_plans where student_id=$1 and course_id=$2" +
      " and plan_state not in ('SUPERSEDED') order by version_no desc limit 1" + suffix,
      [studentId, courseId]
    );
    return rows?.[0] || null;
  }

  async function loadLearningUnits(studentId, planId, runner = null) {
    if (!planId) return [];
    const { rows } = await q(runner,
      "select * from public.teaching_learning_units where student_id=$1 and course_plan_id=$2 order by sequence_no,learning_unit_id",
      [studentId, planId]
    );
    return rows || [];
  }

  async function latestBlueprint(studentId, classId, runner = null, lock = false) {
    const suffix = lock ? ' for update' : '';
    const { rows } = await q(runner,
      "select * from public.teaching_lesson_blueprints where student_id=$1 and class_id=$2" +
      " and blueprint_state='VALIDATED' order by version_no desc limit 1" + suffix,
      [studentId, classId]
    );
    return rows?.[0] || null;
  }

  async function getSession(studentId, classId, runner = null, lock = false) {
    const suffix = lock ? ' for update' : '';
    const { rows } = await q(runner,
      "select * from public.teaching_class_sessions where student_id=$1 and class_id=$2 limit 1" + suffix,
      [studentId, classId]
    );
    return rows?.[0] || null;
  }

  async function getPreparationWorkspace(studentId, classId, runner = null, lock = false) {
    const suffix = lock ? ' for update' : '';
    const { rows } = await q(runner,
      "select * from teaching_preparation.workspaces where student_id=$1 and target_kind='next_class'" +
      " and target_ref=$2 and lifecycle_state not in ('SUPERSEDED','CANCELLED')" +
      " order by created_at desc limit 1" + suffix,
      [studentId, classId]
    );
    return rows?.[0] || null;
  }

  async function getClassContext(studentId, classId, runner = null) {
    const classRow = await loadClassBase(studentId, classId, runner, false);
    if (!classRow) return null;
    const plan = await loadCurrentPlan(studentId, classRow.course_id, runner, false);
    const [learningUnits, blueprint, session, workspace] = await Promise.all([
      loadLearningUnits(studentId, plan?.course_plan_id, runner),
      latestBlueprint(studentId, classId, runner, false),
      getSession(studentId, classId, runner, false),
      getPreparationWorkspace(studentId, classId, runner, false),
    ]);
    return Object.freeze({ classRow, plan, learningUnits, blueprint, session, workspace });
  }

  async function listClassesForCourse(studentId, courseId) {
    const { rows } = await query(
      "select c.* from public.teaching_classes c where c.student_id=$1 and c.course_id=$2" +
      " and c.lifecycle_state<>'CANCELLED' order by c.scheduled_start_at",
      [studentId, courseId]
    );
    return rows || [];
  }

  async function getPlanningSignals(studentId, classRow) {
    const prior = await query(
      "select f.closure_fact_id,f.class_id,f.class_session_id,f.fact_pack,f.closed_at" +
      " from public.teaching_class_closure_facts f" +
      " join public.teaching_classes c on c.class_id=f.class_id" +
      " where f.student_id=$1 and f.course_id=$2 and c.scheduled_start_at<$3" +
      " order by c.scheduled_start_at desc limit 3",
      [studentId, classRow.course_id, classRow.scheduled_start_at]
    );
    const notes = prior.rows?.length
      ? await query(
          "select teacher_note_id,class_id,class_session_id,note_state,note_payload,provenance_refs,created_at" +
          " from public.teaching_post_class_teacher_notes where student_id=$1 and class_id=any($2::text[])" +
          " order by created_at desc",
          [studentId, prior.rows.map((row) => row.class_id)]
        )
      : { rows: [] };
    return Object.freeze({
      priorClassFacts: Object.freeze((prior.rows || []).map((row) => Object.freeze({ ...row }))),
      teacherNotes: Object.freeze((notes.rows || []).map((row) => Object.freeze({ ...row }))),
      workSignals: Object.freeze({
        status: 'OWNER_PENDING_D16',
        signals: Object.freeze([]),
        negative_inference_forbidden: true,
      }),
      knowledgeModelSignals: Object.freeze({
        status: 'OWNER_PENDING_D13',
        signals: Object.freeze([]),
        negative_inference_forbidden: true,
      }),
      activeAssessmentAnswersIncluded: false,
    });
  }

  function dependenciesFor(context, signals) {
    const deps = [
      {
        dependency_kind: 'COURSE',
        authoritative_owner_ref: 'Course lifecycle',
        aggregate_ref: 'course:' + context.classRow.course_id,
        version_ref: String(context.classRow.course_state_version),
        component_scope_key: null,
      },
      {
        dependency_kind: 'COURSE_PLAN',
        authoritative_owner_ref: 'Course Plan/Coverage',
        aggregate_ref: 'course-plan:' + context.plan.course_plan_id,
        version_ref: String(context.plan.version_no),
        component_scope_key: context.classRow.course_id,
      },
      {
        dependency_kind: 'CLASS_SCHEDULE',
        authoritative_owner_ref: 'Scheduler/Calendar',
        aggregate_ref: 'class:' + context.classRow.class_id,
        version_ref: String(context.classRow.schedule_version),
        component_scope_key: context.classRow.class_id,
      },
    ];
    if (context.classRow.source_timetable_version_id) {
      deps.push({
        dependency_kind: 'TIMETABLE',
        authoritative_owner_ref: 'Scheduler/Calendar',
        aggregate_ref: 'timetable:' + context.classRow.source_timetable_version_id,
        version_ref: String(context.classRow.schedule_version),
        component_scope_key: context.classRow.class_id,
      });
    }
    for (const prior of signals?.priorClassFacts || []) {
      deps.push({
        dependency_kind: 'PRIOR_CLASS_FACT_PACK',
        authoritative_owner_ref: 'Teaching Controller',
        aggregate_ref: 'class-closure:' + prior.closure_fact_id,
        version_ref: String(prior.fact_pack?.schema_version || 'd11.class-fact-pack.v1'),
        component_scope_key: prior.class_id,
      });
    }
    return deps;
  }

  async function ensurePreparationWorkspace({ studentId, classId, correlationId = null } = {}) {
    return withTransaction(async (tx) => {
      const classRow = await loadClassBase(studentId, classId, tx, true);
      if (!classRow) return null;
      const plan = await loadCurrentPlan(studentId, classRow.course_id, tx, true);
      if (!plan) {
        const error = new Error('D11 preparation requires the current Course Plan.');
        error.code = 'TEACHING_D11_COURSE_PLAN_REQUIRED';
        error.status = 409;
        throw error;
      }
      const signals = await getPlanningSignals(studentId, classRow);
      const context = { classRow, plan };
      const dependencies = dependenciesFor(context, signals);
      const refs = dependencies.map((dep) => ({
        kind: dep.dependency_kind,
        owner: dep.authoritative_owner_ref,
        ref: dep.aggregate_ref,
        version: dep.version_ref,
      }));
      const digest = crypto.createHash('sha256').update(JSON.stringify(refs)).digest('hex');

      let workspace = await getPreparationWorkspace(studentId, classId, tx, true);
      if (!workspace) {
        const workspaceId = randomUUID();
        const inserted = await tx.query(
          "insert into teaching_preparation.workspaces(" +
          "workspace_id,student_id,workspace_type,target_kind,target_ref,authoritative_owner_ref," +
          "preparation_profile_ref,lifecycle_state,maturity_stage,state_version,target_effective_at," +
          "finalization_or_freeze_at,protected_content_class,trigger_policy_ref,cost_execution_budget_ref" +
          ") values($1,$2,'LESSON_BLUEPRINT','next_class',$3,'Teaching Controller / Lesson Planner'," +
          "'teaching.preparation.next_class@1.0','ACTIVE','SKELETON',0,$4,$4,'UNPROTECTED'," +
          "'d11.class-materiality.v1','teaching.preparation.budget.next_class') returning *",
          [workspaceId, studentId, classId, classRow.scheduled_start_at]
        );
        workspace = inserted.rows[0];
      }

      let currentBundle = null;
      if (workspace.current_authoritative_input_bundle_ref) {
        const loaded = await tx.query(
          "select * from teaching_preparation.authoritative_input_bundles where input_bundle_id=$1 limit 1",
          [workspace.current_authoritative_input_bundle_ref]
        );
        currentBundle = loaded.rows?.[0] || null;
      }
      if (currentBundle?.content_digest === digest) {
        return Object.freeze({ workspace, bundle: currentBundle, dependencies: Object.freeze(dependencies), changed: false, correlationId });
      }

      const versionRows = await tx.query(
        "select coalesce(max(bundle_version),0)+1 as next_version from teaching_preparation.authoritative_input_bundles where workspace_id=$1",
        [workspace.workspace_id]
      );
      const bundleVersion = Number(versionRows.rows[0].next_version);
      const bundleId = randomUUID();
      const bundleInsert = await tx.query(
        "insert into teaching_preparation.authoritative_input_bundles(" +
        "input_bundle_id,workspace_id,student_id,bundle_version,captured_at,authoritative_refs,preconditions,material_delta_summary,content_digest" +
        ") values($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9) returning *",
        [
          bundleId,
          workspace.workspace_id,
          studentId,
          bundleVersion,
          clock(),
          JSON.stringify(refs),
          JSON.stringify({
            course_lifecycle_state: classRow.course_lifecycle_state,
            course_state_version: classRow.course_state_version,
            class_schedule_version: classRow.schedule_version,
            course_plan_id: plan.course_plan_id,
            course_plan_version: plan.version_no,
          }),
          JSON.stringify({
            changed_dependency_refs: dependencies.map((dep) => dep.aggregate_ref),
            prior_bundle_ref: workspace.current_authoritative_input_bundle_ref || null,
          }),
          digest,
        ]
      );
      for (const dep of dependencies) {
        await tx.query(
          "insert into teaching_preparation.input_bundle_dependencies(" +
          "input_dependency_id,input_bundle_id,student_id,dependency_kind,authoritative_owner_ref,aggregate_ref,version_ref,component_scope_key" +
          ") values($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            randomUUID(), bundleId, studentId, dep.dependency_kind, dep.authoritative_owner_ref,
            dep.aggregate_ref, dep.version_ref, dep.component_scope_key,
          ]
        );
      }
      const updated = await tx.query(
        "update teaching_preparation.workspaces set current_authoritative_input_bundle_ref=$2," +
        " state_version=state_version+1,updated_at=now() where workspace_id=$1 returning *",
        [workspace.workspace_id, bundleId]
      );
      return Object.freeze({
        workspace: updated.rows[0],
        bundle: bundleInsert.rows[0],
        dependencies: Object.freeze(dependencies),
        changed: true,
        correlationId,
      });
    });
  }

  async function assertContextCurrentUsing(tx, expected) {
    const classRow = await loadClassBase(expected.studentId, expected.classId, tx, true);
    if (!classRow) {
      const error = new Error('Teaching Class no longer exists.');
      error.code = 'TEACHING_D11_CLASS_NOT_FOUND';
      error.status = 404;
      throw error;
    }
    const plan = await loadCurrentPlan(expected.studentId, classRow.course_id, tx, true);
    const mismatches = [];
    if (String(classRow.course_lifecycle_state) !== String(expected.courseLifecycleState)) mismatches.push('COURSE_LIFECYCLE');
    if (String(classRow.course_state_version) !== String(expected.courseStateVersion)) mismatches.push('COURSE_VERSION');
    if (String(classRow.schedule_version) !== String(expected.classScheduleVersion)) mismatches.push('CLASS_SCHEDULE_VERSION');
    if (String(classRow.source_timetable_version_id || '') !== String(expected.timetableVersionId || '')) mismatches.push('TIMETABLE_VERSION');
    if (String(plan?.course_plan_id || '') !== String(expected.coursePlanId || '')) mismatches.push('COURSE_PLAN');
    if (String(plan?.version_no || '') !== String(expected.coursePlanVersion || '')) mismatches.push('COURSE_PLAN_VERSION');
    if (mismatches.length) {
      const error = new Error('Authoritative Class/Course/Plan state changed before D11 commit.');
      error.code = 'TEACHING_D11_STALE_CONTEXT';
      error.status = 409;
      error.mismatches = mismatches;
      throw error;
    }
    return { classRow, plan };
  }

  async function saveBlueprint({
    studentId,
    classId,
    expected,
    blueprint,
    validationMetadata = {},
    generationProvenance = {},
    preparationRef = null,
    expectedControllerVersion = null,
  } = {}) {
    return withTransaction((tx) => saveBlueprintUsing(tx, {
      studentId,classId,expected,blueprint,validationMetadata,generationProvenance,preparationRef,expectedControllerVersion,
    }));
  }

  async function saveBlueprintUsing(tx, {
    studentId,
    classId,
    expected,
    blueprint,
    validationMetadata = {},
    generationProvenance = {},
    preparationRef = null,
    expectedControllerVersion = null,
  } = {}) {
    const current = await assertContextCurrentUsing(tx, { ...expected, studentId, classId });
    const session = await getSession(studentId, classId, tx, true);
    if (expectedControllerVersion != null && Number(session?.state_version) !== Number(expectedControllerVersion)) {
      const error = new Error('Controller version changed before replan commit.');
      error.code = 'TEACHING_D11_STALE_CONTROLLER_VERSION';
      error.status = 409;
      throw error;
    }
    const previous = await latestBlueprint(studentId, classId, tx, true);
    const versionResult = await tx.query(
      "select coalesce(max(version_no),0)+1 as next_version from public.teaching_lesson_blueprints where class_id=$1",
      [classId]
    );
    const versionNo = Number(versionResult.rows[0].next_version);
    if (previous) {
      await tx.query(
        "update public.teaching_lesson_blueprints set blueprint_state='SUPERSEDED' where lesson_blueprint_id=$1",
        [previous.lesson_blueprint_id]
      );
    }
    const blueprintId = randomUUID();
    const unitRefs = [...new Set((blueprint.objectives || []).map((objective) => String(objective.learning_unit_ref)))];
    const inserted = await tx.query(
      "insert into public.teaching_lesson_blueprints(" +
      "lesson_blueprint_id,student_id,class_id,course_plan_id,version_no,objective_summary,planned_learning_unit_refs," +
      "planned_segments,preparation_ref,blueprint_state,source_course_state_version,source_course_plan_version," +
      "source_class_schedule_version,source_timetable_version_id,blueprint_contract_version,blueprint_payload," +
      "validation_metadata,generation_provenance,supersedes_lesson_blueprint_id" +
      ") values($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,'VALIDATED',$10,$11,$12,$13," +
      "'d11.lesson-blueprint.v1',$14::jsonb,$15::jsonb,$16::jsonb,$17) returning *",
      [
        blueprintId,studentId,classId,current.plan.course_plan_id,versionNo,
        (blueprint.objectives || []).filter((o) => o.criticality === 'CORE').map((o) => o.label).join(' | '),
        JSON.stringify(unitRefs),JSON.stringify(blueprint.segments || []),preparationRef,
        current.classRow.course_state_version,current.plan.version_no,current.classRow.schedule_version,
        current.classRow.source_timetable_version_id || null,JSON.stringify(blueprint),
        JSON.stringify(validationMetadata || {}),JSON.stringify(generationProvenance || {}),
        previous?.lesson_blueprint_id || null,
      ]
    );
    let nextSession = session;
    if (session) {
      const updated = await tx.query(
        "update public.teaching_class_sessions set lesson_blueprint_id=$3,state_version=state_version+1," +
        " event_cursor=event_cursor+1,updated_at=now() where class_session_id=$1 and student_id=$2 returning *",
        [session.class_session_id,studentId,blueprintId]
      );
      nextSession = updated.rows[0];
      await appendHistoryUsing(tx, {
        studentId,classId,classSessionId:session.class_session_id,
        controllerVersion:nextSession.state_version,eventCursor:nextSession.event_cursor,
        actionKind:'REPLAN_COMMITTED',fromState:session.instructional_substate,toState:session.instructional_substate,
        reason:'Validated live Lesson Blueprint replan committed by D11 Controller owner.',
        safeMetadata:{lesson_blueprint_id:blueprintId,lesson_blueprint_version:versionNo},
      });
    }
    return Object.freeze({ blueprint: inserted.rows[0], session: nextSession, previous });
  }

  async function appendHistoryUsing(tx, {
    studentId,classId,classSessionId,controllerVersion,eventCursor,actionKind,
    fromState=null,toState=null,reason=null,sourceEventRef=null,idempotencyKey=null,safeMetadata={},
  }) {
    if (idempotencyKey) {
      const found = await tx.query(
        "select * from public.teaching_class_controller_history where student_id=$1 and idempotency_key=$2 limit 1",
        [studentId,idempotencyKey]
      );
      if (found.rows?.[0]) return found.rows[0];
    }
    const inserted = await tx.query(
      "insert into public.teaching_class_controller_history(" +
      "controller_history_id,student_id,class_id,class_session_id,controller_version,event_cursor,action_kind," +
      "from_state,to_state,reason,source_event_ref,idempotency_key,occurred_at,safe_metadata" +
      ") values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb) returning *",
      [
        randomUUID(),studentId,classId,classSessionId,controllerVersion,eventCursor,actionKind,
        fromState,toState,reason,sourceEventRef,idempotencyKey,clock(),JSON.stringify(safeMetadata || {}),
      ]
    );
    return inserted.rows[0];
  }

  async function ensureControllerStartedUsing(tx, {
    studentId,
    classId,
    expectedBlueprintId,
    sourceEventRef = null,
    idempotencyKey = null,
  } = {}) {
    const classRow = await loadClassBase(studentId,classId,tx,true);
    if (!classRow) return null;
    const existing = await getSession(studentId,classId,tx,true);
    if (existing) return Object.freeze({ session:existing, inserted:false });
    const plan = await loadCurrentPlan(studentId,classRow.course_id,tx,true);
    const blueprint = await latestBlueprint(studentId,classId,tx,true);
    if (!plan || !blueprint || (expectedBlueprintId && blueprint.lesson_blueprint_id !== expectedBlueprintId)) {
      const error = new Error('Validated current Lesson Blueprint is required before Controller start.');
      error.code = 'TEACHING_D11_BLUEPRINT_REQUIRED';
      error.status = 409;
      throw error;
    }
    if (classRow.course_lifecycle_state !== 'ACTIVE' || classRow.lifecycle_state === 'CANCELLED') {
      const error = new Error('Class/Course is not eligible for live Controller start.');
      error.code = 'TEACHING_D11_CLASS_NOT_ACTIVE';
      error.status = 409;
      throw error;
    }
    const now = clock();
    const sessionId = randomUUID();
    const inserted = await tx.query(
      "insert into public.teaching_class_sessions(" +
      "class_session_id,student_id,class_id,lesson_blueprint_id,lifecycle_state,instructional_substate,state_version," +
      "started_at,course_id,course_plan_id,source_course_state_version,source_course_plan_version," +
      "source_class_schedule_version,source_timetable_version_id,scheduled_start_at_snapshot,scheduled_end_at_snapshot," +
      "timezone_snapshot,event_cursor,progress_state,controller_contract_version" +
      ") values($1,$2,$3,$4,'ACTIVE','OPENING',1,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,1," +
      "'{\"completed_segment_refs\":[],\"completed_objective_refs\":[]}'::jsonb,'d11.controller.v1') returning *",
      [
        sessionId,studentId,classId,blueprint.lesson_blueprint_id,now,classRow.course_id,plan.course_plan_id,
        classRow.course_state_version,plan.version_no,classRow.schedule_version,classRow.source_timetable_version_id || null,
        classRow.scheduled_start_at,classRow.scheduled_end_at,classRow.timezone,
      ]
    );
    await appendHistoryUsing(tx, {
      studentId,classId,classSessionId:sessionId,controllerVersion:1,eventCursor:1,
      actionKind:'CONTROLLER_STARTED',fromState:null,toState:'OPENING',
      reason:'Server-authoritative Class start established live instructional state.',
      sourceEventRef,idempotencyKey,safeMetadata:{lesson_blueprint_id:blueprint.lesson_blueprint_id},
    });
    return Object.freeze({ session:inserted.rows[0], inserted:true });
  }

  async function transitionUsing(tx, {
    studentId,classId,expectedVersion,toState,lifecycleState=null,resumeState=null,reason=null,
    actionKind='STATE_TRANSITION',sourceEventRef=null,idempotencyKey=null,safeMetadata={},
    extraUpdates={},
  } = {}) {
    const session = await getSession(studentId,classId,tx,true);
    if (!session) {
      const error = new Error('Live Teaching Controller session does not exist.');
      error.code = 'TEACHING_D11_CONTROLLER_NOT_STARTED';
      error.status = 409;
      throw error;
    }
    if (Number(session.state_version) !== Number(expectedVersion)) {
      const error = new Error('Controller version changed before transition.');
      error.code = 'TEACHING_D11_STALE_CONTROLLER_VERSION';
      error.status = 409;
      throw error;
    }
    const sets = [
      'instructional_substate=$4',
      'lifecycle_state=$5',
      'state_version=state_version+1',
      'event_cursor=event_cursor+1',
      'updated_at=now()',
    ];
    const values = [
      session.class_session_id,
      studentId,
      Number(expectedVersion),
      toState,
      lifecycleState || session.lifecycle_state,
    ];
    const allowedExtra = {
      resume_instructional_substate:'resume_instructional_substate',
      break_started_at:'break_started_at',
      break_ends_at:'break_ends_at',
      overtime_started_at:'overtime_started_at',
      overtime_ceiling_at:'overtime_ceiling_at',
      closure_reason:'closure_reason',
      ended_at:'ended_at',
      progress_state:'progress_state',
    };
    for (const [key,column] of Object.entries(allowedExtra)) {
      if (!Object.prototype.hasOwnProperty.call(extraUpdates,key)) continue;
      values.push(key === 'progress_state' ? JSON.stringify(extraUpdates[key]) : extraUpdates[key]);
      sets.push(column + '=$' + values.length + (key === 'progress_state' ? '::jsonb' : ''));
    }
    const updated = await tx.query(
      'update public.teaching_class_sessions set ' + sets.join(',') +
      ' where class_session_id=$1 and student_id=$2 and state_version=$3 returning *',
      values
    );
    const next = updated.rows?.[0];
    if (!next) {
      const error = new Error('Controller transition lost an optimistic-concurrency race.');
      error.code = 'TEACHING_D11_STALE_CONTROLLER_VERSION';
      error.status = 409;
      throw error;
    }
    await appendHistoryUsing(tx, {
      studentId,classId,classSessionId:session.class_session_id,
      controllerVersion:next.state_version,eventCursor:next.event_cursor,actionKind,
      fromState:session.instructional_substate,toState,reason,sourceEventRef,idempotencyKey,
      safeMetadata:{...safeMetadata,resume_state:resumeState || null},
    });
    return Object.freeze({ previous:session, session:next });
  }

  async function recordProgressUsing(tx, {
    studentId,classId,expectedVersion,completedSegmentRefs=[],completedObjectiveRefs=[],evidenceRefs=[],
  } = {}) {
    const session = await getSession(studentId,classId,tx,true);
    if (!session || Number(session.state_version) !== Number(expectedVersion)) {
      const error = new Error('Controller version changed before progress commit.');
      error.code = 'TEACHING_D11_STALE_CONTROLLER_VERSION';
      error.status = 409;
      throw error;
    }
    const blueprint = await latestBlueprint(studentId,classId,tx,false);
    const payload = blueprint?.blueprint_payload || {};
    const validSegments = new Set((payload.segments || []).map((item) => String(item.id)));
    const validObjectives = new Set((payload.objectives || []).map((item) => String(item.id)));
    const segments = [...new Set(completedSegmentRefs.map(String))];
    const objectives = [...new Set(completedObjectiveRefs.map(String))];
    if (segments.some((ref) => !validSegments.has(ref)) || objectives.some((ref) => !validObjectives.has(ref))) {
      const error = new Error('Controller progress references unknown Blueprint components.');
      error.code = 'TEACHING_D11_PROGRESS_REF_INVALID';
      error.status = 422;
      throw error;
    }
    if (evidenceRefs.length) {
      const evidence = await tx.query(
        "select evidence_event_id from public.teaching_evidence_events where student_id=$1" +
        " and class_session_id=$2 and evidence_event_id=any($3::text[])",
        [studentId,session.class_session_id,evidenceRefs.map(String)]
      );
      if (evidence.rows.length !== new Set(evidenceRefs.map(String)).size) {
        const error = new Error('Every progress evidence reference must belong to the current Class session.');
        error.code = 'TEACHING_D11_PROGRESS_EVIDENCE_INVALID';
        error.status = 422;
        throw error;
      }
    }
    const prior = session.progress_state || {};
    const progress = {
      completed_segment_refs:[...new Set([...(prior.completed_segment_refs || []),...segments])],
      completed_objective_refs:[...new Set([...(prior.completed_objective_refs || []),...objectives])],
      evidence_event_refs:[...new Set([...(prior.evidence_event_refs || []),...evidenceRefs.map(String)])],
    };
    return transitionUsing(tx, {
      studentId,classId,expectedVersion,toState:session.instructional_substate,
      lifecycleState:session.lifecycle_state,reason:'Controller progress checkpoint',
      actionKind:'PROGRESS_CHECKPOINT',safeMetadata:{new_segment_refs:segments,new_objective_refs:objectives,evidence_refs:evidenceRefs},
      extraUpdates:{progress_state:progress},
    });
  }

  async function closureContext(studentId,classId) {
    const context = await getClassContext(studentId,classId);
    if (!context?.session) return context;
    const [evidence,history] = await Promise.all([
      query(
        "select * from public.teaching_evidence_events where student_id=$1 and class_session_id=$2 order by occurred_at",
        [studentId,context.session.class_session_id]
      ),
      query(
        "select * from public.teaching_class_controller_history where student_id=$1 and class_session_id=$2 order by event_cursor,created_at",
        [studentId,context.session.class_session_id]
      ),
    ]);
    return Object.freeze({...context,evidenceEvents:Object.freeze(evidence.rows || []),history:Object.freeze(history.rows || [])});
  }

  async function commitClosure({
    studentId,classId,expectedVersion,reason='CONTROLLER_CLOSURE',sourceEventRef=null,idempotencyKey=null,
  } = {}) {
    return withTransaction(async (tx) => {
      const session = await getSession(studentId,classId,tx,true);
      if (!session) {
        const error = new Error('Controller has not started.');
        error.code='TEACHING_D11_CONTROLLER_NOT_STARTED'; error.status=409; throw error;
      }
      const existingFact = await tx.query(
        "select * from public.teaching_class_closure_facts where student_id=$1 and class_session_id=$2 limit 1",
        [studentId,session.class_session_id]
      );
      if (existingFact.rows?.[0]) return Object.freeze({ session, closureFact:existingFact.rows[0], idempotent:true });
      if (Number(session.state_version) !== Number(expectedVersion)) {
        const error = new Error('Controller version changed before Closure.');
        error.code='TEACHING_D11_STALE_CONTROLLER_VERSION'; error.status=409; throw error;
      }
      const classRow = await loadClassBase(studentId,classId,tx,true);
      const blueprint = await latestBlueprint(studentId,classId,tx,false);
      const evidence = await tx.query(
        "select * from public.teaching_evidence_events where student_id=$1 and class_session_id=$2 order by occurred_at",
        [studentId,session.class_session_id]
      );
      const history = await tx.query(
        "select * from public.teaching_class_controller_history where student_id=$1 and class_session_id=$2 order by event_cursor",
        [studentId,session.class_session_id]
      );
      const endedAt = clock();
      const factPack = buildClosureFactPack({
        session,classRow,blueprint,progressState:session.progress_state || {},
        evidenceEvents:evidence.rows || [],history:history.rows || [],serverNow:endedAt,reason,
      });
      const transitioned = await transitionUsing(tx, {
        studentId,classId,expectedVersion,toState:'CLOSURE',lifecycleState:'CLOSED',reason,
        actionKind:'CLASS_CLOSED',sourceEventRef,idempotencyKey,
        safeMetadata:{fact_pack_schema_version:factPack.schema_version},
        extraUpdates:{closure_reason:reason,ended_at:endedAt},
      });
      const factId = randomUUID();
      const fact = await tx.query(
        "insert into public.teaching_class_closure_facts(" +
        "closure_fact_id,student_id,course_id,class_id,class_session_id,lesson_blueprint_id,controller_version," +
        "fact_pack_version,fact_pack,provenance_refs,closed_at" +
        ") values($1,$2,$3,$4,$5,$6,$7,'d11.class-fact-pack.v1',$8::jsonb,$9::jsonb,$10) returning *",
        [
          factId,studentId,classRow.course_id,classId,session.class_session_id,blueprint?.lesson_blueprint_id || null,
          transitioned.session.state_version,JSON.stringify(factPack),
          JSON.stringify([
            'class:' + classId,
            ...(blueprint ? ['lesson-blueprint:' + blueprint.lesson_blueprint_id] : []),
            ...((evidence.rows || []).map((row) => 'evidence:' + row.evidence_event_id)),
          ]),
          endedAt,
        ]
      );
      return Object.freeze({session:transitioned.session,closureFact:fact.rows[0],idempotent:false});
    });
  }

  async function persistSummary({
    studentId,classId,classSessionId,closureFactId,state,payload={},provenance={},
  } = {}) {
    return withTransaction(async (tx) => {
      const versions = await tx.query(
        "select coalesce(max(version_no),0)+1 next_version from public.teaching_class_summaries where class_session_id=$1",
        [classSessionId]
      );
      const inserted = await tx.query(
        "insert into public.teaching_class_summaries(" +
        "class_summary_id,student_id,class_id,class_session_id,closure_fact_id,version_no,summary_state,summary_payload,translation_provenance" +
        ") values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb) returning *",
        [randomUUID(),studentId,classId,classSessionId,closureFactId,Number(versions.rows[0].next_version),state,JSON.stringify(payload || {}),JSON.stringify(provenance || {})]
      );
      return inserted.rows[0];
    });
  }

  async function persistTeacherNote({
    studentId,courseId,classId,classSessionId,closureFactId,state,payload={},provenanceRefs=[],generationProvenance={},
  } = {}) {
    return withTransaction(async (tx) => {
      const versions = await tx.query(
        "select coalesce(max(version_no),0)+1 next_version from public.teaching_post_class_teacher_notes where class_session_id=$1",
        [classSessionId]
      );
      const inserted = await tx.query(
        "insert into public.teaching_post_class_teacher_notes(" +
        "teacher_note_id,student_id,course_id,class_id,class_session_id,closure_fact_id,version_no,note_state,note_payload,provenance_refs,generation_provenance" +
        ") values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb) returning *",
        [
          randomUUID(),studentId,courseId,classId,classSessionId,closureFactId,Number(versions.rows[0].next_version),state,
          JSON.stringify(payload || {}),JSON.stringify(provenanceRefs || []),JSON.stringify(generationProvenance || {}),
        ]
      );
      return inserted.rows[0];
    });
  }

  async function latestSummary(studentId,classId) {
    const {rows}=await query(
      "select * from public.teaching_class_summaries where student_id=$1 and class_id=$2 order by version_no desc limit 1",
      [studentId,classId]
    );
    return rows?.[0] || null;
  }

  async function latestTeacherNote(studentId,classId) {
    const {rows}=await query(
      "select * from public.teaching_post_class_teacher_notes where student_id=$1 and class_id=$2 order by version_no desc limit 1",
      [studentId,classId]
    );
    return rows?.[0] || null;
  }

  return Object.freeze({
    assertReady,
    getClassContext,
    listClassesForCourse,
    getPlanningSignals,
    ensurePreparationWorkspace,
    assertContextCurrentUsing,
    saveBlueprint,
    saveBlueprintUsing,
    latestBlueprint,
    getSession,
    ensureControllerStartedUsing,
    transitionUsing,
    recordProgressUsing,
    closureContext,
    commitClosure,
    persistSummary,
    persistTeacherNote,
    latestSummary,
    latestTeacherNote,
  });
}

module.exports = { createD11LessonControllerRepository };
