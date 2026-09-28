'use strict';

const crypto = require('node:crypto');
const CRITICALITIES = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'FOUNDATIONAL']);
const TREATMENTS = Object.freeze([
  'FULL_INSTRUCTION',
  'COMPRESSED_INSTRUCTION',
  'VALIDATED_PRIOR_KNOWLEDGE_NO_INITIAL_INSTRUCTION',
]);
const COVERAGE_AUDIT_KINDS = Object.freeze(['PRE_ACTIVATION', 'END_OF_COURSE', 'SCOPE_CHANGE']);
const SOURCE_CLASS_REQUIRED = 'ACADEMICALLY_MEANINGFUL';
const PLAN_SCHEMA_VERSION = 'd08.course-plan.v1';
const COVERAGE_POLICY_VERSION = 'coverage-reconciliation.v1';
const SCOPE_CHANGE_POLICY_VERSION = 'course-scope-change.v1';

function fail(message, code = 'TEACHING_D08_CONTRACT_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function requiredText(value, field, max = 4000) {
  const normalized = String(value ?? '').trim();
  if (!normalized) fail(`${field} is required.`);
  if (Buffer.byteLength(normalized) > max) fail(`${field} exceeds ${max} bytes.`);
  return normalized;
}

function optionalText(value, field, max = 4000) {
  if (value == null || value === '') return null;
  return requiredText(value, field, max);
}

function requiredArray(value, field, max = 500) {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) {
    fail(`${field} must be a non-empty array with at most ${max} entries.`);
  }
  return value;
}

