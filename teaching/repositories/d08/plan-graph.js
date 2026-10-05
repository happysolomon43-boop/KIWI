'use strict';

async function materializePlanGraph(ctx, tx, { studentId, coursePlanId, setup, plan }) {
  const { q, randomUUID, json } = ctx;
  const topicIdMap = new Map();
  const subtopicIdMap = new Map();
  for (const topic of plan.topics) {
    const topicId = randomUUID();
    topicIdMap.set(String(topic.key), topicId);
    await q(tx, `insert into public.teaching_topics(topic_id,student_id,course_plan_id,title,ordinal,metadata) values($1,$2,$3,$4,$5,$6::jsonb)`, [
      topicId, studentId, coursePlanId, topic.title, topic.ordinal,
      json({ canonical_key: topic.key, contract_version: 'd08.course-plan.v1' }),
    ]);
    for (const subtopic of topic.subtopics || []) {
      const subtopicId = randomUUID();
      subtopicIdMap.set(String(subtopic.key), subtopicId);
      await q(tx, `insert into public.teaching_subtopics(subtopic_id,student_id,topic_id,title,ordinal,metadata) values($1,$2,$3,$4,$5,$6::jsonb)`, [
        subtopicId, studentId, topicId, subtopic.title, subtopic.ordinal,
        json({ canonical_key: subtopic.key, contract_version: 'd08.course-plan.v1' }),
      ]);
    }
  }

  const unitIdMap = new Map();
  for (const [sequenceNo, unit] of plan.learning_units.entries()) {
    const unitId = randomUUID();
    unitIdMap.set(String(unit.key), unitId);
    const metadata = {
      canonical_key: unit.key,
      instructional_treatment: unit.instructional_treatment,
      vpk_basis_refs: unit.vpk_basis_refs || [],
      treatment_basis: unit.treatment_basis || null,
      follow_up_treatments: unit.follow_up_treatments || [],
      instructional_emphasis: unit.instructional_emphasis || null,
      emphasis_basis: unit.emphasis_basis || null,
      evidence_goal: unit.evidence_goal || null,
      student_intake_accommodation_notes: unit.student_intake_accommodation_notes || null,
      pedagogy_profile: unit.pedagogy_profile || {},
      exit_condition_policy_version: 'learning-unit-exit-condition.v1',
    };
    await q(tx, `
      insert into public.teaching_learning_units(
        learning_unit_id,student_id,course_plan_id,topic_id,subtopic_id,sequence_no,title,intended_competence,
        exit_conditions,criticality,foundational,instructional_load_min_minutes,instructional_load_max_minutes,metadata
      ) values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14::jsonb)
    `, [
      unitId, studentId, coursePlanId, topicIdMap.get(String(unit.topic_key)),
      unit.subtopic_key ? subtopicIdMap.get(String(unit.subtopic_key)) : null,
      sequenceNo, unit.title, unit.intended_competence, json(unit.exit_conditions), unit.criticality, unit.foundational,
      unit.instructional_load_min_minutes, unit.instructional_load_max_minutes, json(metadata),
    ]);
  }

  for (const dependency of plan.dependencies || []) {
    await q(tx, `insert into public.teaching_learning_unit_dependencies(dependency_id,student_id,learning_unit_id,prerequisite_learning_unit_id,dependency_kind,rationale) values($1,$2,$3,$4,'PREREQUISITE',$5)`, [
      randomUUID(), studentId, unitIdMap.get(String(dependency.learning_unit_key)),
      unitIdMap.get(String(dependency.prerequisite_learning_unit_key)), dependency.rationale || null,
    ]);
  }

  for (const prerequisite of plan.assumed_prerequisites || []) {
    const latestDecision = [...(setup.vpkDecisions || [])]
      .filter((decision) => decision.target_kind === 'PREREQUISITE' && String(decision.target_ref) === String(prerequisite.key))
      .sort((a,b) => new Date(b.decided_at || 0) - new Date(a.decided_at || 0))[0];
    const resolutionState = latestDecision?.decision_status === 'VALIDATED_PRIOR_KNOWLEDGE' ? 'VALIDATED_PRIOR_KNOWLEDGE' : 'ASSUMED';
    await q(tx, `
      insert into public.teaching_course_plan_prerequisites(
        prerequisite_id,student_id,course_plan_id,prerequisite_ref,label,description,disclosure_text,resolution_state,vpk_decision_id,policy_version
      ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,'validated-prior-knowledge.v1')
    `, [
      randomUUID(), studentId, coursePlanId, prerequisite.key, prerequisite.label, prerequisite.description || null,
      prerequisite.description || prerequisite.label, resolutionState, latestDecision?.vpk_decision_id || null,
    ]);
  }
  return { topicIdMap, subtopicIdMap, unitIdMap };
}

module.exports = { materializePlanGraph };
