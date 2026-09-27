'use strict';

async function materializePlanCoverage(ctx, tx, { studentId, course, coursePlanId, setup, plan, graph, previousPlan, version, now }) {
  const { q, randomUUID } = ctx;
  const { topicIdMap, subtopicIdMap, unitIdMap, newUnits } = graph;
  const sourceByRef = new Map(setup.sources.map((source) => [String(source.source_ref), source]));
  const unitByProposalId = new Map(newUnits.map((unit) => [unit.id, unit]));
  const mappedUnitIdsBySource = new Map();

  for (const mapping of plan.source_mappings) {
    const source = sourceByRef.get(mapping.source_ref);
    const dbUnitIds = [];
    for (const proposalUnitId of mapping.learning_unit_ids) {
      const dbUnitId = unitIdMap.get(proposalUnitId);
      dbUnitIds.push(dbUnitId);
      const unit = unitByProposalId.get(proposalUnitId);
      await q(tx, `
        insert into public.teaching_course_plan_source_mappings(
          mapping_id,student_id,course_plan_id,source_content_item_id,learning_unit_id,mapping_role,instructional_mode
        ) values($1,$2,$3,$4,$5,'REQUIRED_SCOPE',$6)
      `, [randomUUID(), studentId, coursePlanId, source.source_content_item_id, dbUnitId, unit.instructional_mode]);
    }
    mappedUnitIdsBySource.set(String(source.source_content_item_id), dbUnitIds);
  }

  const latestVpk = new Map();
  for (const decision of [...(setup.vpkDecisions || [])].sort((a, b) => String(a.decided_at || '').localeCompare(String(b.decided_at || '')))) {
    latestVpk.set(`${decision.target_kind}:${decision.target_ref}`, decision);
  }
  const validatedTargets = new Set([...latestVpk.values()].filter((decision) => decision.decision_status === 'VALIDATED_PRIOR_KNOWLEDGE').map((decision) => String(decision.target_ref)));
  const explicitExclusions = new Map(plan.excluded_sources.map((exclusion) => [exclusion.source_ref, exclusion]));

  for (const source of setup.sources) {
    const sourceId = String(source.source_content_item_id);
    const mappedDbUnitIds = mappedUnitIdsBySource.get(sourceId) || [];
    const proposalMapping = plan.source_mappings.find((mapping) => mapping.source_ref === String(source.source_ref));
    const mappedPlanUnits = (proposalMapping?.learning_unit_ids || []).map((id) => unitByProposalId.get(id));
    const directVpk = latestVpk.get(`SOURCE_CONTENT_ITEM:${sourceId}`) || latestVpk.get(`SOURCE_CONTENT_ITEM:${source.source_ref}`);
    const allMappedUnitsVpk = mappedPlanUnits.length > 0 && mappedPlanUnits.every((unit) => unit.audit_unit_refs.some((ref) => validatedTargets.has(String(ref))));
    const completedByVpk = directVpk?.decision_status === 'VALIDATED_PRIOR_KNOWLEDGE' || allMappedUnitsVpk;
    const explicit = explicitExclusions.get(String(source.source_ref));
    const nonRequired = source.classification !== 'ACADEMICALLY_MEANINGFUL';
    const excluded = Boolean(explicit || nonRequired);
    const exclusionReason = explicit?.reason || (nonRequired ? `${source.classification}: ${source.classification_reason || 'not required academic scope'}` : null);
    await q(tx, `
      insert into public.teaching_course_coverage(
        coverage_entry_id,student_id,course_id,course_plan_id,source_content_item_id,topic_id,subtopic_id,learning_unit_id,
        found_at,mapped_at,planned_at,validated_prior_knowledge_at,instructionally_complete_at,excluded_at,exclusion_reason,
        instructional_completion_basis,coverage_version,updated_at
      ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,1,$9)
    `, [
      randomUUID(), studentId, course.course_id, coursePlanId, sourceId,
      mappedPlanUnits[0] ? topicIdMap.get(mappedPlanUnits[0].topic_id) : null,
      mappedPlanUnits[0]?.subtopic_id ? subtopicIdMap.get(mappedPlanUnits[0].subtopic_id) : null,
      mappedDbUnitIds[0] || null,
      now,
      mappedDbUnitIds.length ? now : null,
      mappedDbUnitIds.length ? now : null,
      completedByVpk ? now : null,
      completedByVpk ? now : null,
      excluded ? now : null,
      exclusionReason,
      completedByVpk ? 'VALIDATED_PRIOR_KNOWLEDGE' : null,
    ]);
    if (excluded) {
      await q(tx, `
        insert into public.teaching_course_plan_exclusions(
          exclusion_id,student_id,course_plan_id,source_content_item_id,reason,approval_authority_ref,policy_version,approved_at
        ) values($1,$2,$3,$4,$5,'source-meaningfulness.v1','source-meaningfulness.v1',$6)
      `, [randomUUID(), studentId, coursePlanId, sourceId, exclusionReason, now]);
    }
  }

  if (!previousPlan) return;
  const previousUnits = await q(tx, `select learning_unit_id,title,metadata from public.teaching_learning_units where student_id=$1 and course_plan_id=$2`, [studentId, previousPlan.course_plan_id]);
  const prior = (previousUnits.rows || []).map((unit) => ({ ...unit, auditRefs: Array.isArray(unit.metadata?.audit_unit_refs) ? unit.metadata.audit_unit_refs.map(String) : [] }));
  for (const next of newUnits) {
    const predecessors = prior.filter((unit) => unit.auditRefs.some((ref) => next.audit_unit_refs.includes(ref)));
    if (!predecessors.length) continue;
    const nextSiblingCount = newUnits.filter((candidate) => predecessors.some((pred) => pred.auditRefs.some((ref) => candidate.audit_unit_refs.includes(ref)))).length;
    const kind = predecessors.length > 1 ? 'MERGE' : nextSiblingCount > 1 ? 'SPLIT' : 'REFINED';
    for (const predecessor of predecessors) {
      await q(tx, `
        insert into public.teaching_learning_unit_lineage(
          lineage_id,student_id,predecessor_learning_unit_id,successor_learning_unit_id,lineage_kind,course_plan_version_ref,reason
        ) values($1,$2,$3,$4,$5,$6,$7)
        on conflict(predecessor_learning_unit_id,successor_learning_unit_id,lineage_kind) do nothing
      `, [randomUUID(), studentId, predecessor.learning_unit_id, next.learning_unit_id, kind, `course-plan:${coursePlanId}:v${version}`, 'D08 versioned Course Plan lineage preserves historical evidence references.']);
    }
  }
}

module.exports = { materializePlanCoverage };
