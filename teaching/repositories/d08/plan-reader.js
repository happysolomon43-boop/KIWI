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
    return true;
  }

  async function getLatestPlanBundle(studentId, courseId) {
    const { rows: plans = [] } = await query(
      `select * from public.teaching_course_plans where student_id=$1 and course_id=$2 order by version_no desc limit 1`,
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
    if (!plan) return { plan: null, topics: [], subtopics: [], learningUnits: [], dependencies: [], prerequisites: [], mappings: [], exclusions: [], coverage: [], coverageAudits: [], scopeChanges };
    const [topics, subtopics, learningUnits, dependencies, prerequisites, mappings, exclusions, coverage, coverageAudits] = await Promise.all([
      query(`select * from public.teaching_topics where student_id=$1 and course_plan_id=$2 order by ordinal,topic_id`, [studentId, plan.course_plan_id]),
      query(`select s.* from public.teaching_subtopics s join public.teaching_topics t on t.topic_id=s.topic_id where s.student_id=$1 and t.course_plan_id=$2 order by t.ordinal,s.ordinal,s.subtopic_id`, [studentId, plan.course_plan_id]),
      query(`select * from public.teaching_learning_units where student_id=$1 and course_plan_id=$2 order by created_at,learning_unit_id`, [studentId, plan.course_plan_id]),
      query(`select d.* from public.teaching_learning_unit_dependencies d join public.teaching_learning_units u on u.learning_unit_id=d.learning_unit_id where d.student_id=$1 and u.course_plan_id=$2 order by d.created_at,d.dependency_id`, [studentId, plan.course_plan_id]),
      query(`select * from public.teaching_course_plan_prerequisites where student_id=$1 and course_plan_id=$2 order by created_at,prerequisite_ref`, [studentId, plan.course_plan_id]),
      query(`select m.*,s.source_ref,s.source_kind,s.content_summary,u.title learning_unit_title from public.teaching_course_plan_source_mappings m join public.teaching_source_content_items s on s.source_content_item_id=m.source_content_item_id join public.teaching_learning_units u on u.learning_unit_id=m.learning_unit_id where m.student_id=$1 and m.course_plan_id=$2 order by m.created_at,m.mapping_id`, [studentId, plan.course_plan_id]),
      query(`select e.*,s.source_ref,s.content_summary from public.teaching_course_plan_exclusions e join public.teaching_source_content_items s on s.source_content_item_id=e.source_content_item_id where e.student_id=$1 and e.course_plan_id=$2 order by e.approved_at,e.exclusion_id`, [studentId, plan.course_plan_id]),
      query(`select c.*,s.source_ref,s.content_summary,s.classification,s.source_kind from public.teaching_course_coverage c join public.teaching_source_content_items s on s.source_content_item_id=c.source_content_item_id where c.student_id=$1 and c.course_plan_id=$2 order by c.found_at,c.coverage_entry_id`, [studentId, plan.course_plan_id]),
      query(`select * from public.teaching_coverage_audits where student_id=$1 and course_plan_id=$2 order by created_at desc`, [studentId, plan.course_plan_id]),
    ]);
    return {
      plan,
      topics: topics.rows || [], subtopics: subtopics.rows || [], learningUnits: learningUnits.rows || [],
      dependencies: dependencies.rows || [], prerequisites: prerequisites.rows || [], mappings: mappings.rows || [],
      exclusions: exclusions.rows || [], coverage: coverage.rows || [], coverageAudits: coverageAudits.rows || [], scopeChanges,
    };
  }

  return Object.freeze({ assertReady, getLatestPlanBundle });
}

module.exports = { createPlanReader };
