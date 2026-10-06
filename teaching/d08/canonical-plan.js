'use strict';

const { latestVpkByTarget } = require('./contracts');
const { mergeCoverageTreatmentMappings } = require('./coverage-planning');

const CANONICAL_STATUSES = new Set(['ok','unresolved_inputs','academically_infeasible_under_constraints','requires_scope_review']);
const TREATMENT_MAP = Object.freeze({
  teach_full: 'FULL_INSTRUCTION',
  teach_compressed: 'COMPRESSED_INSTRUCTION',
  validated_prior_knowledge_no_initial_instruction: 'VALIDATED_PRIOR_KNOWLEDGE_NO_INITIAL_INSTRUCTION',
});
const AUDIT_CRITICALITY_TO_PLAN = Object.freeze({
  foundational: 'FOUNDATIONAL',
  major: 'HIGH',
  supporting: 'MEDIUM',
  enrichment: 'LOW',
});
const PLAN_CRITICALITIES = new Set(['LOW','MEDIUM','HIGH','FOUNDATIONAL']);

function invalid(message, reason = 'TEACHING_D08_TPF03_OUTPUT_INVALID') {
  return { ok: false, reason, message };
}

function normalizeAuditCriticality(value, unitId) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    throw Object.assign(new Error(`Learning Unit ${unitId} is missing criticality.`), { code: 'TEACHING_D08_CRITICALITY_REQUIRED' });
  }
  const canonical = raw.toLowerCase();
  if (canonical === 'unresolved') {
    throw Object.assign(new Error(`Learning Unit ${unitId} has unresolved criticality.`), { code: 'TEACHING_D08_CRITICALITY_UNRESOLVED' });
  }
  if (AUDIT_CRITICALITY_TO_PLAN[canonical]) return AUDIT_CRITICALITY_TO_PLAN[canonical];
  const legacy = raw.toUpperCase();
  if (PLAN_CRITICALITIES.has(legacy)) return legacy;
  throw Object.assign(new Error(`Learning Unit ${unitId} has invalid criticality.`), { code: 'TEACHING_D08_CRITICALITY_INVALID' });
}

function validateTpf03CoursePlanOutput(output, { course } = {}) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return invalid('TPF-03 output must be an object.');
  if (!CANONICAL_STATUSES.has(String(output.status || ''))) return invalid('TPF-03 status is invalid.');
  if (!output.input_state_reference || typeof output.input_state_reference !== 'object') return invalid('TPF-03 input_state_reference is required.');
  if (course) {
    if (String(output.input_state_reference.aggregate_id || '') !== String(course.course_id)) return invalid('TPF-03 state reference does not match Course.', 'TEACHING_D08_TPF03_STATE_REFERENCE_MISMATCH');
    if (String(output.input_state_reference.state_version || '') !== String(course.state_version)) return invalid('TPF-03 state version does not match Course.', 'TEACHING_D08_TPF03_STATE_REFERENCE_MISMATCH');
  }
  if (typeof output.review_required !== 'boolean' || !Array.isArray(output.review_reasons)) return invalid('TPF-03 review fields are invalid.');
  if (!output.plan_basis || typeof output.plan_basis !== 'object' || Array.isArray(output.plan_basis)) return invalid('TPF-03 plan_basis is required.');
  for (const name of ['planning_principles_applied','course_sequence','prerequisite_repairs','assessment_window_proposals','coverage_treatment_map','infeasibility_or_pressure','unresolved_items']) {
    if (!Array.isArray(output[name])) return invalid(`TPF-03 ${name} must be an array.`);
  }
  for (const group of output.course_sequence) {
    if (!Number.isFinite(Number(group.sequence_group)) || !Array.isArray(group.learning_units)) return invalid('TPF-03 course_sequence entry is malformed.');
    for (const unit of group.learning_units) {
      const ref = String(unit?.learning_unit_ref || '').trim();
      if (!ref) return invalid('TPF-03 learning_unit_ref is required.');
      if (!['teach_full','teach_compressed','validated_prior_knowledge_no_initial_instruction','unresolved'].includes(String(unit.initial_instruction_status || ''))) return invalid(`TPF-03 treatment is invalid for ${ref}.`);
      if (!Array.isArray(unit.prerequisite_refs) || !Array.isArray(unit.prerequisite_repair_refs) || !Array.isArray(unit.follow_up_treatments)) return invalid(`TPF-03 unit arrays are invalid for ${ref}.`);
    }
  }
  for (const item of output.coverage_treatment_map) {
    if (!String(item?.required_source_or_unit_ref || '').trim() || !Array.isArray(item.planned_treatment_refs)) return invalid('TPF-03 coverage treatment entry is malformed.');
    if (!['full','partial','unresolved'].includes(String(item.mapping_completeness_proposal || ''))) return invalid('TPF-03 coverage mapping completeness is invalid.');
    if (item.coverage_status_claimed !== 'planned_only') return invalid('TPF-03 may claim planned_only coverage only.', 'TEACHING_D08_TPF03_COVERAGE_AUTHORITY_VIOLATION');
  }
  const blocks = output.status !== 'ok' || output.review_required === true || output.unresolved_items.some((item) => item?.blocks_final_plan === true);
  return { ok: true, value: output, blocksFinalPlan: blocks };
}