function array(value, field, max = 500) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > max) fail(`${field} must be an array with at most ${max} entries.`);
  return value;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function normalizeExitCondition(value, field) {
  if (typeof value === 'string') {
    const criterion = requiredText(value, field, 2000);
    if (criterion.length < 8) fail(`${field} is too vague to be a meaningful evidence condition.`, 'TEACHING_D08_EXIT_CONDITION_TOO_VAGUE');
    return Object.freeze({ criterion, evidence_form: 'OBSERVABLE_PERFORMANCE', independence_required: true });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${field} must be a string or object.`);
  const criterion = requiredText(value.criterion, `${field}.criterion`, 2000);
  const evidenceForm = requiredText(value.evidence_form || value.evidenceForm, `${field}.evidence_form`, 100);
  if (criterion.length < 8) fail(`${field}.criterion is too vague.`, 'TEACHING_D08_EXIT_CONDITION_TOO_VAGUE');
  return Object.freeze({
    criterion,
    evidence_form: evidenceForm,
    independence_required: value.independence_required !== false,
  });
}

function latestVpkByTarget(decisions = []) {
  const sorted = [...decisions].sort((a, b) => new Date(b.decided_at || 0) - new Date(a.decided_at || 0));
  const map = new Map();
  for (const decision of sorted) {
    const key = `${decision.target_kind}:${decision.target_ref}`;
    if (!map.has(key)) map.set(key, decision);
  }
  return map;
}

function assessRequiredDiagnostic({ diagnosticPlan, vpkDecisions = [] } = {}) {
  if (!diagnosticPlan || diagnosticPlan.requirement_state !== 'REQUIRED') {
    return Object.freeze({ resolved: true, unresolvedTargets: Object.freeze([]), reason: 'NOT_REQUIRED' });
  }
  const latest = latestVpkByTarget(vpkDecisions);
  const unresolved = [];
  for (const ref of diagnosticPlan.target_refs || []) {
    const target = String(ref);
    const candidates = [...latest.values()].filter((decision) => String(decision.target_ref) === target);
    if (!candidates.length) unresolved.push(target);
  }
  return Object.freeze({
    resolved: unresolved.length === 0,
    unresolvedTargets: Object.freeze(unresolved),
    reason: unresolved.length ? 'REQUIRED_DIAGNOSTIC_EVIDENCE_UNRESOLVED' : 'REQUIRED_DIAGNOSTIC_RESOLVED',
  });
}

function validateCoursePlanProposal(output, { sources = [], vpkDecisions = [], diagnosticPlan = null } = {}) {
  try {
    if (!output || typeof output !== 'object' || Array.isArray(output)) fail('Course Plan proposal must be an object.');
    const topics = requiredArray(output.topics, 'topics', 250);
    const units = requiredArray(output.learning_units, 'learning_units', 1000);
    const sourceMappings = requiredArray(output.source_mappings, 'source_mappings', 5000);
    const dependencies = array(output.dependencies, 'dependencies', 5000);
    const assumedPrerequisites = array(output.assumed_prerequisites, 'assumed_prerequisites', 1000);
    const learningUnitLineage = array(output.learning_unit_lineage, 'learning_unit_lineage', 2000);

    const topicKeys = new Set();
    const subtopicKeys = new Set();
    const normalizedTopics = topics.map((topic, index) => {
      const key = requiredText(topic.key || topic.id, `topics[${index}].key`, 160);
      if (topicKeys.has(key)) fail(`Duplicate Topic key ${key}.`);
      topicKeys.add(key);
      const subtopics = array(topic.subtopics, `topics[${index}].subtopics`, 500).map((subtopic, subIndex) => {
        const subKey = requiredText(subtopic.key || subtopic.id, `topics[${index}].subtopics[${subIndex}].key`, 160);
        if (subtopicKeys.has(subKey)) fail(`Duplicate Subtopic key ${subKey}.`);
        subtopicKeys.add(subKey);
        return Object.freeze({ key: subKey, title: requiredText(subtopic.title, `subtopic ${subKey}.title`, 500), ordinal: subIndex });
      });
      return Object.freeze({ key, title: requiredText(topic.title, `topic ${key}.title`, 500), ordinal: index, subtopics: Object.freeze(subtopics) });
    });

    const latestVpk = latestVpkByTarget(vpkDecisions);
    const unitKeys = new Set();
    const normalizedUnits = units.map((unit, index) => {
      const key = requiredText(unit.key || unit.id, `learning_units[${index}].key`, 160);
      if (unitKeys.has(key)) fail(`Duplicate Learning Unit key ${key}.`);
      unitKeys.add(key);
      const topicKey = requiredText(unit.topic_key || unit.topic_id, `learning_unit ${key}.topic_key`, 160);
      if (!topicKeys.has(topicKey)) fail(`Learning Unit ${key} references an unknown Topic.`);
      const subtopicKey = optionalText(unit.subtopic_key || unit.subtopic_id, `learning_unit ${key}.subtopic_key`, 160);
      if (subtopicKey && !subtopicKeys.has(subtopicKey)) fail(`Learning Unit ${key} references an unknown Subtopic.`);
      const criticality = requiredText(unit.criticality, `learning_unit ${key}.criticality`, 40).toUpperCase();
      if (!CRITICALITIES.includes(criticality)) fail(`Learning Unit ${key} has invalid criticality.`);
      const exitConditions = requiredArray(unit.exit_conditions, `learning_unit ${key}.exit_conditions`, 30)
        .map((condition, conditionIndex) => normalizeExitCondition(condition, `learning_unit ${key}.exit_conditions[${conditionIndex}]`));
      if ((criticality === 'HIGH' || criticality === 'FOUNDATIONAL') && !exitConditions.some((x) => x.independence_required)) {
        fail(`Critical Learning Unit ${key} requires at least one independent evidence condition.`, 'TEACHING_D08_CRITICAL_EXIT_CONDITION_REQUIRED');
      }
      const treatment = requiredText(unit.instructional_treatment || 'FULL_INSTRUCTION', `learning_unit ${key}.instructional_treatment`, 100);
      if (!TREATMENTS.includes(treatment)) fail(`Learning Unit ${key} has invalid instructional treatment.`);
      const vpkBasisRefs = array(unit.vpk_basis_refs, `learning_unit ${key}.vpk_basis_refs`, 100).map(String);
      if (treatment !== 'FULL_INSTRUCTION') {
        if (!vpkBasisRefs.length) fail(`Learning Unit ${key} requires VPK provenance for compressed instruction.`, 'TEACHING_D08_VPK_BASIS_REQUIRED');
        for (const ref of vpkBasisRefs) {
          const match = [...latestVpk.values()].find((decision) => String(decision.vpk_decision_id) === ref);
          if (!match || match.decision_status !== 'VALIDATED_PRIOR_KNOWLEDGE') {
            fail(`Learning Unit ${key} references non-current/non-validated VPK ${ref}.`, 'TEACHING_D08_VPK_BASIS_INVALID');
          }
        }
      }
      const min = Number(unit.instructional_load_min_minutes ?? 0);
      const max = Number(unit.instructional_load_max_minutes ?? min);
      if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min) fail(`Learning Unit ${key} has invalid instructional load.`);
      return Object.freeze({
        key,
        topic_key: topicKey,
        subtopic_key: subtopicKey,
        title: requiredText(unit.title, `learning_unit ${key}.title`, 500),
        intended_competence: requiredText(unit.intended_competence, `learning_unit ${key}.intended_competence`, 3000),
        exit_conditions: Object.freeze(exitConditions),
        criticality,
        foundational: unit.foundational === true || criticality === 'FOUNDATIONAL',
        instructional_load_min_minutes: min,
        instructional_load_max_minutes: max,
        instructional_treatment: treatment,
        vpk_basis_refs: Object.freeze(vpkBasisRefs),
        treatment_basis: optionalText(unit.treatment_basis, `learning_unit ${key}.treatment_basis`, 3000),
        follow_up_treatments: Object.freeze(array(unit.follow_up_treatments, `learning_unit ${key}.follow_up_treatments`, 50).map(String)),
        instructional_emphasis: optionalText(unit.instructional_emphasis, `learning_unit ${key}.instructional_emphasis`, 40),
        emphasis_basis: optionalText(unit.emphasis_basis, `learning_unit ${key}.emphasis_basis`, 3000),
        evidence_goal: optionalText(unit.evidence_goal, `learning_unit ${key}.evidence_goal`, 3000),
        student_intake_accommodation_notes: optionalText(unit.student_intake_accommodation_notes, `learning_unit ${key}.student_intake_accommodation_notes`, 3000),
        pedagogy_profile: unit.pedagogy_profile && typeof unit.pedagogy_profile === 'object' && !Array.isArray(unit.pedagogy_profile)
          ? Object.freeze({ ...unit.pedagogy_profile })
          : Object.freeze({}),
      });
    });

    const normalizedDependencies = dependencies.map((edge, index) => {
      const unitKey = requiredText(edge.learning_unit_key || edge.learning_unit_id, `dependencies[${index}].learning_unit_key`, 160);
      const prerequisiteKey = requiredText(edge.prerequisite_learning_unit_key || edge.prerequisite_learning_unit_id, `dependencies[${index}].prerequisite_learning_unit_key`, 160);
      if (!unitKeys.has(unitKey) || !unitKeys.has(prerequisiteKey) || unitKey === prerequisiteKey) fail('Course Plan dependency is invalid.');
      return Object.freeze({ learning_unit_key: unitKey, prerequisite_learning_unit_key: prerequisiteKey, rationale: optionalText(edge.rationale, `dependencies[${index}].rationale`, 2000) });
    });
    const edges = new Map([...unitKeys].map((key) => [key, []]));
    for (const edge of normalizedDependencies) edges.get(edge.learning_unit_key).push(edge.prerequisite_learning_unit_key);
    const visiting = new Set();
    const visited = new Set();
    const walk = (key) => {
      if (visiting.has(key)) fail('Course Plan dependency graph contains a cycle.', 'TEACHING_D08_DEPENDENCY_CYCLE');
      if (visited.has(key)) return;
      visiting.add(key);
      for (const next of edges.get(key)) walk(next);
      visiting.delete(key);
      visited.add(key);
    };
    for (const key of unitKeys) walk(key);

    const sourceByRef = new Map(sources.map((source) => [String(source.source_ref), source]));
    if (sourceByRef.size !== sources.length) fail('Source inventory contains duplicate source_ref values.');
    const mappingBySource = new Map();
    for (const [index, mapping] of sourceMappings.entries()) {
      const sourceRef = requiredText(mapping.source_ref, `source_mappings[${index}].source_ref`, 500);
      if (!sourceByRef.has(sourceRef)) fail(`Unknown source mapping ${sourceRef}.`, 'TEACHING_D08_UNKNOWN_SOURCE_MAPPING');
      if (mappingBySource.has(sourceRef)) fail(`Duplicate source mapping ${sourceRef}.`);
      const learningUnitKeys = array(mapping.learning_unit_keys || mapping.learning_unit_ids, `source_mappings[${index}].learning_unit_keys`, 100).map(String);
      if (learningUnitKeys.some((key) => !unitKeys.has(key))) fail(`Source ${sourceRef} maps to an unknown Learning Unit.`);
      mappingBySource.set(sourceRef, Object.freeze({ source_ref: sourceRef, learning_unit_keys: Object.freeze([...new Set(learningUnitKeys)]) }));
    }

    const requiredSources = sources.filter((source) => source.classification === SOURCE_CLASS_REQUIRED && source.academically_meaningful !== false);
    const unresolved = requiredSources.filter((source) => !mappingBySource.get(String(source.source_ref))?.learning_unit_keys?.length);
    if (unresolved.length) {
      fail(`Course Plan leaves required source items unmapped: ${unresolved.map((source) => source.source_ref).join(', ')}`, 'TEACHING_D08_REQUIRED_SOURCE_UNMAPPED');
    }
    for (const source of sources) {
      if (source.classification !== SOURCE_CLASS_REQUIRED) {
        if (!String(source.classification_reason || '').trim()) fail(`Excluded source ${source.source_ref} lacks an approved reason.`, 'TEACHING_D08_EXCLUSION_REASON_REQUIRED');
      }
    }

    const normalizedAssumed = assumedPrerequisites.map((item, index) => {
      const key = requiredText(item.key || item.ref || item.label, `assumed_prerequisites[${index}].key`, 200);
      const learningUnitKey = optionalText(item.learning_unit_key, `assumed_prerequisites[${index}].learning_unit_key`, 160);
      if (learningUnitKey && !unitKeys.has(learningUnitKey)) fail(`Assumed prerequisite ${key} references an unknown Learning Unit.`);
      return Object.freeze({
        key,
        label: requiredText(item.label || key, `assumed_prerequisites[${index}].label`, 500),
        description: optionalText(item.description, `assumed_prerequisites[${index}].description`, 2000),
        learning_unit_key: learningUnitKey,
        provenance_refs: Object.freeze(array(item.provenance_refs, `assumed_prerequisites[${index}].provenance_refs`, 100).map(String)),
      });
    });

    const normalizedLineage = learningUnitLineage.map((item, index) => {
      const predecessorKey = requiredText(item.predecessor_key, `learning_unit_lineage[${index}].predecessor_key`, 160);
      const successorKey = requiredText(item.successor_key, `learning_unit_lineage[${index}].successor_key`, 160);
      if (!unitKeys.has(successorKey)) fail(`Learning Unit lineage references unknown successor ${successorKey}.`);
      const kind = requiredText(item.kind || item.lineage_kind || 'REFINED', `learning_unit_lineage[${index}].kind`, 40).toUpperCase();
      if (!['SPLIT', 'MERGE', 'REPLACED', 'REFINED'].includes(kind)) fail(`Learning Unit lineage has invalid kind ${kind}.`);
      return Object.freeze({ predecessor_key: predecessorKey, successor_key: successorKey, kind, reason: optionalText(item.reason, `learning_unit_lineage[${index}].reason`, 2000) });
    });

    const diagnostic = assessRequiredDiagnostic({ diagnosticPlan, vpkDecisions });
    if (!diagnostic.resolved) {
      fail(`Required Diagnostic evidence remains unresolved for: ${diagnostic.unresolvedTargets.join(', ')}`, 'TEACHING_D08_REQUIRED_DIAGNOSTIC_UNRESOLVED');
    }

    return {
      ok: true,
      value: Object.freeze({
        summary: optionalText(output.summary, 'summary', 6000),
        topics: Object.freeze(normalizedTopics),
        learning_units: Object.freeze(normalizedUnits),
        dependencies: Object.freeze(normalizedDependencies),
        source_mappings: Object.freeze([...mappingBySource.values()]),
        assumed_prerequisites: Object.freeze(normalizedAssumed),
        learning_unit_lineage: Object.freeze(normalizedLineage),
        diagnostic_resolution: diagnostic,
      }),
    };
  } catch (error) {
    return { ok: false, reason: error.code || 'TEACHING_D08_COURSE_PLAN_INVALID', message: error.message };
  }
}

function reconcileCoverage({ sources = [], mappings = [], vpkDecisions = [], learningUnits = [], at = new Date() } = {}) {
  const mappingBySource = new Map(mappings.map((mapping) => [String(mapping.source_ref), mapping]));
  const latestVpk = latestVpkByTarget(vpkDecisions);
  const learningUnitByKey = new Map(learningUnits.map((unit) => [String(unit.key), unit]));
  const vpkById = new Map(vpkDecisions.map((decision) => [String(decision.vpk_decision_id || ''), decision]));
  const now = at instanceof Date ? at : new Date(at);
  const entries = [];
  const unresolved = [];
  for (const source of sources) {
    const sourceRef = String(source.source_ref);
    const required = source.classification === SOURCE_CLASS_REQUIRED && source.academically_meaningful !== false;
    const mapping = mappingBySource.get(sourceRef);
    const excluded = !required;
    const directVpk = latestVpk.get(`SOURCE_CONTENT_ITEM:${source.source_content_item_id}`)
      || latestVpk.get(`SOURCE_CONTENT_ITEM:${sourceRef}`);
    let vpk = directVpk?.decision_status === 'VALIDATED_PRIOR_KNOWLEDGE' ? directVpk : null;
    if (!vpk && mapping?.learning_unit_keys?.length) {
      const mappedUnits = mapping.learning_unit_keys.map((key) => learningUnitByKey.get(String(key))).filter(Boolean);
      const allSkippedByValidatedPriorKnowledge = mappedUnits.length === mapping.learning_unit_keys.length
        && mappedUnits.every((unit) => unit.instructional_treatment === 'VALIDATED_PRIOR_KNOWLEDGE_NO_INITIAL_INSTRUCTION'
          && Array.isArray(unit.vpk_basis_refs || unit.vpk_decision_refs) && (unit.vpk_basis_refs || unit.vpk_decision_refs).length > 0);
      if (allSkippedByValidatedPriorKnowledge) {
        const decisions = mappedUnits.flatMap((unit) => (unit.vpk_basis_refs || unit.vpk_decision_refs || []).map((ref) => vpkById.get(String(ref))))
          .filter((decision) => decision?.decision_status === 'VALIDATED_PRIOR_KNOWLEDGE');
        if (decisions.length) vpk = decisions.sort((a, b) => new Date(b.decided_at || 0) - new Date(a.decided_at || 0))[0];
      }
    }
    if (required && (!mapping || !Array.isArray(mapping.learning_unit_keys) || mapping.learning_unit_keys.length === 0)) {
      unresolved.push(sourceRef);
    }
    entries.push(Object.freeze({
      source_content_item_id: source.source_content_item_id,
      source_ref: sourceRef,
      required,
      excluded,
      exclusion_reason: excluded ? String(source.classification_reason || source.classification || 'EXCLUDED_BY_APPROVED_SOURCE_CLASSIFICATION') : null,
      mapped_learning_unit_keys: Object.freeze(mapping?.learning_unit_keys ? [...mapping.learning_unit_keys] : []),
      mapped_at: mapping?.learning_unit_keys?.length ? now : null,
      planned_at: mapping?.learning_unit_keys?.length ? now : null,
      validated_prior_knowledge_at: vpk ? new Date(vpk.decided_at || now) : null,
      instructionally_complete_at: vpk ? new Date(vpk.decided_at || now) : null,
      instructional_completion_basis: vpk ? 'VALIDATED_PRIOR_KNOWLEDGE' : null,
      vpk_decision_id: vpk?.vpk_decision_id || null,
    }));
  }
  return Object.freeze({
    entries: Object.freeze(entries),
    outcome: unresolved.length ? 'FAIL' : 'PASS',
    requiredCount: entries.filter((entry) => entry.required).length,
    mappedCount: entries.filter((entry) => entry.required && entry.mapped_learning_unit_keys.length).length,
    excludedCount: entries.filter((entry) => entry.excluded).length,
    vpkCompleteCount: entries.filter((entry) => entry.instructional_completion_basis === 'VALIDATED_PRIOR_KNOWLEDGE').length,
    unresolvedSourceRefs: Object.freeze(unresolved),
    policyVersion: COVERAGE_POLICY_VERSION,
  });
}

function auditEndOfCourseCoverage({ coverageRows = [], requiredSourceIds = [] } = {}) {
  const required = new Set(requiredSourceIds.map(String));
  const unresolved = [];
  let complete = 0;
  for (const row of coverageRows) {
    if (!required.has(String(row.source_content_item_id))) continue;
    if (row.instructionally_complete_at && ['TAUGHT', 'VALIDATED_PRIOR_KNOWLEDGE'].includes(row.instructional_completion_basis)) complete += 1;
    else unresolved.push(String(row.source_ref || row.source_content_item_id));
  }
  const missingRows = [...required].filter((id) => !coverageRows.some((row) => String(row.source_content_item_id) === id));
  unresolved.push(...missingRows);
  return Object.freeze({
    kind: 'END_OF_COURSE',
    outcome: unresolved.length ? 'FAIL' : 'PASS',
    completionAllowed: unresolved.length === 0,
    requiredCount: required.size,
    instructionallyCompleteCount: complete,
    unresolvedSourceRefs: Object.freeze([...new Set(unresolved)]),
    recoveryPolicyVersion: 'incomplete-required-content.v1',
    completionBasisAllowed: Object.freeze(['TAUGHT', 'VALIDATED_PRIOR_KNOWLEDGE']),
  });
}

function activationCoverageDecision({ preActivationAudit, diagnosticResolved = true } = {}) {
  const blockers = [];
  if (!preActivationAudit || preActivationAudit.outcome !== 'PASS') blockers.push('REQUIRED_COVERAGE_UNRESOLVED');
  if (!diagnosticResolved) blockers.push('REQUIRED_DIAGNOSTIC_UNRESOLVED');
  return Object.freeze({
    allowed: blockers.length === 0,
    blockers: Object.freeze(blockers),
    owner: 'Course Lifecycle consumes this decision; D08 does not activate the Course',
  });
}

function classifyScopeChange({ origin = 'SUBJECT', added = [], removed = [], changed = [], explanationOnly = false, authoritativeScope = false } = {}) {
  const hasDelta = added.length > 0 || removed.length > 0 || changed.length > 0;
  if (!hasDelta) return Object.freeze({ changeKind: 'NO_CHANGE', requiresPlanVersion: false, requiresReview: false, policyVersion: SCOPE_CHANGE_POLICY_VERSION });
  if (explanationOnly === true && authoritativeScope !== true) {
    return Object.freeze({ changeKind: 'MINOR_SUPPLEMENT', requiresPlanVersion: false, requiresReview: false, policyVersion: SCOPE_CHANGE_POLICY_VERSION });
  }
  if (authoritativeScope === true || String(origin).toUpperCase() === 'SUBJECT') {
    return Object.freeze({ changeKind: 'REVIEW_REQUIRED', requiresPlanVersion: true, requiresReview: true, policyVersion: SCOPE_CHANGE_POLICY_VERSION });
  }
  return Object.freeze({ changeKind: 'REVIEW_REQUIRED', requiresPlanVersion: true, requiresReview: true, policyVersion: SCOPE_CHANGE_POLICY_VERSION });
}

function buildStudentCoverageReport({ course, plan, sources = [], coverageRows = [], mappings = [], assumedPrerequisites = [], latestCoverageAudit = null } = {}) {
  const mappingCount = new Map();
  for (const mapping of mappings) mappingCount.set(String(mapping.coverage_entry_id), (mappingCount.get(String(mapping.coverage_entry_id)) || 0) + 1);
  const requiredRows = coverageRows.filter((row) => sources.find((source) => source.source_content_item_id === row.source_content_item_id)?.classification === SOURCE_CLASS_REQUIRED);
  const completeRows = requiredRows.filter((row) => row.instructionally_complete_at && ['TAUGHT', 'VALIDATED_PRIOR_KNOWLEDGE'].includes(row.instructional_completion_basis));
  const pendingRows = requiredRows.filter((row) => !row.instructionally_complete_at);
  const excludedRows = coverageRows.filter((row) => row.excluded_at);
  return Object.freeze({
    courseTitle: course?.title || 'Course',
    planVersion: plan?.version_no || null,
    planState: plan?.plan_state || null,
    status: latestCoverageAudit?.outcome || (requiredRows.every((row) => row.mapped_at) ? 'PASS' : 'NEEDS_REVIEW'),
    summary: Object.freeze({
      requiredItems: requiredRows.length,
      mappedRequiredItems: requiredRows.filter((row) => row.mapped_at).length,
      instructionallyCompleteItems: completeRows.length,
      pendingInstructionItems: pendingRows.length,
      explicitlyExcludedItems: excludedRows.length,
    }),
    messages: Object.freeze([
      requiredRows.every((row) => row.mapped_at)
        ? 'Every required source item is accounted for in the Course Plan.'
        : 'Some required course content still needs a Course Plan mapping before activation can be allowed.',
      completeRows.some((row) => row.instructional_completion_basis === 'VALIDATED_PRIOR_KNOWLEDGE')
        ? 'Some content is complete through validated prior knowledge; it remains part of cumulative course responsibility.'
        : 'Instructional completion will be recorded only after teaching or validated prior knowledge.',
      'Coverage records whether required content is accounted for. It does not claim that the content is mastered.',
    ]),
    assumptions: Object.freeze(assumedPrerequisites.map((item) => ({
      label: item.label,
      description: item.description || null,
      status: item.resolution_state || 'ASSUMED',
    }))),
    exclusions: Object.freeze(excludedRows.map((row) => ({
      reason: row.exclusion_reason || 'Explicitly excluded by the approved source classification.',
    }))),
    items: Object.freeze(requiredRows.map((row) => ({
      mapped: Boolean(row.mapped_at),
      mappingCount: mappingCount.get(String(row.coverage_entry_id)) || (row.learning_unit_id ? 1 : 0),
      instructionalStatus: row.instructionally_complete_at
        ? row.instructional_completion_basis === 'VALIDATED_PRIOR_KNOWLEDGE' ? 'Validated prior knowledge' : 'Taught'
        : row.mapped_at ? 'Planned' : 'Needs mapping',
    }))),
  });
}

function vpkCompressionPosture({ decision } = {}) {
  const validated = decision?.decision_status === 'VALIDATED_PRIOR_KNOWLEDGE';
  return Object.freeze({
    mayCompressInstruction: validated,
    maySkipInitialInstruction: validated,
    cumulativeAssessmentResponsibilityRetained: validated,
    masteryStateChanged: false,
    assessmentEligibilityLedgerMutated: false,
    basis: validated ? decision.vpk_decision_id : null,
  });
}

module.exports = {
  CRITICALITIES,
  TREATMENTS,
  COVERAGE_AUDIT_KINDS,
  PLAN_SCHEMA_VERSION,
  COVERAGE_POLICY_VERSION,
  SCOPE_CHANGE_POLICY_VERSION,
  digest,
  latestVpkByTarget,
  assessRequiredDiagnostic,
  validateCoursePlanProposal,
  reconcileCoverage,
  auditEndOfCourseCoverage,
  activationCoverageDecision,
  classifyScopeChange,
  buildStudentCoverageReport,
  vpkCompressionPosture,
};
