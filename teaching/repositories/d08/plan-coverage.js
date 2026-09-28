'use strict';

async function materializePlanCoverage(ctx, tx, { studentId, course, coursePlanId, setup, plan, graph, coverage, previousPlan, version, now }) {
  const { q, randomUUID, json } = ctx;
  const sourceByRef = new Map((setup.sources || []).map((source) => [String(source.source_ref), source]));
  const coverageIdBySource = new Map();

  for (const entry of coverage.entries || []) {
    const source = sourceByRef.get(String(entry.source_ref));
    if (!source) {
      const error = new Error(`Coverage references unknown source ${entry.source_ref}.`);
      error.code = 'TEACHING_D08_COVERAGE_SOURCE_UNKNOWN';
      throw error;
    }
    const coverageId = randomUUID();
    coverageIdBySource.set(String(entry.source_ref), coverageId);
    const firstUnitKey = entry.mapped_learning_unit_keys?.[0] || null;
    const firstUnitId = firstUnitKey ? graph.unitIdMap.get(String(firstUnitKey)) : null;
    const unit = firstUnitKey ? plan.learning_units.find((candidate) => String(candidate.key) === String(firstUnitKey)) : null;
    const topicId = unit ? graph.topicIdMap.get(String(unit.topic_key)) : null;
    const subtopicId = unit?.subtopic_key ? graph.subtopicIdMap.get(String(unit.subtopic_key)) : null;
    await q(tx, `
      insert into public.teaching_course_coverage(
        coverage_entry_id,student_id,course_id,course_plan_id,source_content_item_id,topic_id,subtopic_id,learning_unit_id,
        found_at,mapped_at,planned_at,validated_prior_knowledge_at,instructionally_complete_at,excluded_at,exclusion_reason,
        instructional_completion_basis,coverage_version,updated_at
      ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    `, [
      coverageId, studentId, course.course_id, coursePlanId, source.source_content_item_id, topicId || null, subtopicId || null,
      firstUnitId || null, source.discovered_at || now, entry.mapped_at, entry.planned_at, entry.validated_prior_knowledge_at,
      entry.instructionally_complete_at, entry.excluded ? now : null, entry.exclusion_reason, entry.instructional_completion_basis,
      version, now,
    ]);

    for (const unitKey of entry.mapped_learning_unit_keys || []) {
      await q(tx, `
        insert into public.teaching_course_plan_source_mappings(
          mapping_id,student_id,course_plan_id,coverage_entry_id,source_content_item_id,learning_unit_id,mapping_kind,created_at
        ) values($1,$2,$3,$4,$5,$6,'REQUIRED_SCOPE',$7)
      `, [randomUUID(), studentId, coursePlanId, coverageId, source.source_content_item_id, graph.unitIdMap.get(String(unitKey)), now]);
    }

    if (entry.excluded) {
      await q(tx, `
        insert into public.teaching_course_plan_exclusions(
          exclusion_id,student_id,course_plan_id,source_content_item_id,classification,reason,policy_version,approved_by,approved_at
        ) values($1,$2,$3,$4,$5,$6,'source-meaningfulness.v1','DETERMINISTIC_SOURCE_CLASSIFICATION',$7)
      `, [randomUUID(), studentId, coursePlanId, source.source_content_item_id, source.classification, entry.exclusion_reason, now]);
    }
  }

  if (previousPlan) {
    const { rows: previousUnits = [] } = await q(tx, `select learning_unit_id,metadata from public.teaching_learning_units where student_id=$1 and course_plan_id=$2`, [studentId, previousPlan.course_plan_id]);
    const previousByKey = new Map(previousUnits.map((row) => [String(row.metadata?.canonical_key || row.metadata?.plan_node_ref || row.learning_unit_id), row]));
    for (const lineage of plan.learning_unit_lineage || []) {
      const predecessor = previousByKey.get(String(lineage.predecessor_key));
      const successorId = graph.unitIdMap.get(String(lineage.successor_key));
      if (!predecessor || !successorId) continue;
      await q(tx, `
        insert into public.teaching_learning_unit_lineage(
          lineage_id,student_id,predecessor_learning_unit_id,successor_learning_unit_id,lineage_kind,course_plan_version_ref,reason,created_at
        ) values($1,$2,$3,$4,$5,$6,$7,$8)
      `, [randomUUID(), studentId, predecessor.learning_unit_id, successorId, lineage.kind, `course-plan:${coursePlanId}:v${version}`, lineage.reason || null, now]);
    }
  }

  return { coverageIdBySource };
}

module.exports = { materializePlanCoverage };