function buildAuditSourceUnitGraph(auditOutput = {}, sources = []) {
  const sourceUnits = new Map(sources.map((source) => [String(source.source_ref), new Set()]));
  const sourceRefByAlias = new Map();
  for (const source of sources) {
    const sourceRef = String(source.source_ref || '').trim();
    const sourceId = String(source.source_content_item_id || '').trim();
    if (!sourceRef) continue;
    sourceRefByAlias.set(sourceRef, sourceRef);
    if (sourceId) {
      sourceRefByAlias.set(sourceId, sourceRef);
      sourceRefByAlias.set(`source:${sourceId}`, sourceRef);
    }
  }
  const resolveSourceRef = (value) => sourceRefByAlias.get(String(value || '').trim()) || null;
  const add = (sourceRef, unitRef) => {
    const sourceKey = String(sourceRef || '').trim();
    const unitKey = String(unitRef || '').trim();
    if (!sourceKey || !unitKey || !sourceUnits.has(sourceKey)) return;
    sourceUnits.get(sourceKey).add(unitKey);
  };

  for (const account of auditOutput.source_accounting || []) {
    const rawSourceRef = String(account.source_ref || '').trim();
    const sourceRef = resolveSourceRef(rawSourceRef) || rawSourceRef;
    if (sourceRef && !sourceUnits.has(sourceRef)) sourceUnits.set(sourceRef, new Set());
    for (const unitRef of account.learning_unit_ids || []) add(sourceRef, unitRef);
  }

  const unitsByTopic = new Map();
  for (const unit of auditOutput.learning_units || []) {
    const unitRef = String(unit.learning_unit_id || unit.id || '').trim();
    if (!unitRef) continue;
    for (const canonicalSourceRef of unit.source_item_refs || []) {
      const sourceRef = resolveSourceRef(canonicalSourceRef);
      if (sourceRef) add(sourceRef, unitRef);
    }
    const topicRefs = new Set([
      ...(unit.topic_refs || []).map(String),
      ...(unit.topic_id == null ? [] : [String(unit.topic_id)]),
    ].filter(Boolean));
    for (const topicRef of topicRefs) {
      if (!unitsByTopic.has(topicRef)) unitsByTopic.set(topicRef, new Set());
      unitsByTopic.get(topicRef).add(unitRef);
    }
  }

  for (const topic of auditOutput.topics || []) {
    const topicRef = String(topic.topic_id || topic.id || '').trim();
    const unitRefs = unitsByTopic.get(topicRef);
    if (!topicRef || !unitRefs?.size) continue;
    for (const canonicalSourceRef of topic.source_item_refs || []) {
      const sourceRef = resolveSourceRef(canonicalSourceRef);
      if (!sourceRef) continue;
      for (const unitRef of unitRefs) add(sourceRef, unitRef);
    }
  }

  return new Map([...sourceUnits].map(([sourceRef, unitRefs]) => [sourceRef, Object.freeze([...unitRefs])]));
}

