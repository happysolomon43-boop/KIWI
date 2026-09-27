'use strict';

async function materializePlanGraph(ctx, tx, { studentId, coursePlanId, setup, plan }) {
  const { q, randomUUID, json } = ctx;
  const topicIdMap = new Map();
  const subtopicIdMap = new Map();
  for (const topic of plan.topics) {
    const topicId = randomUUID();
    topicIdMap.set(topic.id, topicId);
    await q(tx, `insert into public.teaching_topics(topic_id,student_id,course_plan_id,title,ordinal,metadata) values($1,$2,$3,$4,$5,$6::jsonb)`, [topicId, studentId, coursePlanId, topic.title, topic.ordinal, json({ plan_node_ref: topic.id, contract_version: 'd08.course-plan.v1' })]);
    for (const subtopic of topic.subtopics) {
      const subtopicId = randomUUID();
      subtopicIdMap.set(subtopic.id, subtopicId);
      await q(tx, `insert into public.teaching_subtopics(subtopic_id,student_id,topic_id,title,ordinal,metadata) values($1,$2,$3,$4,$5,$6::jsonb)`, [subtopicId, studentId, topicId, subtopic.title, subtopic.ordinal, json({ plan_node_ref: subtopic.id, contract_version: 'd08.course-plan.v1' })]);
    }
  }

  const unitIdMap = new Map();
  const newUnits = [];
  for (const unit of plan.learning_units) {
    const unitId = randomUUID();
    unitIdMap.set(unit.id, unitId);
    const metadata = {
      plan_node_ref: unit.id,
      audit_unit_refs: unit.audit_unit_refs,
      instructional_mode: unit.instructional_mode,
      later_assessment_basis: unit.later_assessment_basis,
      planning_attention: unit.planning_attention,
      exit_condition_policy_version: 'learning-unit-exit-condition.v1',
    };
    await q(tx, `
      insert into public.teaching_learning_units(
        learning_unit_id,student_id,course_plan_id,topic_id,subtopic_id,title,intended_competence,
        exit_conditions,criticality,foundational,instructional_load_min_minutes,instructional_load_max_minutes,metadata
      ) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13::jsonb)
    `, [unitId, studentId, coursePlanId, topicIdMap.get(unit.topic_id), unit.subtopic_id ? subtopicIdMap.get(unit.subtopic_id) : null, unit.title, unit.intended_competence, json(unit.exit_conditions), unit.criticality, unit.foundational, unit.instructional_load_min_minutes, unit.instructional_load_max_minutes, json(metadata)]);
    newUnits.push({ ...unit, learning_unit_id: unitId, metadata });
  }

  for (const dependency of plan.dependencies) {
    await q(tx, `insert into public.teaching_learning_unit_dependencies(dependency_id,student_id,learning_unit_id,prerequisite_learning_unit_id,dependency_kind,rationale) values($1,$2,$3,$4,$5,$6)`, [randomUUID(), studentId, unitIdMap.get(dependency.learning_unit_id), unitIdMap.get(dependency.prerequisite_learning_unit_id), dependency.dependency_kind, dependency.rationale]);
  }
  for (const prerequisite of plan.assumed_prerequisites) {
    const latestDecision = [...(setup.vpkDecisions || [])].filter((decision) => decision.target_kind === 'PREREQUISITE' && String(decision.target_ref) === prerequisite.prerequisite_ref).sort((a, b) => String(b.decided_at || '').localeCompare(String(a.decided_at || '')))[0];
    await q(tx, `insert into public.teaching_course_plan_prerequisites(prerequisite_id,student_id,course_plan_id,prerequisite_ref,disclosure,validation_status,vpk_decision_id,policy_version) values($1,$2,$3,$4,$5,$6,$7,'validated-prior-knowledge.v1')`, [randomUUID(), studentId, coursePlanId, prerequisite.prerequisite_ref, prerequisite.disclosure, prerequisite.validation_status, latestDecision?.vpk_decision_id || null]);
  }
  return { topicIdMap, subtopicIdMap, unitIdMap, newUnits };
}

module.exports = { materializePlanGraph };
