'use strict';
const {enqueueInstructionUsing}=require('../d14/instruction-event');

const crypto = require('node:crypto');
const { buildClosureFactPack } = require('../d11/contracts');
const {evaluateLessonInheritance}=require('../d11/preparation-inheritance');
const {evaluateWorkspaceTransition}=require('../preparation/t0-handlers');
const { TEACHING_EVENTS } = require('../events/names');
const { EVENT_CATEGORIES } = require('../runtime/constants');

const {lateStartRecoveryEligibility}=require('../d11/late-start-recovery');

function createD11LessonControllerRepository({
  query,
  withTransaction,
  randomUUID,
  clock = () => new Date(),
  outboxStore = null,
} = {}) {
  if (typeof query !== 'function') throw new TypeError('D11 repository requires query().');
  if (typeof withTransaction !== 'function') throw new TypeError('D11 repository requires withTransaction().');
  if (typeof randomUUID !== 'function') throw new TypeError('D11 repository requires randomUUID().');

  const q = (runner, text, params = []) => runner && typeof runner.query === 'function'
    ? runner.query(text, params)
    : query(text, params);

  function stableDigest(value) {
    const canonicalize=(input)=>{
      if(Array.isArray(input)) return input.map(canonicalize);
      if(input&&typeof input==='object'){
        return Object.fromEntries(Object.keys(input).sort().map((key)=>[key,canonicalize(input[key])]));
      }
      return input;
    };
    return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
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
      " a.course_plan_version activation_course_plan_version,a.activation_id activation_snapshot_id," +
      " tv.version_no source_timetable_version_no,tv.timetable_state source_timetable_state" +
      " from public.teaching_classes c" +
      " join public.teaching_courses co on co.course_id=c.course_id and co.student_id=c.student_id" +
      " left join public.teaching_course_activations a on a.activation_id=c.activation_id" +
      " left join public.teaching_timetable_versions tv on tv.timetable_version_id=c.source_timetable_version_id" +
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

  async function loadLearningUnitDependencies(studentId, planId, runner = null) {
    if (!planId) return [];
    const { rows } = await q(runner,
      "select d.* from public.teaching_learning_unit_dependencies d " +
      "join public.teaching_learning_units u on u.learning_unit_id=d.learning_unit_id " +
      "where d.student_id=$1 and u.course_plan_id=$2 order by d.learning_unit_id,d.prerequisite_learning_unit_id",
      [studentId,planId]
    );
    return rows || [];
  }

  async function loadPlanPrerequisites(studentId, planId, runner = null) {
    if (!planId) return [];
    const { rows } = await q(runner,
      "select * from public.teaching_course_plan_prerequisites where student_id=$1 and course_plan_id=$2 order by prerequisite_id",
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
      " and target_ref=$2 and lifecycle_state in ('ACTIVE','FINALIZATION_DUE','FINALIZED')" +
      " order by created_at desc limit 1" + suffix,
      [studentId, classId]
    );
    return rows?.[0] || null;
  }

  async function getClassContext(studentId, classId, runner = null) {
    const classRow = await loadClassBase(studentId, classId, runner, false);
    if (!classRow) return null;
    const plan = await loadCurrentPlan(studentId, classRow.course_id, runner, false);
    // In a transaction all calls use a single pg Client; schedule queries
    // serially to avoid concurrent client.query calls. Outside a transaction
    // the pool supports parallel reads and remains unchanged.
    const readers=[
      ()=>loadLearningUnits(studentId, plan?.course_plan_id, runner),
      ()=>loadLearningUnitDependencies(studentId, plan?.course_plan_id, runner),
      ()=>loadPlanPrerequisites(studentId, plan?.course_plan_id, runner),
      ()=>latestBlueprint(studentId, classId, runner, false),
      ()=>getSession(studentId, classId, runner, false),
      ()=>getPreparationWorkspace(studentId, classId, runner, false),
    ];
    const results=runner
      ?await (async()=>{const acc=[];for(const read of readers)acc.push(await read());return acc;})()
      :await Promise.all(readers.map(read=>read()));
    const [learningUnits,learningUnitDependencies,planPrerequisites,blueprint,session,workspace]=results;
    return Object.freeze({ classRow, plan, learningUnits, learningUnitDependencies, planPrerequisites, blueprint, session, workspace });
  }

  async function listClassesForCourse(studentId, courseId) {
    const { rows } = await query(
      "select c.* from public.teaching_classes c where c.student_id=$1 and c.course_id=$2" +
      " and c.lifecycle_state<>'CANCELLED' and c.scheduled_end_at >= $3 order by c.scheduled_start_at",
      [studentId, courseId, clock()]
    );
    return rows || [];
  }

  // A governed timetable rebuild is semester-wide even when its originating
  // Request belonged to a Course with no Classes (e.g. GST). Resolve solely
  // actual, still-approved Class obligations; never project cancelled rows from
  // older timetable versions into PPL.
  async function listClassesForApprovedTimetable(studentId,timetableVersionId) {
    const {rows=[]}=await query(
      "select c.* from public.teaching_classes c" +
      " join public.teaching_timetable_versions t on t.timetable_version_id=c.source_timetable_version_id" +
      " join public.teaching_courses co on co.course_id=c.course_id and co.student_id=c.student_id" +
      " where c.student_id=$1 and c.source_timetable_version_id=$2" +
      " and t.timetable_state='APPROVED' and co.lifecycle_state='ACTIVE'" +
      " and c.lifecycle_state='SCHEDULED' and c.scheduled_start_at>now()" +
      " and not exists (select 1 from public.teaching_class_sessions sess where sess.class_id=c.class_id and sess.student_id=c.student_id)" +
      " order by c.scheduled_start_at,c.class_id",
      [studentId,timetableVersionId]
    );
    return rows;
  }

  async function listClassesForAppliedScheduleRequest(studentId,requestId) {
    const {rows=[]}=await query(
      "select c.* from public.teaching_classes c" +
      " join public.teaching_timetable_versions t on t.timetable_version_id=c.source_timetable_version_id" +
      " join public.teaching_courses co on co.course_id=c.course_id and co.student_id=c.student_id" +
      " where c.student_id=$1 and c.source_request_id=$2" +
      " and t.timetable_state='APPROVED' and co.lifecycle_state='ACTIVE'" +
      " and c.lifecycle_state='SCHEDULED' and c.scheduled_start_at>now()" +
      " and not exists (select 1 from public.teaching_class_sessions sess where sess.class_id=c.class_id and sess.student_id=c.student_id)" +
      " order by c.scheduled_start_at,c.class_id",
      [studentId,requestId]
    );
    return rows;
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
    const governedRequests = await query(
      "select request_id,request_type,lifecycle_state,state_version,target_owner,target_type,target_ref,target_version_ref," +
      " effective_at,application_ref,updated_at from public.teaching_requests" +
      " where student_id=$1 and course_id=$2 and lifecycle_state in ('REVIEWING','APPROVED','APPROVED_WITH_ADJUSTMENT')" +
      " order by updated_at desc limit 20",
      [studentId, classRow.course_id]
    ).catch(() => ({ rows: [] }));
    const [diagnostics,vpk,debt] = await Promise.all([
      query(
        "select diagnostic_plan_id,plan_version,requirement_state,requirement_reason,target_refs,non_graded,diagnostic_design,provenance_refs,created_at" +
        " from public.teaching_diagnostic_plans where student_id=$1 and course_id=$2 order by plan_version desc limit 1",
        [studentId,classRow.course_id]
      ).catch(()=>({rows:[]})),
      query(
        "select distinct on (target_kind,target_ref) vpk_decision_id,target_kind,target_ref,decision_status,policy_version,evidence_refs,provenance_refs,decision_reasons,decided_at" +
        " from public.teaching_validated_prior_knowledge_decisions where student_id=$1 and course_id=$2" +
        " order by target_kind,target_ref,decided_at desc",
        [studentId,classRow.course_id]
      ).catch(()=>({rows:[]})),
      query(
        "select schedule_debt_entry_id,delta_minutes,cause_code,source_ref,timetable_version_id,recorded_at" +
        " from public.teaching_schedule_debt_entries where student_id=$1 and course_id=$2 order by recorded_at desc limit 20",
        [studentId,classRow.course_id]
      ).catch(()=>({rows:[]})),
    ]);
    return Object.freeze({
      priorClassFacts: Object.freeze((prior.rows || []).map((row) => Object.freeze({ ...row }))),
      teacherNotes: Object.freeze((notes.rows || []).map((row) => Object.freeze({ ...row }))),
      diagnosticSignals: Object.freeze((diagnostics.rows || []).map((row)=>Object.freeze({ ...row }))),
      validatedPriorKnowledgeSignals: Object.freeze((vpk.rows || []).map((row)=>Object.freeze({ ...row }))),
      pacingSignals: Object.freeze({source_owner:'Scheduler/Calendar',scheduleDebtEntries:Object.freeze((debt.rows || []).map((row)=>Object.freeze({ ...row })))}),
      correctionRecoverySignals: Object.freeze({source:'prior_class_teacher_notes_and_closure_facts',uncertainty_preserved:true}),
      workSignals: Object.freeze({
        status: 'OWNER_PENDING_D16',
        signals: Object.freeze([]),
        negative_inference_forbidden: true,
      }),
      knowledgeModelSignals: await (async () => {
        try {
          const [states, misconceptions] = await Promise.all([
            query(
              "select distinct on (s.learning_unit_id) s.knowledge_state_version_id,s.learning_unit_id,s.version_no,s.algorithm_version," +
              " s.base_state,s.overlays,s.dimensions,s.certainty_band,s.certainty_basis,s.retention_context," +
              " s.strongest_supported_claim,s.contradiction_state,s.path_to_success,s.confidence_calibration,s.evidence_cutoff_at" +
              " from public.teaching_student_knowledge_state_versions s" +
              " join public.teaching_learning_units lu on lu.learning_unit_id=s.learning_unit_id and lu.student_id=s.student_id" +
              " join public.teaching_course_plans cp on cp.course_plan_id=lu.course_plan_id and cp.student_id=s.student_id" +
              " where s.student_id=$1 and cp.course_plan_id=(" +
              " select cp2.course_plan_id from public.teaching_course_plans cp2 where cp2.student_id=$1 and cp2.course_id=$2 order by cp2.version_no desc limit 1" +
              " ) order by s.learning_unit_id,s.version_no desc",
              [studentId, classRow.course_id]
            ),
            query(
              "select distinct on (m.misconception_record_id) m.*" +
              " from public.teaching_persistent_misconception_versions m" +
              " join public.teaching_learning_units lu on lu.learning_unit_id=m.primary_learning_unit_id and lu.student_id=m.student_id" +
              " join public.teaching_course_plans cp on cp.course_plan_id=lu.course_plan_id and cp.student_id=m.student_id" +
              " where m.student_id=$1 and cp.course_plan_id=(" +
              " select cp2.course_plan_id from public.teaching_course_plans cp2 where cp2.student_id=$1 and cp2.course_id=$2 order by cp2.version_no desc limit 1" +
              " ) order by m.misconception_record_id,m.version_no desc",
              [studentId, classRow.course_id]
            ),
          ]);
          const byUnit = new Map();
          for (const row of misconceptions.rows || []) {
            if (row.status === 'RESOLVED') continue;
            for (const ref of new Set([String(row.primary_learning_unit_id), ...((row.affected_learning_unit_refs || []).map(String))])) {
              const list = byUnit.get(ref) || [];
              list.push(Object.freeze({
                misconception_record_id: row.misconception_record_id,
                status: row.status,
                summary: row.hypothesis,
                version_no: Number(row.version_no),
              }));
              byUnit.set(ref, list);
            }
          }
          const stateRows = states.rows || [];
          const bundleVersion = stateRows
            .map((row) => String(row.learning_unit_id) + '@' + String(row.algorithm_version) + ':' + String(row.version_no))
            .sort().join('|') || 'EMPTY';
          return Object.freeze({
            status: 'AUTHORITATIVE_D13',
            owner: 'Student Knowledge Model',
            bundle_version: bundleVersion,
            signals: Object.freeze(stateRows.map((row) => Object.freeze({
              learning_unit_id: row.learning_unit_id,
              state_ref: 'skm:' + row.learning_unit_id + '@' + String(row.version_no),
              state_version: Number(row.version_no),
              algorithm_version: row.algorithm_version,
              base_state: row.base_state,
              overlays: Object.freeze(row.overlays || []),
              certainty_band: row.certainty_band,
              retention_context: Object.freeze(row.retention_context || {}),
              strongest_supported_claim: row.strongest_supported_claim,
              contradiction_state: row.contradiction_state === true,
              planning_dimensions: Object.freeze({
                independence: row.dimensions?.independence || { status:'NOT_ASSESSED' },
                retention: row.dimensions?.retention || { status:'NOT_ASSESSED' },
                transfer: row.dimensions?.transfer || { status:'NOT_ASSESSED' },
              }),
              path_to_success: Object.freeze(row.path_to_success || {}),
              unresolved_misconceptions: Object.freeze(byUnit.get(String(row.learning_unit_id)) || []),
            }))),
            raw_weights_included: false,
            raw_model_probabilities_included: false,
            official_marks_included: false,
            progression_outcomes_included: false,
            negative_inference_forbidden: true,
          });
        } catch (error) {
          // D11 remains usable before/without D13 readiness. Missing SKM state is UNKNOWN,
          // never negative evidence and never permission to fabricate a weaker learner state.
          return Object.freeze({
            status: 'D13_UNAVAILABLE',
            signals: Object.freeze([]),
            raw_weights_included: false,
            official_marks_included: false,
            progression_outcomes_included: false,
            negative_inference_forbidden: true,
            error_code: error?.code || null,
          });
        }
      })(),
      governedRequestSignals: Object.freeze((governedRequests.rows || []).map((row) => Object.freeze({
        request_id: row.request_id,
        request_type: row.request_type,
        lifecycle_state: row.lifecycle_state,
        state_version: Number(row.state_version),
        target_owner: row.target_owner,
        target_type: row.target_type,
        target_ref: row.target_ref,
        target_version_ref: row.target_version_ref,
        effective_at: row.effective_at,
        application_ref: row.application_ref,
        updated_at: row.updated_at,
      }))),
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
        version_ref: String(context.classRow.source_timetable_version_no ?? context.classRow.schedule_version),
        component_scope_key: context.classRow.class_id,
      });
    }
    for (const diagnostic of signals?.diagnosticSignals || []) {
      deps.push({
        dependency_kind: 'DIAGNOSTIC_PLAN',
        authoritative_owner_ref: 'Diagnostic / Validated Prior Knowledge',
        aggregate_ref: 'diagnostic-plan:' + diagnostic.diagnostic_plan_id,
        version_ref: String(diagnostic.plan_version),
        component_scope_key: context.classRow.course_id,
      });
    }
    for (const decision of signals?.validatedPriorKnowledgeSignals || []) {
      deps.push({
        dependency_kind: 'VALIDATED_PRIOR_KNOWLEDGE',
        authoritative_owner_ref: 'Validated Prior Knowledge',
        aggregate_ref: 'vpk:' + decision.vpk_decision_id,
        version_ref: String(decision.decided_at || decision.policy_version || decision.vpk_decision_id),
        component_scope_key: decision.target_ref || context.classRow.course_id,
      });
    }
    for (const debt of signals?.pacingSignals?.scheduleDebtEntries || []) {
      deps.push({
        dependency_kind: 'SCHEDULE_DEBT',
        authoritative_owner_ref: 'Scheduler/Calendar',
        aggregate_ref: 'schedule-debt:' + debt.schedule_debt_entry_id,
        version_ref: String(debt.recorded_at || debt.schedule_debt_entry_id),
        component_scope_key: context.classRow.course_id,
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
    for (const note of signals?.teacherNotes || []) {
      deps.push({
        dependency_kind:'PRIOR_TEACHER_NOTE',
        authoritative_owner_ref:'Lesson Planner',
        aggregate_ref:'teacher-note:' + note.teacher_note_id,
        version_ref:String(note.created_at || note.teacher_note_id),
        component_scope_key:note.class_id || context.classRow.course_id,
      });
    }
    for (const state of signals?.knowledgeModelSignals?.signals || []) {
      deps.push({
        dependency_kind: 'SKM_STATE',
        authoritative_owner_ref: 'Student Knowledge Model',
        aggregate_ref: 'skm:' + state.learning_unit_id,
        version_ref: String(state.algorithm_version || 'unknown') + ':' + String(state.state_version || 0),
        component_scope_key: state.learning_unit_id,
      });
    }
    for (const request of signals?.governedRequestSignals || []) {
      deps.push({
        dependency_kind: 'GOVERNED_REQUEST',
        authoritative_owner_ref: String(request.target_owner || 'Course Lifecycle/Request'),
        aggregate_ref: 'request:' + request.request_id,
        version_ref: String(request.state_version),
        component_scope_key: request.target_ref || context.classRow.course_id,
      });
    }
    return deps;
  }

  async function ensurePreparationWorkspaceUsing(tx, {
    studentId,classId,correlationId=null,
    expectedTimetableVersionId=null,expectedScheduleVersion=null,
  } = {}) {
    const classRow = await loadClassBase(studentId, classId, tx, true);
    if (!classRow) return null;
    // EVERY caller, including live recovery and model tasks racing a Course
    // cancellation, must obey the same current-parent authority gate. A caller
    // without an expected timetable ref is not exempt from this check.
    if (classRow.lifecycle_state!=='SCHEDULED'
      ||classRow.course_lifecycle_state!=='ACTIVE'
      ||classRow.source_timetable_state!=='APPROVED'
      || !Number.isFinite(Date.parse(classRow.scheduled_end_at))
      ||(Date.parse(classRow.scheduled_end_at)<=clock().getTime()
        && !await getSession(studentId,classId,tx,false))) return null;
    // Final locked eligibility check: a timetable may have been superseded
    // after the fanout event was published. Never create new preparation or due
    // events for a cancelled, old, already-started, or elapsed Class.
    if (expectedTimetableVersionId != null) {
      if (classRow.lifecycle_state!=='SCHEDULED'
        || classRow.course_lifecycle_state!=='ACTIVE'
        || classRow.source_timetable_state!=='APPROVED'
        || classRow.source_timetable_version_id!==expectedTimetableVersionId
        || Number(classRow.schedule_version)!==Number(expectedScheduleVersion)
        || !Number.isFinite(new Date(classRow.scheduled_start_at).getTime())
        || new Date(classRow.scheduled_start_at).getTime()<=clock().getTime()
        || await getSession(studentId,classId,tx,false))return null;
    }
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
    let createdWorkspace = !workspace;
    if (!workspace) {
      const priorWorkspaceResult=await tx.query(
        "select workspace_id from teaching_preparation.workspaces where student_id=$1 and target_kind='next_class'" +
        " and target_ref=$2 order by created_at desc limit 1",
        [studentId,classId]
      );
      const priorWorkspaceId=priorWorkspaceResult.rows?.[0]?.workspace_id || null;
      const workspaceId = randomUUID();
      const inserted = await tx.query(
        "insert into teaching_preparation.workspaces(" +
        "workspace_id,student_id,workspace_type,target_kind,target_ref,authoritative_owner_ref," +
        "preparation_profile_ref,lifecycle_state,maturity_stage,state_version,target_effective_at," +
        "finalization_or_freeze_at,protected_content_class,trigger_policy_ref,cost_execution_budget_ref,supersedes_workspace_id" +
        ") values($1,$2,'LESSON_BLUEPRINT','next_class',$3,'Teaching Controller / Lesson Planner'," +
        "'teaching.preparation.next_class@1.0','ACTIVE','SKELETON',0,$4,$4,'UNPROTECTED'," +
        "'d11.class-materiality.v1','teaching.preparation.budget.next_class',$5) returning *",
        [workspaceId, studentId, classId, classRow.scheduled_start_at, priorWorkspaceId]
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
    if (
      workspace &&
      currentBundle?.content_digest !== digest &&
      (workspace.maturity_stage === 'PRE_LOCK_READY' || workspace.lifecycle_state !== 'ACTIVE')
    ) {
      const priorWorkspace=workspace;
      await tx.query(
        "update teaching_preparation.workspaces set lifecycle_state='SUPERSEDED',state_version=state_version+1,updated_at=now()" +
        " where workspace_id=$1",
        [priorWorkspace.workspace_id]
      );
      const successorId=randomUUID();
      const inserted=await tx.query(
        "insert into teaching_preparation.workspaces(" +
        "workspace_id,student_id,workspace_type,target_kind,target_ref,authoritative_owner_ref," +
        "preparation_profile_ref,lifecycle_state,maturity_stage,state_version,target_effective_at," +
        "finalization_or_freeze_at,protected_content_class,trigger_policy_ref,cost_execution_budget_ref,supersedes_workspace_id" +
        ") values($1,$2,'LESSON_BLUEPRINT','next_class',$3,'Teaching Controller / Lesson Planner'," +
        "'teaching.preparation.next_class@1.0','ACTIVE','SKELETON',0,$4,$4,'UNPROTECTED'," +
        "'d11.class-materiality.v1','teaching.preparation.budget.next_class',$5) returning *",
        [successorId,studentId,classId,classRow.scheduled_start_at,priorWorkspace.workspace_id]
      );
      workspace=inserted.rows[0];
      await tx.query(
        "update teaching_preparation.workspaces set superseded_by_workspace_id=$2 where workspace_id=$1",
        [priorWorkspace.workspace_id,successorId]
      );
      currentBundle=null;
      createdWorkspace=true;
    }

    if (currentBundle?.content_digest === digest) {
      return Object.freeze({
        workspace,
        bundle: currentBundle,
        dependencies: Object.freeze(dependencies),
        changed: false,
        created: false,
        correlationId,
      });
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
        bundleId, workspace.workspace_id, studentId, bundleVersion, clock(), JSON.stringify(refs),
        JSON.stringify({
          course_lifecycle_state: classRow.course_lifecycle_state,
          course_state_version: classRow.course_state_version,
          class_schedule_version: classRow.schedule_version,
          timetable_version_id: classRow.source_timetable_version_id || null,
          timetable_version_no: classRow.source_timetable_version_no == null ? null : Number(classRow.source_timetable_version_no),
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
    const nextWorkspace = updated.rows[0];

    if (outboxStore && typeof outboxStore.appendUsing === 'function') {
      const eventType = createdWorkspace
        ? TEACHING_EVENTS.PREPARATION_WORKSPACE_SEEDED
        : TEACHING_EVENTS.PREPARATION_INPUT_CHANGED;
      const eventId = 'd11-ppl-' + (createdWorkspace ? 'seed' : 'input') + ':' + workspace.workspace_id + ':bundle-v' + bundleVersion;
      const occurred = clock().toISOString();
      await outboxStore.appendUsing(tx.query.bind(tx), {
        eventId,
        schemaVersion:1,
        eventType,
        eventCategory:EVENT_CATEGORIES.COMMITTED_DOMAIN_EVENT,
        triggerType:'committed_domain_event',
        source:'teaching.d11',
        origin:'d11',
        actorId:studentId,
        aggregateType:'preparation_workspace',
        aggregateId:workspace.workspace_id,
        aggregateVersion:Number(nextWorkspace.state_version),
        occurredAt:occurred,
        effectiveAt:occurred,
        dueAt:null,
        correlationId:correlationId || eventId,
        causationId:null,
        idempotencyKey:eventId,
        payload:createdWorkspace
          ? { target_kind:'next_class', target_ref:classId, current_authoritative_input_bundle_ref:bundleId }
          : { changedDependencyRefs:dependencies.map((dep)=>dep.aggregate_ref), current_authoritative_input_bundle_ref:bundleId },
        auditRefs:[],
        provenanceRefs:dependencies.map((dep)=>dep.aggregate_ref),
      });
    }
    return Object.freeze({
      workspace: nextWorkspace,
      bundle: bundleInsert.rows[0],
      dependencies: Object.freeze(dependencies),
      changed: true,
      created: createdWorkspace,
      correlationId,
    });
  }

  async function ensurePreparationWorkspace(args = {}) {
    return withTransaction((tx) => ensurePreparationWorkspaceUsing(tx, args));
  }

  async function recordPreparationArtifactUsing(tx,{
    studentId,
    classId,
    blueprint,
    capabilityId='teaching.lesson.pre_class_lesson_planning',
    promptFamilyRef='TPF-05',
    allowLateStartRecovery=false,
  } = {}) {
    {
      // Fence the final result of an already-running AI call against current
      // Course/Class/Timetable/Plan authority under the same locks used by
      // rescheduling. Provider requests may have been sent before cancellation;
      // their outputs must NEVER create artifacts after an obsolete parent.
      const klass=await loadClassBase(studentId,classId,tx,true);
      const plan=klass?await loadCurrentPlan(studentId,klass.course_id,tx,true):null;
      const session=klass?await getSession(studentId,classId,tx,false):null;
      const workspace = await getPreparationWorkspace(studentId,classId,tx,true);
      const pre=workspace?.current_authoritative_input_bundle_ref
        ?(await tx.query(
          'select preconditions from teaching_preparation.authoritative_input_bundles where input_bundle_id=$1 and workspace_id=$2',
          [workspace.current_authoritative_input_bundle_ref,workspace.workspace_id]
        )).rows?.[0]?.preconditions:null;
      const stillCurrent=Boolean(klass&&plan&&workspace&&pre
        &&klass.lifecycle_state==='SCHEDULED'
        &&klass.course_lifecycle_state==='ACTIVE'
        &&klass.source_timetable_state==='APPROVED'
        &&(Date.parse(klass.scheduled_start_at)>clock().getTime()
          || (allowLateStartRecovery===true && lateStartRecoveryEligibility({classRow:klass,plan,session,now:clock()}).allowed))
        &&(!session || (allowLateStartRecovery===true
          &&lateStartRecoveryEligibility({classRow:klass,plan,session,now:clock()}).allowed))
        &&workspace.lifecycle_state==='ACTIVE'
        &&String(pre.course_state_version)===String(klass.course_state_version)
        &&String(pre.class_schedule_version)===String(klass.schedule_version)
        &&String(pre.timetable_version_id||'')===String(klass.source_timetable_version_id||'')
        &&String(pre.course_plan_id)===String(plan.course_plan_id)
        &&String(pre.course_plan_version)===String(plan.version_no));
      if(!stillCurrent){
        const error=new Error('Lesson preparation parent authority changed before AI output capture.');
        error.code='TEACHING_D11_PREPARATION_PARENT_SUPERSEDED';
        error.retryable=false;
        error.status=409;
        throw error;
      }
      if (!workspace || !workspace.current_authoritative_input_bundle_ref) {
        const error = new Error('D11 preparation workspace/input bundle is required before prepared artifact capture.');
        error.code = 'TEACHING_D11_PPL_WORKSPACE_REQUIRED';
        error.status = 409;
        throw error;
      }
      const versions = await tx.query(
        "select coalesce(max(version_no),0)+1 next_version from teaching_preparation.artifact_versions where workspace_id=$1",
        [workspace.workspace_id]
      );
      const versionNo=Number(versions.rows[0].next_version);
      const artifactId=randomUUID();
      const digest=stableDigest(blueprint);
      const parent=workspace.current_artifact_version_ref || null;
      await tx.query(
        "insert into teaching_preparation.artifact_versions(" +
        "artifact_version_id,workspace_id,student_id,artifact_kind,version_no,input_bundle_id,parent_artifact_version_id," +
        "created_by_capability_id,prompt_family_ref,schema_version,artifact_digest,protected_content_class,validity_state,concise_rationale" +
        ") values($1,$2,$3,'LESSON_BLUEPRINT',$4,$5,$6,$7,$8,'d11.lesson-blueprint.v1',$9,'UNPROTECTED','CURRENT',$10)",
        [
          artifactId,workspace.workspace_id,studentId,versionNo,workspace.current_authoritative_input_bundle_ref,
          parent,capabilityId,promptFamilyRef,digest,'Validated provisional Lesson Blueprint candidate',
        ]
      );
      await tx.query(
        "insert into teaching_protected.prepared_artifact_payloads(" +
        "artifact_version_id,student_id,protected_content_class,payload_schema_version,payload,payload_digest" +
        ") values($1,$2,'UNPROTECTED','d11.lesson-blueprint.v1',$3::jsonb,$4)",
        [artifactId,studentId,JSON.stringify(blueprint),digest]
      );
      const depRows=await tx.query(
        "select input_dependency_id,aggregate_ref from teaching_preparation.input_bundle_dependencies where input_bundle_id=$1 order by input_dependency_id",
        [workspace.current_authoritative_input_bundle_ref]
      );
      const components=[
        ...(blueprint.objectives || []).map((item)=>({key:'objective:'+item.id,kind:'OBJECTIVE',value:item})),
        ...(blueprint.segments || []).map((item)=>({key:'segment:'+item.id,kind:'SEGMENT',value:item})),
      ];
      for (const component of components) {
        const componentId=randomUUID();
        await tx.query(
          "insert into teaching_preparation.artifact_components(" +
          "artifact_component_id,artifact_version_id,student_id,component_key,component_kind,component_digest,stale" +
          ") values($1,$2,$3,$4,$5,$6,false)",
          [componentId,artifactId,studentId,component.key,component.kind,stableDigest(component.value)]
        );
        for (const dep of depRows.rows || []) {
          await tx.query(
            "insert into teaching_preparation.component_dependencies(" +
            "component_dependency_id,artifact_component_id,input_dependency_id,student_id,dependency_role" +
            ") values($1,$2,$3,$4,'AUTHORITATIVE_INPUT')",
            [randomUUID(),componentId,dep.input_dependency_id,studentId]
          );
        }
      }
      const updated=await tx.query(
        "update teaching_preparation.workspaces set current_artifact_version_ref=$2,last_material_review_at=$3," +
        " state_version=state_version+1,updated_at=now() where workspace_id=$1 returning *",
        [workspace.workspace_id,artifactId,clock()]
      );
      return Object.freeze({
        workspace:updated.rows[0],
        artifact:Object.freeze({
          artifact_version_id:artifactId,
          workspace_id:workspace.workspace_id,
          version_no:versionNo,
          input_bundle_id:workspace.current_authoritative_input_bundle_ref,
          artifact_digest:digest,
          parent_artifact_version_id:parent,
        }),
        componentCount:components.length,
      });
    }
  }
  async function recordPreparationArtifact(args={}){
    return withTransaction(tx=>recordPreparationArtifactUsing(tx,args));
  }



  async function getPreparationArtifactPayload(studentId, classId) {
    const workspace=await getPreparationWorkspace(studentId,classId);
    if(!workspace?.current_artifact_version_ref) return null;
    const {rows}=await query(
      "select av.*,p.payload,p.payload_schema_version,p.payload_digest from teaching_preparation.artifact_versions av" +
      " join teaching_protected.prepared_artifact_payloads p on p.artifact_version_id=av.artifact_version_id" +
      " where av.artifact_version_id=$1 and av.student_id=$2 limit 1",
      [workspace.current_artifact_version_ref,studentId]
    );
    return rows?.[0] || null;
  }

  async function currentDependencyVersion(dependency) {
    const ref=String(dependency?.aggregate_ref || '');
    if (ref.startsWith('course:')) {
      const {rows}=await query("select state_version from public.teaching_courses where course_id=$1 limit 1",[ref.slice(7)]);
      return rows?.[0]?.state_version == null ? null : String(rows[0].state_version);
    }
    if (ref.startsWith('course-plan:')) {
      const {rows}=await query("select version_no from public.teaching_course_plans where course_plan_id=$1 limit 1",[ref.slice(12)]);
      return rows?.[0]?.version_no == null ? null : String(rows[0].version_no);
    }
    if (ref.startsWith('class:')) {
      const {rows}=await query("select schedule_version from public.teaching_classes where class_id=$1 limit 1",[ref.slice(6)]);
      return rows?.[0]?.schedule_version == null ? null : String(rows[0].schedule_version);
    }
    if (ref.startsWith('timetable:')) {
      const {rows}=await query("select version_no from public.teaching_timetable_versions where timetable_version_id=$1 limit 1",[ref.slice(10)]);
      return rows?.[0]?.version_no == null ? null : String(rows[0].version_no);
    }
    if (ref.startsWith('diagnostic-plan:')) {
      const {rows}=await query("select plan_version from public.teaching_diagnostic_plans where diagnostic_plan_id=$1 limit 1",[ref.slice(16)]);
      return rows?.[0]?.plan_version == null ? null : String(rows[0].plan_version);
    }
    if (ref.startsWith('vpk:')) {
      const {rows}=await query("select decided_at,policy_version from public.teaching_validated_prior_knowledge_decisions where vpk_decision_id=$1 limit 1",[ref.slice(4)]);
      return rows?.[0] ? String(rows[0].decided_at || rows[0].policy_version || ref.slice(4)) : null;
    }
    if (ref.startsWith('schedule-debt:')) {
      const {rows}=await query("select recorded_at from public.teaching_schedule_debt_entries where schedule_debt_entry_id=$1 limit 1",[ref.slice(14)]);
      return rows?.[0]?.recorded_at == null ? null : String(rows[0].recorded_at);
    }
    if (ref.startsWith('class-closure:')) {
      const {rows}=await query("select fact_pack_version from public.teaching_class_closure_facts where closure_fact_id=$1 limit 1",[ref.slice(14)]);
      return rows?.[0]?.fact_pack_version == null ? null : String(rows[0].fact_pack_version);
    }
    if (ref.startsWith('teacher-note:')) {
      const {rows}=await query("select created_at from public.teaching_post_class_teacher_notes where teacher_note_id=$1 limit 1",[ref.slice(13)]);
      return rows?.[0]?.created_at == null ? null : String(rows[0].created_at);
    }
    if (ref.startsWith('request:')) {
      const {rows}=await query("select state_version from public.teaching_requests where request_id=$1 limit 1",[ref.slice(8)]);
      return rows?.[0]?.state_version == null ? null : String(rows[0].state_version);
    }
    return null;
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
    // Take a shared lock on the timetable authority, not just on its Class
    // projection. A D10 supersession cannot commit between this final
    // validation and the validated Blueprint insert.
    const {rows:timetableRows}=await tx.query(
      'select timetable_state from public.teaching_timetable_versions where student_id=$1 and timetable_version_id=$2 for share',
      [expected.studentId,classRow.source_timetable_version_id]
    );
    const mismatches = [];
    if (classRow.lifecycle_state!=='SCHEDULED') mismatches.push('CLASS_NOT_SCHEDULED');
    if (classRow.course_lifecycle_state!=='ACTIVE') mismatches.push('COURSE_NOT_ACTIVE');
    if (classRow.source_timetable_state!=='APPROVED'||timetableRows?.[0]?.timetable_state!=='APPROVED')
      mismatches.push('TIMETABLE_NOT_APPROVED');
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

  async function assertLiveContextCurrent(studentId,classId) {
    const context = await getClassContext(studentId,classId);
    if (!context?.session) return { ok:false, reason:'CONTROLLER_NOT_STARTED', context };
    const mismatches = [];
    const session = context.session;
    const klass = context.classRow;
    const plan = context.plan;
    if (String(klass.course_lifecycle_state) !== 'ACTIVE') mismatches.push('COURSE_LIFECYCLE');
    if (String(klass.lifecycle_state) === 'CANCELLED') mismatches.push('CLASS_CANCELLED');
    if (String(session.source_course_state_version) !== String(klass.course_state_version)) mismatches.push('COURSE_VERSION');
    if (String(session.source_class_schedule_version) !== String(klass.schedule_version)) mismatches.push('CLASS_SCHEDULE_VERSION');
    if (String(session.source_timetable_version_id || '') !== String(klass.source_timetable_version_id || '')) mismatches.push('TIMETABLE_VERSION');
    if (String(session.course_plan_id || '') !== String(plan?.course_plan_id || '')) mismatches.push('COURSE_PLAN');
    if (String(session.source_course_plan_version || '') !== String(plan?.version_no || '')) mismatches.push('COURSE_PLAN_VERSION');
    return Object.freeze({ ok:mismatches.length===0, reason:mismatches.length?'STALE_LIVE_CONTEXT':null, mismatches:Object.freeze(mismatches), context });
  }

  async function commitClassroomBlueprint({studentId,classId,expected,blueprint,validationMetadata,generationProvenance}) {
    return withTransaction(async tx=>{
      const artifact=await recordPreparationArtifactUsing(tx,{studentId,classId,blueprint,capabilityId:'teaching.lesson.pre_class_lesson_planning',promptFamilyRef:'TPF-05@2.0'});
      return saveBlueprintUsing(tx,{studentId,classId,expected,blueprint,validationMetadata:{...validationMetadata,ppl_artifact_version_id:artifact.artifact.artifact_version_id},generationProvenance,preparationRef:artifact.artifact.artifact_version_id});
    });
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
    if (!session && outboxStore) {
      const { TEACHING_EVENTS } = require('../events/names');
      const { EVENT_CATEGORIES } = require('../runtime/constants');
      const eventId=`d14-lesson-plan-approved:${blueprintId}`;
      await outboxStore.appendUsing(tx.query.bind(tx),{
        eventId,schemaVersion:1,eventType:TEACHING_EVENTS.LESSON_PLAN_APPROVED,
        eventCategory:EVENT_CATEGORIES.COMMITTED_DOMAIN_EVENT,triggerType:'committed_domain_event',
        source:'teaching.d11',origin:'d11',actorId:studentId,aggregateType:'CLASS',aggregateId:classId,
        aggregateVersion:versionNo,occurredAt:clock().toISOString(),effectiveAt:clock().toISOString(),dueAt:null,
        correlationId:eventId,causationId:null,idempotencyKey:eventId,
        payload:{student_id:studentId,class_id:classId,lesson_blueprint_id:blueprintId,lesson_blueprint_version:versionNo},
        auditRefs:[],provenanceRefs:[`lesson-blueprint:${blueprintId}`],
      });
    }
    let nextSession = session;
    if (session) {
      const updated = await tx.query(
        "update public.teaching_class_sessions set lesson_blueprint_id=$3," +
        " resume_instructional_substate=case when lesson_blueprint_id is null and instructional_substate='INTERRUPTED' then 'OPENING' else resume_instructional_substate end," +
        " state_version=state_version+1,event_cursor=event_cursor+1,updated_at=now()" +
        " where class_session_id=$1 and student_id=$2 returning *",
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
    bindBlueprint = true,
    sourceEventRef = null,
    idempotencyKey = null,
    allowRouteHeldStart = false,
  } = {}) {
    const classRow = await loadClassBase(studentId,classId,tx,true);
    if (!classRow) return null;
    const existing = await getSession(studentId,classId,tx,true);
    if (existing) return Object.freeze({ session:existing, inserted:false });
    const plan = await loadCurrentPlan(studentId,classRow.course_id,tx,true);
    // Close the supersession race even when the timetable changed without
    // touching the Class row's schedule_version.
    const approvedTimetable=await tx.query(
      'select timetable_state from public.teaching_timetable_versions where student_id=$1 and timetable_version_id=$2 for share',
      [studentId,classRow.source_timetable_version_id]
    );
    let blueprint = await latestBlueprint(studentId,classId,tx,true);
    if (!plan) {
      const error = new Error('Current Course Plan is required before Controller start.');
      error.code = 'TEACHING_D11_COURSE_PLAN_REQUIRED';
      error.status = 409;
      throw error;
    }
    if (bindBlueprint === false) blueprint = null;
    if (expectedBlueprintId && (!blueprint || blueprint.lesson_blueprint_id !== expectedBlueprintId)) {
      const error = new Error('Expected Lesson Blueprint is no longer current.');
      error.code = 'TEACHING_D11_BLUEPRINT_STALE';
      error.status = 409;
      throw error;
    }
    if (!blueprint && !allowRouteHeldStart) {
      const error = new Error('Validated current Lesson Blueprint is required before Controller start.');
      error.code = 'TEACHING_D11_BLUEPRINT_REQUIRED';
      error.status = 409;
      throw error;
    }
    if (classRow.course_lifecycle_state !== 'ACTIVE'
      || classRow.lifecycle_state !== 'SCHEDULED'
      || classRow.source_timetable_state !== 'APPROVED'
      || approvedTimetable.rows?.[0]?.timetable_state !== 'APPROVED'
      || clock().getTime()<Date.parse(classRow.scheduled_start_at)
      || clock().getTime()>=Date.parse(classRow.scheduled_end_at)) {
      const error = new Error('Class/Course/approved timetable is not eligible for new live Controller start.');
      error.code = 'TEACHING_D11_CLASS_NOT_ACTIVE';
      error.status = 409;
      throw error;
    }
    const now = clock();
    const sessionId = randomUUID();
    const routeHeld = !blueprint;
    const initialLifecycle = routeHeld ? 'INTERRUPTED' : 'ACTIVE';
    const initialSubstate = routeHeld ? 'INTERRUPTED' : 'OPENING';
    const inserted = await tx.query(
      "insert into public.teaching_class_sessions(" +
      "class_session_id,student_id,class_id,lesson_blueprint_id,lifecycle_state,instructional_substate,state_version," +
      "started_at,course_id,course_plan_id,source_course_state_version,source_course_plan_version," +
      "source_class_schedule_version,source_timetable_version_id,scheduled_start_at_snapshot,scheduled_end_at_snapshot," +
      "timezone_snapshot,event_cursor,progress_state,controller_contract_version" +
      ") values($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,1," +
      "'{\"completed_segment_refs\":[],\"completed_objective_refs\":[],\"evidence_event_refs\":[],\"independent_evidence_objective_refs\":[]}'::jsonb,'d11.controller.v1') returning *",
      [
        sessionId,studentId,classId,blueprint?.lesson_blueprint_id || null,initialLifecycle,initialSubstate,
        now,classRow.course_id,plan.course_plan_id,classRow.course_state_version,plan.version_no,
        classRow.schedule_version,classRow.source_timetable_version_id || null,
        classRow.scheduled_start_at,classRow.scheduled_end_at,classRow.timezone,
      ]
    );
    await appendHistoryUsing(tx, {
      studentId,classId,classSessionId:sessionId,controllerVersion:1,eventCursor:1,
      actionKind:routeHeld?'CONTROLLER_STARTED_ROUTE_HELD':'CONTROLLER_STARTED',fromState:null,toState:initialSubstate,
      reason:routeHeld
        ? 'Server-authoritative Class start preserved while Lesson Planner route is unavailable.'
        : 'Server-authoritative Class start established live instructional state.',
      sourceEventRef,idempotencyKey,
      safeMetadata:{
        lesson_blueprint_id:blueprint?.lesson_blueprint_id || null,
        route_degraded_without_blueprint:routeHeld,
        academic_penalty_created:false,
      },
    });
    await enqueueInstructionUsing(tx,outboxStore,inserted.rows[0]);
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
      cycle_phase:'cycle_phase',
      current_learning_evidence_descriptor:'current_learning_evidence_descriptor',
      current_assistance_level:'current_assistance_level',
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
    await enqueueInstructionUsing(tx,outboxStore,next);
    return Object.freeze({ previous:session, session:next });
  }

  async function recordProgressUsing(tx, {
    studentId,classId,expectedVersion,completedSegmentRefs=[],completedObjectiveRefs=[],evidenceRefs=[],independentEvidenceObjectiveRefs=[],
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
    let loadedEvidence=[];
    if (evidenceRefs.length) {
      const evidence = await tx.query(
        "select evidence_event_id,independent_performance,response_quality from public.teaching_evidence_events where student_id=$1" +
        " and class_session_id=$2 and evidence_event_id=any($3::text[])",
        [studentId,session.class_session_id,evidenceRefs.map(String)]
      );
      loadedEvidence=evidence.rows || [];
      if (loadedEvidence.length !== new Set(evidenceRefs.map(String)).size) {
        const error = new Error('Every progress evidence reference must belong to the current Class session.');
        error.code = 'TEACHING_D11_PROGRESS_EVIDENCE_INVALID';
        error.status = 422;
        throw error;
      }
    }
    const independentRefs = [...new Set(independentEvidenceObjectiveRefs.map(String))];
    if (independentRefs.some((ref) => !validObjectives.has(ref))) {
      const error = new Error('Independent-evidence progress references an unknown objective.');
      error.code = 'TEACHING_D11_INDEPENDENT_EVIDENCE_REF_INVALID';
      error.status = 422;
      throw error;
    }
    if (independentRefs.length) {
      const supported=new Set();
      for(const row of loadedEvidence) {
        if(row.independent_performance!==true) continue;
        const quality=row.response_quality || {};
        const refs=[
          ...(quality.objective_ref?[String(quality.objective_ref)]:[]),
          ...(Array.isArray(quality.objective_refs)?quality.objective_refs.map(String):[]),
        ];
        for(const ref of refs) supported.add(ref);
      }
      const unsupported=independentRefs.filter((ref)=>!supported.has(ref));
      if (unsupported.length) {
        const error = new Error('Independent objective progress requires objective-linked independent-performance evidence.');
        error.code = 'TEACHING_D11_INDEPENDENT_EVIDENCE_REQUIRED';
        error.status = 422;
        error.unsupportedObjectiveRefs=unsupported;
        throw error;
      }
    }
    const prior = session.progress_state || {};
    const progress = {
      completed_segment_refs:[...new Set([...(prior.completed_segment_refs || []),...segments])],
      completed_objective_refs:[...new Set([...(prior.completed_objective_refs || []),...objectives])],
      evidence_event_refs:[...new Set([...(prior.evidence_event_refs || []),...evidenceRefs.map(String)])],
      independent_evidence_objective_refs:[...new Set([...(prior.independent_evidence_objective_refs || []),...independentRefs])],
    };
    return transitionUsing(tx, {
      studentId,classId,expectedVersion,toState:session.instructional_substate,
      lifecycleState:session.lifecycle_state,reason:'Controller progress checkpoint',
      actionKind:'PROGRESS_CHECKPOINT',safeMetadata:{new_segment_refs:segments,new_objective_refs:objectives,evidence_refs:evidenceRefs,independent_evidence_objective_refs:independentRefs},
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

  async function commitClosureUsing(tx, {
    studentId,classId,expectedVersion,reason='CONTROLLER_CLOSURE',sourceEventRef=null,idempotencyKey=null,
  } = {}) {
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
  }

  async function commitClosure(args = {}) {
    return withTransaction((tx)=>commitClosureUsing(tx,args));
  }

  async function getClosureFact(studentId,classId) {
    const {rows}=await query(
      "select * from public.teaching_class_closure_facts where student_id=$1 and class_id=$2 limit 1",
      [studentId,classId]
    );
    return rows?.[0] || null;
  }

  async function persistSummary({
    studentId,classId,classSessionId,closureFactId,state,payload={},provenance={},idempotencyKey=null,
  } = {}) {
    return withTransaction(async (tx) => {
      if (idempotencyKey) {
        const prior=await tx.query(
          "select * from public.teaching_class_summaries where student_id=$1 and idempotency_key=$2 limit 1",
          [studentId,idempotencyKey]
        );
        if(prior.rows?.[0]) return prior.rows[0];
      }
      const versions = await tx.query(
        "select coalesce(max(version_no),0)+1 next_version from public.teaching_class_summaries where class_session_id=$1",
        [classSessionId]
      );
      const inserted = await tx.query(
        "insert into public.teaching_class_summaries(" +
        "class_summary_id,student_id,class_id,class_session_id,closure_fact_id,version_no,summary_state,summary_payload,translation_provenance,idempotency_key" +
        ") values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10) returning *",
        [
          randomUUID(),studentId,classId,classSessionId,closureFactId,Number(versions.rows[0].next_version),
          state,JSON.stringify(payload || {}),JSON.stringify(provenance || {}),idempotencyKey,
        ]
      );
      return inserted.rows[0];
    });
  }

  async function persistTeacherNote({
    studentId,courseId,classId,classSessionId,closureFactId,state,payload={},provenanceRefs=[],generationProvenance={},idempotencyKey=null,
  } = {}) {
    return withTransaction(async (tx) => {
      if (idempotencyKey) {
        const prior=await tx.query(
          "select * from public.teaching_post_class_teacher_notes where student_id=$1 and idempotency_key=$2 limit 1",
          [studentId,idempotencyKey]
        );
        if(prior.rows?.[0]) return prior.rows[0];
      }
      const versions = await tx.query(
        "select coalesce(max(version_no),0)+1 next_version from public.teaching_post_class_teacher_notes where class_session_id=$1",
        [classSessionId]
      );
      const inserted = await tx.query(
        "insert into public.teaching_post_class_teacher_notes(" +
        "teacher_note_id,student_id,course_id,class_id,class_session_id,closure_fact_id,version_no,note_state,note_payload,provenance_refs,generation_provenance,idempotency_key" +
        ") values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12) returning *",
        [
          randomUUID(),studentId,courseId,classId,classSessionId,closureFactId,Number(versions.rows[0].next_version),state,
          JSON.stringify(payload || {}),JSON.stringify(provenanceRefs || []),JSON.stringify(generationProvenance || {}),idempotencyKey,
        ]
      );
      return inserted.rows[0];
    });
  }

  async function inheritRescheduledPreparation({studentId,fromClassId,toClassId,requestId}={}) {
    if(!studentId||!fromClassId||!toClassId||!requestId||fromClassId===toClassId)
      return Object.freeze({mode:'FRESH_PREPARATION',reason:'INCOMPLETE_LINEAGE'});
    // The D10 event is only a routing hint. Every authority check is repeated
    // against committed DB state under one D11-owned transaction.
    return withTransaction(async tx=>{
      const ids=[fromClassId,toClassId].sort();
      const {rows:locked=[]}=await tx.query(
        'select class_id from public.teaching_classes where student_id=$1 and class_id=any($2::text[]) order by class_id for update',
        [studentId,ids]);
      if(locked.length!==2)return Object.freeze({mode:'FRESH_PREPARATION',reason:'CLASS_NOT_FOUND'});
      const source=await loadClassBase(studentId,fromClassId,tx);
      const target=await loadClassBase(studentId,toClassId,tx);
      if(!source||!target)return Object.freeze({mode:'FRESH_PREPARATION',reason:'CLASS_NOT_FOUND'});
      const {rows:governingRows=[]}=await tx.query(
        'select request_id,student_id,course_id,request_type,target_ref,target_version_ref,applied_at from public.teaching_requests where request_id=$1 and student_id=$2 for share',
        [requestId,studentId]);
      const approvedRequest=governingRows[0]||null;
      const original=await loadCurrentPlan(studentId,source.course_id,tx);
      if(!original)return Object.freeze({mode:'FRESH_PREPARATION',reason:'COURSE_PLAN_MISSING'});
      const sessionRows=await tx.query(
        'select class_id from public.teaching_class_sessions where student_id=$1 and class_id=any($2::text[]) limit 1',
        [studentId,ids]);
      const sourceHasSession=(sessionRows.rows||[]).some(row=>row.class_id===fromClassId);
      const targetHasSession=(sessionRows.rows||[]).some(row=>row.class_id===toClassId);
      // A PostgreSQL transaction is ONE client: never concurrently call
      // client.query() (deprecated and unsafe on pg@9). Keep the locked
      // authority reads on the same transaction in a fixed order.
      const oldSlotQuery=await tx.query(
        'select * from public.teaching_timetable_slots where student_id=$1 and timetable_slot_id=$2',
        [studentId,source.source_timetable_slot_id]);
      const newSlotQuery=await tx.query(
        'select * from public.teaching_timetable_slots where student_id=$1 and timetable_slot_id=$2',
        [studentId,target.source_timetable_slot_id]);
      const oldSlot=oldSlotQuery.rows?.[0],newSlot=newSlotQuery.rows?.[0];
      const already=await latestBlueprint(studentId,toClassId,tx,true);
      if(already)return Object.freeze({mode:'ALREADY_PREPARED',reason:'TARGET_BLUEPRINT_EXISTS'});
      const targetWorkspace=await getPreparationWorkspace(studentId,toClassId,tx,true);
      // A provisional new-Class artifact must not suppress reuse of an older
      // fully validated, still-compatible lesson. Decide the source quality
      // first; only an inherited VALIDATED Blueprint may supersede provisional
      // new-Class work (with all pending AI jobs fenced and audited).
      const {rows:oldBlueprints=[]}=await tx.query(
        "select * from public.teaching_lesson_blueprints where student_id=$1 and class_id=$2 and blueprint_state in ('VALIDATED','SUPERSEDED') order by version_no desc limit 1",
        [studentId,fromClassId]);
      const sourceBlueprint=oldBlueprints[0]||null;
      let sourcePreparation=null;
      if(!sourceBlueprint){
        const {rows:drafts=[]}=await tx.query(`
          select a.artifact_version_id,a.validity_state,p.payload,w.maturity_stage,b.preconditions
          from teaching_preparation.workspaces w
          join teaching_preparation.artifact_versions a on a.workspace_id=w.workspace_id
          join teaching_protected.prepared_artifact_payloads p on p.artifact_version_id=a.artifact_version_id
          join teaching_preparation.authoritative_input_bundles b on b.input_bundle_id=a.input_bundle_id
          where w.student_id=$1 and w.target_ref=$2 and w.workspace_type='LESSON_BLUEPRINT'
            and a.student_id=$1 and p.student_id=$1 and a.artifact_kind='LESSON_BLUEPRINT'
            and a.validity_state='CURRENT' and p.protected_content_class='UNPROTECTED'
          order by a.created_at desc,a.version_no desc limit 1
        `,[studentId,fromClassId]);
        sourcePreparation=drafts[0]||null;
      }
      const learningUnits=await loadLearningUnits(studentId,original.course_plan_id,tx);
      const decision=evaluateLessonInheritance({
        source,target,plan:original,sourceSlot:oldSlot,targetSlot:newSlot,
        sourceBlueprint,sourcePreparation,learningUnits,sourceHasSession,targetHasSession,
        now:clock(),requestId,approvedRequest,
      });
      if(decision.mode==='FRESH_PREPARATION')return decision;
      if(decision.mode!=='INHERIT_VALIDATED_BLUEPRINT'
        &&targetWorkspace?.current_artifact_version_ref)
        return Object.freeze({mode:'ALREADY_PREPARED',reason:'TARGET_ARTIFACT_EXISTS'});
      const blueprint=decision.validatedContent;
      let newBlueprintId=null,newArtifactId=null;
      if(decision.mode==='INHERIT_VALIDATED_BLUEPRINT'){
        // An earlier REQUEST_APPLIED materiality pass may have seeded an
        // empty successor SKELETON. Retire it before publishing a completely
        // validated inherited Blueprint: otherwise D11 start would mistake
        // the unfinished (possibly already provisional) new preparation for
        // an authoritative completed lesson that has independently revalidated.
        if(targetWorkspace){
          await tx.query(`
            update teaching_preparation.workspaces set lifecycle_state='SUPERSEDED',
              cancellation_reason='BLUEPRINT_INHERITED_REVALIDATED',
              state_version=state_version+1,next_review_due_at=null,updated_at=now()
            where workspace_id=$1 and state_version=$2
              and lifecycle_state in ('ACTIVE','FINALIZATION_DUE','FINALIZED')
          `,[targetWorkspace.workspace_id,targetWorkspace.state_version]);
          await tx.query(`
            update teaching_runtime.event_outbox set status='CANCELLED',
              last_error_code='TEACHING_D11_BLUEPRINT_ALREADY_INHERITED',
              updated_at=now()
            where aggregate_id=$1 and event_type like 'teaching.preparation.%'
              and status in ('PENDING','RETRY_WAIT')
          `,[targetWorkspace.workspace_id]);
          await tx.query(`
            update teaching_runtime.due_events set status='SUPERSEDED',
              resolution='SUPERSEDED',recovery_reason='BLUEPRINT_INHERITED_REVALIDATED',
              claim_token=null,claimed_by=null,claimed_at=null,claim_expires_at=null,updated_at=now()
            where payload->>'preparation_workspace_id'=$1
              and status in ('PENDING','RETRY_WAIT')
              and event_type='teaching.preparation.review_due'
          `,[targetWorkspace.workspace_id]);
        }
        const result=await saveBlueprintUsing(tx,{
          studentId,classId:toClassId,expected:{
            studentId,classId:toClassId,
            courseLifecycleState:target.course_lifecycle_state,
            courseStateVersion:target.course_state_version,
            classScheduleVersion:target.schedule_version,
            timetableVersionId:target.source_timetable_version_id,
            coursePlanId:original.course_plan_id,coursePlanVersion:original.version_no,
          },
          blueprint,
          validationMetadata:{
            deterministic_validation:'PASS',
            inheritance_validation:'PASS',
            inherited_from_blueprint_id:decision.originBlueprintId,
            reused_without_new_model_call:true,
          },
          generationProvenance:{
            capability_id:'teaching.lesson.pre_class_lesson_planning',
            prompt_family_id:'TPF-05',authority_ceiling:'T3',
            preparation_inheritance:'REVALIDATED_SAME_DURATION',
            source_class_id:fromClassId,source_blueprint_id:decision.originBlueprintId,
            governing_request_id:requestId,
          },
          preparationRef:null,
        });
        newBlueprintId=result.blueprint.lesson_blueprint_id;
      }else{
        // Partial PPL work is a candidate, NOT a published Blueprint. Rebind
        // artifact/bundle/component dependencies to the replacement Class.
        const prep=await ensurePreparationWorkspaceUsing(tx,{
          studentId,classId:toClassId,correlationId:'d11-inherit:'+requestId,
          expectedTimetableVersionId:target.source_timetable_version_id,
          expectedScheduleVersion:target.schedule_version,
        });
        if(!prep?.workspace||prep.workspace.current_artifact_version_ref)
          return Object.freeze({mode:'FRESH_PREPARATION',reason:'TARGET_WORKSPACE_CHANGED'});
        const copy=await recordPreparationArtifactUsing(tx,{
          studentId,classId:toClassId,blueprint,
        });
        newArtifactId=copy.artifact.artifact_version_id;
        // Every inherited stage has already undergone D11 validation against
        // the replacement's time and Course Plan, but PRE_LOCK_READY is never
        // inherited as finalized without a fresh owner commit.
        const stages=['SKELETON','STRUCTURED','CANDIDATE'];
        const index=Math.min(2,Math.max(0,stages.indexOf(decision.sourceMaturity||'SKELETON')));
        // Record the validated draft's new current version, not the previous
        // workspace version from before artifact capture. Every maturity
        // transition is CAS-fenced and must actually commit.
        let expectedWorkspaceVersion=Number(copy.workspace.state_version);
        for(let i=1;i<=index;i++){
          const from=stages[i-1],to=stages[i];
          const decisionForStage=evaluateWorkspaceTransition({
            currentLifecycle:'ACTIVE',currentMaturity:from,nextMaturity:to,
            gateResults:[{id:'d11-inherited-artifact-new-authority-validated',passed:true}],
            routePosture:to==='CANDIDATE'?'strong_design':'bounded_interpretive',
          });
          const advanced=await tx.query(
            "update teaching_preparation.workspaces set maturity_stage=$2,state_version=state_version+1,updated_at=now()"+
            " where workspace_id=$1 and maturity_stage=$3 and state_version=$4 and lifecycle_state='ACTIVE' returning state_version",
            [prep.workspace.workspace_id,decisionForStage.nextMaturity,from,expectedWorkspaceVersion]);
          if(advanced.rows?.length!==1){
            const e=new Error('Validated inherited PPL maturity changed before commit.');
            e.code='TEACHING_D11_PPL_INHERITANCE_VERSION_CONFLICT';
            e.status=409;throw e;
          }
          expectedWorkspaceVersion=Number(advanced.rows[0].state_version);
        }
      }
      await tx.query(`
        insert into public.teaching_academic_audit_log(
          audit_id,student_id,occurred_at,actor_type,actor_id,action,entity_type,entity_id,
          authoritative_owner,state_version_ref,correlation_id,causation_id,reason,before_ref,after_ref,
          provenance_refs,safe_metadata)
        values($1,$2,now(),'SYSTEM',null,'lesson.preparation.revalidated_inheritance',
          'CLASS',$3,'Teaching Controller / Lesson Planner',$4,$5,null,$6,
          $7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb)
      `,[
        randomUUID(),studentId,toClassId,String(target.schedule_version),requestId,
        decision.reason,JSON.stringify({from_class_id:fromClassId}),
        JSON.stringify({to_class_id:toClassId,lesson_blueprint_id:newBlueprintId,artifact_version_id:newArtifactId}),
        JSON.stringify(['class:'+fromClassId,'class:'+toClassId,'request:'+requestId]),
        JSON.stringify({reuse_mode:decision.mode,validated_by:'D11_DETERMINISTIC',model_calls:0}),
      ]);
      return Object.freeze({mode:decision.mode,reason:decision.reason,
        classId:toClassId,originClassId:fromClassId,
        blueprintId:newBlueprintId,artifactId:newArtifactId});
    });
  }

  async function getGovernedRequest(requestId) {
    const {rows}=await query(
      "select * from public.teaching_requests where request_id=$1 limit 1",
      [requestId]
    );
    return rows?.[0] || null;
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
    listClassesForApprovedTimetable,
    listClassesForAppliedScheduleRequest,
    ensurePreparationWorkspace,
    ensurePreparationWorkspaceUsing,
    recordPreparationArtifact,
    getPreparationArtifactPayload,
    currentDependencyVersion,
    assertContextCurrentUsing,
    assertLiveContextCurrent,
    saveBlueprint,
    commitClassroomBlueprint,
    saveBlueprintUsing,
    latestBlueprint,
    getSession,
    ensureControllerStartedUsing,
    transitionUsing,
    recordProgressUsing,
    closureContext,
    commitClosure,
    commitClosureUsing,
    getClosureFact,
    persistSummary,
    persistTeacherNote,
    getGovernedRequest,
    inheritRescheduledPreparation,
    latestSummary,
    latestTeacherNote,
  });
}

module.exports = { createD11LessonControllerRepository };