function currentValidatedVpkRefsForAuditUnit(unitRef, { vpkDecisions = [], auditOutput = null, sources = [] } = {}) {
  const latest = latestVpkByTarget(vpkDecisions);
  const refs = [];
  const direct = latest.get(`LEARNING_UNIT:${unitRef}`);
  if (direct?.decision_status === 'VALIDATED_PRIOR_KNOWLEDGE') refs.push(String(direct.vpk_decision_id));
  const sourceUnitGraph = buildAuditSourceUnitGraph(auditOutput || {}, sources);
  for (const source of sources) {
    if (!(sourceUnitGraph.get(String(source.source_ref)) || []).includes(String(unitRef))) continue;
    const byId = latest.get(`SOURCE_CONTENT_ITEM:${source.source_content_item_id}`);
    const byRef = latest.get(`SOURCE_CONTENT_ITEM:${source.source_ref}`);
    const decision = byId?.decision_status === 'VALIDATED_PRIOR_KNOWLEDGE' ? byId : byRef;
    if (decision?.decision_status === 'VALIDATED_PRIOR_KNOWLEDGE') refs.push(String(decision.vpk_decision_id));
  }
  return [...new Set(refs)];
}

function normalizeAuditPrerequisite(item, index, unitIds) {
  const key = String(item?.prerequisite_ref || item?.key || item?.ref || item?.label || `prerequisite-${index + 1}`).trim();
  const candidateUnit = String(item?.learning_unit_id || item?.blocks_learning_unit_id || '').trim();
  return {
    key,
    label: String(item?.label || item?.title || key).trim(),
    description: item?.description || item?.reason || item?.rationale || null,
    learning_unit_key: candidateUnit && unitIds.has(candidateUnit) ? candidateUnit : null,
    provenance_refs: Array.isArray(item?.provenance_refs) ? item.provenance_refs.map(String) : [],
  };
}

