'use strict';

function createPlanReader({ query }) {
  async function assertReady() {
    const { rows } = await query(`
      select
        to_regclass('public.teaching_course_plan_prerequisites') prerequisites,
        to_regclass('public.teaching_course_plan_source_mappings') mappings,
        to_regclass('public.teaching_course_plan_exclusions') exclusions,
        to_regclass('public.teaching_coverage_audits') audits,
        to_regclass('public.teaching_course_scope_changes') scope_changes,
        to_regclass('public.teaching_course_scope_change_applications') scope_applications
    `);
    if (Object.values(rows?.[0] || {}).some((value) => value == null)) {
      const error = new Error('Teaching D08 schema is not ready.');
      error.code = 'TEACHING_D08_SCHEMA_NOT_READY';
      throw error;
    }
    const { rows: columns = [] } = await query(`
      select table_name,column_name from information_schema.columns
      where table_schema='public' and (
        (table_name='teaching_course_plans' and column_name in ('curriculum_audit_id','plan_contract_version','source_inventory_digest','scope_diff_summary','review_summary'))
        or (table_name='teaching_source_content_items' and column_name in ('scope_version_no','supersedes_source_content_item_id','discovered_scope_change_id','superseded_at'))
      )
    `);
    if (columns.length < 9) {
      const error = new Error('Teaching D08 schema columns are not ready.');
      error.code = 'TEACHING_D08_SCHEMA_NOT_READY';
      throw error;
    }
    return true;
  }

  async function getBaseSetup(studentId, courseId) {
    const [course, intakes, sources, audits, diagnostics, vpk] = await Promise.all([
      query('select * from public.teaching_courses where student_id=$1 and course_id=$2', [studentId, courseId]),
      query('select * from public.teaching_student_course_intakes where student_id=$1 and course_id=$2 order by submitted_at desc', [studentId, courseId]),
      query(`select source_content_item_id,source_kind,source_ref,source_version_ref,locator,content_hash,content_summary,
                    academically_meaningful,classification,classification_reason,classifier_rule_version,scope_version_no,
                    supersedes_source_content_item_id,discovered_scope_change_id,discovered_at
               from public.teaching_source_content_items
              where student_id=$1 and course_id=$2 and superseded_at is null
              order by discovered_at,source_content_item_id`, [studentId, courseId]),
      query('select * from public.teaching_curriculum_audits where student_id=$1 and course_id=$2 order by audit_version desc', [studentId, courseId]),
      query('select * from public.teaching_diagnostic_plans where student_id=$1 and course_id=$2 order by plan_version desc', [studentId, courseId]),
      query('select * from public.teaching_validated_prior_knowledge_decisions where student_id=$1 and course_id=$2 order by decided_at desc', [studentId, courseId]),
    ]);
    if (!course.rows?.[0]) {
      const error = new Error('Teaching Course not found.');
      error.status = 404;
      error.code = 'TEACHING_COURSE_NOT_FOUND';
      throw error;
    }
    const curriculumAudit = audits.rows?.[0] || null;
    const auditCurrent = curriculumAudit?.status === 'VALIDATED_CANDIDATE';
    const diagnosticPlan = auditCurrent
      ? (diagnostics.rows || []).find((row) => String(row.curriculum_audit_id || '') === String(curriculumAudit.curriculum_audit_id || '')) || null
      : null;
    const auditAt = Date.parse(curriculumAudit?.created_at || '');
    const vpkDecisions = auditCurrent
      ? (vpk.rows || []).filter((row) => !Number.isFinite(auditAt) || Date.parse(row.decided_at || '') >= auditAt)
      : [];
    return {
      course: course.rows[0],
      intake: intakes.rows?.[0] || null,
      sources: sources.rows || [],
      curriculumAudit,
      diagnosticPlan,
      vpkDecisions,
    };
  }

  async function getLatestPlanBundle(studentId, courseId) {
    const { rows: plans = [] } = await query(
      `select * from public.teaching_course_plans where student_id=$1 and course_id=$2 and plan_state not in ('REVIEW_REQUIRED','SUPERSEDED') order by version_no desc limit 1`,
      [studentId, courseId],
    );
    const plan = plans[0] || null;
    const { rows: scopeChanges = [] } = await query(
      `select s.*,exists(select 1 from public.teaching_course_scope_change_applications a where a.scope_change_id=s.scope_change_id) applied
         from public.teaching_course_scope_changes s
        where s.student_id=$1 and s.course_id=$2
        order by s.detected_at desc`,
      [studentId, courseId],
    );
    if (!plan) {
      return {
        plan: null, topics: [], subtopics: [], learningUnits: [], dependencies: [], assumedPrerequisites: [],
        coverageMappings: [], exclusions: [], coverage: [], coverageAudits: [], lineage: [], scopeChanges,
      };
    }
    const results = await Promise.all([
      query(`select * from public.teaching_topics where student_id=$1 and course_plan_id=$2 order by ordinal,topic_id`, [studentId, plan.course_plan_id]),
      query(`select s.* from public.teaching_subtopics s join public.teaching_topics t on t.topic_id=s.topic_id where s.student_id=$1 and t.course_plan_id=$2 order by t.ordinal,s.ordinal,s.subtopic_id`, [studentId, plan.course_plan_id]),
      query(`select * from public.teaching_learning_units where student_id=$1 and course_plan_id=$2 order by created_at,learning_unit_id`, [studentId, plan.course_plan_id]),
      query(`select d.* from public.teaching_learning_unit_dependencies d join public.teaching_learning_units u on u.learning_unit_id=d.learning_unit_id where d.student_id=$1 and u.course_plan_id=$2 order by d.created_at,d.dependency_id`, [studentId, plan.course_plan_id]),
      query(`select * from public.teaching_course_plan_prerequisites where student_id=$1 and course_plan_id=$2 order by created_at,prerequisite_ref`, [studentId, plan.course_plan_id]),
      query(`select m.*,s.source_ref,s.source_kind,s.content_summary,u.title learning_unit_title
               from public.teaching_course_plan_source_mappings m
               join public.teaching_source_content_items s on s.source_content_item_id=m.source_content_item_id
               join public.teaching_learning_units u on u.learning_unit_id=m.learning_unit_id
              where m.student_id=$1 and m.course_plan_id=$2 order by m.created_at,m.mapping_id`, [studentId, plan.course_plan_id]),
      query(`select e.*,s.source_ref,s.content_summary from public.teaching_course_plan_exclusions e join public.teaching_source_content_items s on s.source_content_item_id=e.source_content_item_id where e.student_id=$1 and e.course_plan_id=$2 order by e.approved_at,e.exclusion_id`, [studentId, plan.course_plan_id]),
      query(`select c.*,s.source_ref,s.content_summary,s.classification,s.source_kind from public.teaching_course_coverage c join public.teaching_source_content_items s on s.source_content_item_id=c.source_content_item_id where c.student_id=$1 and c.course_plan_id=$2 order by c.found_at,c.coverage_entry_id`, [studentId, plan.course_plan_id]),
      query(`select * from public.teaching_coverage_audits where student_id=$1 and course_plan_id=$2 order by created_at desc`, [studentId, plan.course_plan_id]),
      query(`select l.*,p.title predecessor_title,s.title successor_title
               from public.teaching_learning_unit_lineage l
               join public.teaching_learning_units p on p.learning_unit_id=l.predecessor_learning_unit_id
               join public.teaching_learning_units s on s.learning_unit_id=l.successor_learning_unit_id
              where l.student_id=$1 and s.course_plan_id=$2 order by l.created_at,l.lineage_id`, [studentId, plan.course_plan_id]),
    ]);
    return {
      plan,
      topics: results[0].rows || [],
      subtopics: results[1].rows || [],
      learningUnits: results[2].rows || [],
      dependencies: results[3].rows || [],
      assumedPrerequisites: results[4].rows || [],
      coverageMappings: results[5].rows || [],
      exclusions: results[6].rows || [],
      coverage: results[7].rows || [],
      coverageAudits: results[8].rows || [],
      lineage: results[9].rows || [],
      scopeChanges,
    };
  }

  async function latestBackgroundPlanGeneration(studentId, courseId) {
    try {
      const { rows = [] } = await query(
        `select event_id,status,attempt_count,last_error_code,next_attempt_at,created_at,updated_at,published_at,aggregate_version,causation_id,payload
           from teaching_runtime.event_outbox
          where actor_id=$1
            and aggregate_type='teaching_course'
            and aggregate_id=$2
            and event_type='teaching.course_plan.generation_requested'
          order by created_at desc
          limit 1`,
        [studentId, courseId],
      );
      const row = rows[0] || null;
      if (row && String(row.status).toUpperCase() === 'RETRY_WAIT' && Number(row.attempt_count) >= 8) {
        return { ...row, status: 'CANCELLED', last_error_code: row.last_error_code || 'TEACHING_EVENT_RETRY_EXHAUSTED' };
      }
      return row;
    } catch {
      return null;
    }
  }

  async function getPlanReview(studentId, courseId) {
    const [base, plan, backgroundPlanGeneration] = await Promise.all([
      getBaseSetup(studentId, courseId),
      getLatestPlanBundle(studentId, courseId),
      latestBackgroundPlanGeneration(studentId, courseId),
    ]);
    return { ...base, ...plan, backgroundPlanGeneration };
  }

  return Object.freeze({ assertReady, getBaseSetup, getLatestPlanBundle, latestBackgroundPlanGeneration, getPlanReview });
}

module.exports = { createPlanReader };