function deriveLearningUnitLineage({ previousPlanContext = null, auditOutput, sources = [] }) {
  if (!previousPlanContext?.units?.length || !previousPlanContext?.sourceMappings?.length) return [];
  const oldSourcesByUnit = new Map(previousPlanContext.units.map((unit) => [String(unit.key), new Set()]));
  for (const mapping of previousPlanContext.sourceMappings) {
    const set = oldSourcesByUnit.get(String(mapping.learning_unit_key));
    if (set) set.add(String(mapping.source_ref));
  }
  const newSourcesByUnit = new Map((auditOutput.learning_units || []).map((unit) => [
    String(unit.learning_unit_id || unit.id),
    new Set(),
  ]));
  for (const [sourceRef, unitRefs] of buildAuditSourceUnitGraph(auditOutput, sources)) {
    for (const unitRef of unitRefs) {
      const set = newSourcesByUnit.get(String(unitRef));
      if (set) set.add(String(sourceRef));
    }
  }
  const oldToNew = new Map();
  const newToOld = new Map();
  for (const [oldKey, oldSources] of oldSourcesByUnit) {
    const successors = [];
    for (const [newKey, newSources] of newSourcesByUnit) {
      if ([...oldSources].some((ref) => newSources.has(ref))) successors.push(newKey);
    }
    oldToNew.set(oldKey, successors);
    for (const newKey of successors) {
      if (!newToOld.has(newKey)) newToOld.set(newKey, []);
      newToOld.get(newKey).push(oldKey);
    }
  }
  const rows = [];
  const seen = new Set();
  for (const [oldKey, successors] of oldToNew) {
    for (const newKey of successors) {
      const predecessors = newToOld.get(newKey) || [];
      const kind = successors.length > 1 ? 'SPLIT' : predecessors.length > 1 ? 'MERGE' : oldKey === newKey ? 'REFINED' : 'REPLACED';
      const signature = `${oldKey}|${newKey}|${kind}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      rows.push({ predecessor_key: oldKey, successor_key: newKey, kind, reason: 'Deterministic source-overlap lineage across Course Plan versions.' });
    }
  }
  return rows;
}

function materializeCoursePlanFromTpf03(output, { audit, sources = [], vpkDecisions = [], previousPlanContext = null } = {}) {
  const auditOutput = audit?.audit_output || audit;
  if (!auditOutput || !Array.isArray(auditOutput.learning_units) || !Array.isArray(auditOutput.topics) || (!Array.isArray(auditOutput.source_accounting) && !Array.isArray(auditOutput.source_inventory))) return invalid('Validated Curriculum Audit structure is required.', 'TEACHING_D08_CURRICULUM_AUDIT_STRUCTURE_REQUIRED');
  try {
  const validated = validateTpf03CoursePlanOutput(output);
  if (!validated.ok) return validated;
  if (validated.blocksFinalPlan) return invalid('TPF-03 output reports unresolved/review-blocking Course Plan state.', 'TEACHING_D08_TPF03_PLAN_BLOCKED');
  const treatmentByUnit = new Map();
  for (const group of output.course_sequence) {
    for (const item of group.learning_units) {
      const ref = String(item.learning_unit_ref);
      if (treatmentByUnit.has(ref)) return invalid(`TPF-03 repeats Learning Unit ${ref}.`, 'TEACHING_D08_TPF03_DUPLICATE_UNIT');
      treatmentByUnit.set(ref, item);
    }
  }
  const auditUnitIds = new Set(auditOutput.learning_units.map((unit) => String(unit.learning_unit_id || unit.id)));
  const missing = [...auditUnitIds].filter((id) => !treatmentByUnit.has(id));
  const unknown = [...treatmentByUnit.keys()].filter((id) => !auditUnitIds.has(id));
  if (missing.length) return invalid(`TPF-03 omitted required Learning Units: ${missing.join(', ')}`, 'TEACHING_D08_TPF03_REQUIRED_UNIT_OMITTED');
  if (unknown.length) return invalid(`TPF-03 referenced unknown Learning Units: ${unknown.join(', ')}`, 'TEACHING_D08_TPF03_UNKNOWN_UNIT');

  const topics = auditOutput.topics.map((topic, topicIndex) => ({
    key: String(topic.topic_id || topic.id), title: String(topic.title), ordinal: topicIndex,
    subtopics: (topic.subtopics || []).map((subtopic, subtopicIndex) => typeof subtopic === 'string'
      ? ({ key: `${topic.topic_id || topic.id}:subtopic:${subtopicIndex + 1}`, title: subtopic, ordinal: subtopicIndex })
      : ({ key: String(subtopic.subtopic_id || subtopic.id), title: String(subtopic.title), ordinal: subtopicIndex })),
  }));
  const learning_units = auditOutput.learning_units.map((unit) => {
    const unitId = String(unit.learning_unit_id || unit.id);
    const planning = treatmentByUnit.get(unitId);
    if (planning.initial_instruction_status === 'unresolved') throw Object.assign(new Error(`TPF-03 left Learning Unit ${unitId} unresolved.`), { code: 'TEACHING_D08_TPF03_PLAN_BLOCKED' });
    const treatment = TREATMENT_MAP[planning.initial_instruction_status];
    const vpkRefs = currentValidatedVpkRefsForAuditUnit(unitId, { vpkDecisions, auditOutput, sources });
    if (treatment !== 'FULL_INSTRUCTION' && !vpkRefs.length) throw Object.assign(new Error(`TPF-03 compressed ${unitId} without current validated prior knowledge.`), { code: 'TEACHING_D08_VPK_PROVENANCE_REQUIRED' });
    const topicKey = String(unit.topic_id || unit.topic_refs?.[0] || topics[0]?.key || '');
    const criticality = normalizeAuditCriticality(unit.criticality, unitId);
    return {
      key: unitId, topic_key: topicKey, subtopic_key: unit.subtopic_id == null ? null : String(unit.subtopic_id),
      title: String(unit.title), intended_competence: String(unit.intended_competence),
      exit_conditions: Array.isArray(unit.exit_conditions) ? unit.exit_conditions : [{ criterion: String(unit.proposed_exit_evidence || `Demonstrate ${unit.intended_competence}`), evidence_form: 'OBSERVABLE_PERFORMANCE', independence_required: ['HIGH','FOUNDATIONAL'].includes(criticality) }],
      criticality, foundational: unit.foundational === true || criticality === 'FOUNDATIONAL',
      instructional_load_min_minutes: Number(unit.instructional_load_min_minutes || 0), instructional_load_max_minutes: Number(unit.instructional_load_max_minutes || unit.instructional_load_min_minutes || 0),
      instructional_treatment: treatment, vpk_basis_refs: vpkRefs,
      pedagogy_profile: null,
      treatment_basis: planning.initial_treatment_basis || null,
      follow_up_treatments: planning.follow_up_treatments || [],
      instructional_emphasis: planning.instructional_emphasis || null,
      emphasis_basis: planning.emphasis_basis || null,
      evidence_goal: planning.evidence_goal || null,
      student_intake_accommodation_notes: planning.student_intake_accommodation_notes || null,
    };
  });
  const explicitDependencies = (auditOutput.dependencies || []).map((edge) => ({
    learning_unit_key: String(edge.learning_unit_id), prerequisite_learning_unit_key: String(edge.prerequisite_learning_unit_id), rationale: edge.rationale || null,
  }));
  const unitIds = new Set(learning_units.map((unit) => unit.key));
  const derivedDependencies = auditOutput.learning_units.flatMap((unit) => (unit.prerequisite_refs || [])
    .map(String).filter((ref) => unitIds.has(ref)).map((ref) => ({ learning_unit_key: String(unit.learning_unit_id || unit.id), prerequisite_learning_unit_key: ref, rationale: unit.dependency_type_notes || null })));
  const dependencies = explicitDependencies.length ? explicitDependencies : derivedDependencies;
  const sourceUnitGraph = buildAuditSourceUnitGraph(auditOutput, sources);
  const mergedCoverage = mergeCoverageTreatmentMappings({ output, auditOutput, sources, sourceUnitGraph });
  if (!mergedCoverage.ok) return mergedCoverage;
  const source_mappings = sources.map((source) => ({
    source_ref: String(source.source_ref),
    learning_unit_keys: mergedCoverage.graph.get(String(source.source_ref)) || [],
  }));
  const assumed_prerequisites = (auditOutput.assumed_prerequisites || []).map((item, index) => normalizeAuditPrerequisite(item, index, auditUnitIds));
  const learning_unit_lineage = deriveLearningUnitLineage({ previousPlanContext, auditOutput, sources });
  return { ok: true, value: {
    summary: output.student_facing_plan_summary_candidate || null,
    topics, learning_units, dependencies, source_mappings, assumed_prerequisites, learning_unit_lineage,
    canonical_plan_output: output,
  }};
  } catch (error) {
    return invalid(error.message || 'Canonical TPF-03 plan materialization failed.', error.code || 'TEACHING_D08_TPF03_MATERIALIZATION_FAILED');
  }
}

function validateTpf03ScopeImpactOutput(output, { course, plan, scopeChangeId } = {}) {
  const base = validateTpf03CoursePlanOutput(output, { course });
  if (!base.ok) return base;
  const impact = output.scope_change_impact;
  if (!impact || typeof impact !== 'object' || Array.isArray(impact)) return invalid('TPF-03 scope_change_impact is required.');
  if (impact.history_must_remain_immutable !== true) return invalid('TPF-03 scope analysis must preserve immutable history.', 'TEACHING_D08_SCOPE_HISTORY_INVARIANT');
  if (plan && String(impact.current_plan_version || '') !== String(plan.version_no) && String(impact.current_plan_version || '') !== `course-plan:${plan.course_plan_id}:v${plan.version_no}`) return invalid('TPF-03 scope impact references the wrong Course Plan version.', 'TEACHING_D08_SCOPE_PLAN_REFERENCE_MISMATCH');
  return { ok: true, value: {
    change_kind: impact.material_version_change_recommended === true ? 'MATERIAL_SCOPE_CHANGE' : 'MINOR_SUPPLEMENT',
    affected_learning_units: [],
    prerequisite_impacts: impact.new_prerequisites || [],
    assessment_scope_impacts: impact.assessment_scope_impacts_for_downstream_review || [],
    plan_version_recommended: impact.material_version_change_recommended === true,
    student_summary: impact.proposed_change_summary || 'Course scope change reviewed.',
    review_needed: output.review_required === true,
    scope_change_ref: scopeChangeId || null,
    canonical_scope_output: output,
  }};
}

module.exports = {
  validateTpf03CoursePlanOutput,
  validateTpf03ScopeImpactOutput,
  materializeCoursePlanFromTpf03,
  deriveLearningUnitLineage,
  buildAuditSourceUnitGraph,
};