'use strict';

const crypto = require('node:crypto');

const PLAN_SCHEMA_VERSION = 'd08.course-plan.v1';
const COVERAGE_RULE_VERSION = 'coverage-reconciliation.v1';
const SCOPE_CHANGE_RULE_VERSION = 'course-scope-change.v1';
const EXIT_CONDITION_RULE_VERSION = 'learning-unit-exit-condition.v1';
const VPK_CONTRADICTION_RULE_VERSION = 'vpk-contradiction.v1';
const CRITICALITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'FOUNDATIONAL']);
const COMPLETION_BASES = new Set(['TAUGHT', 'VALIDATED_PRIOR_KNOWLEDGE']);
const FORBIDDEN_AUTHORITY_KEYS = new Set([
  'mastery', 'mastery_state', 'secure', 'mark', 'marks', 'grade', 'score', 'gpa',
  'assessment_eligible', 'assessmentEligibility', 'pass_threshold', 'passThreshold',
  'progression_state', 'progressionOutcome', 'lifecycle_state', 'course_state',
]);
const EVIDENCE_TYPES = new Set([
  'EXPLANATION', 'PROBLEM_SOLUTION', 'DERIVATION', 'DEMONSTRATION', 'APPLICATION',
  'IDENTIFICATION', 'COMPARISON', 'ANALYSIS', 'CONSTRUCTION', 'PROOF', 'EVALUATION',
  'IMPLEMENTATION', 'TRACE', 'MODEL', 'WRITTEN_RESPONSE', 'ORAL_RESPONSE', 'OTHER',
]);

function digest(value) {
  const stable = (item) => {
    if (Array.isArray(item)) return item.map(stable);
    if (item && typeof item === 'object') return Object.fromEntries(Object.keys(item).sort().map((key) => [key, stable(item[key])]));
    return item;
  };
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function failure(message, code = 'TEACHING_D08_CONTRACT_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function text(value, field, max = 4000, required = true) {
  if (value == null && !required) return null;
  const out = String(value ?? '').trim();
  if (required && !out) failure(`${field} is required.`);
  if (Buffer.byteLength(out) > max) failure(`${field} exceeds ${max} bytes.`);
  return out || null;
}
function array(value, field, max = 1000) {
  if (!Array.isArray(value) || value.length > max) failure(`${field} must be an array with at most ${max} items.`);
  return value;
}
function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) failure(`${field} must be an object.`);
  return value;
}
function assertNoAuthoritySmuggling(value, path = 'plan') {
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoAuthoritySmuggling(item, `${path}[${index}]`));
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_AUTHORITY_KEYS.has(key)) failure(`${path}.${key} attempts to claim authority outside Course Planning.`, 'TEACHING_D08_AUTHORITY_SMUGGLING');
    assertNoAuthoritySmuggling(child, `${path}.${key}`);
  }
}
function latestVpk(vpkDecisions = []) {
  const ordered = [...vpkDecisions].sort((a, b) => String(a.decided_at || '').localeCompare(String(b.decided_at || '')));
  const map = new Map();
  for (const row of ordered) map.set(`${row.target_kind}:${row.target_ref}`, row);
  return map;
}
function normalizeExitCondition(raw, field) {
  const condition = object(raw, field);
  const criterion = text(condition.criterion, `${field}.criterion`, 2000);
  const evidenceType = text(condition.evidence_type, `${field}.evidence_type`, 100).toUpperCase();
  if (!EVIDENCE_TYPES.has(evidenceType)) failure(`${field}.evidence_type is not an approved evidence description.`, 'TEACHING_D08_EXIT_CONDITION_INVALID');
  return Object.freeze({
    criterion,
    evidence_type: evidenceType,
    independence_required: condition.independence_required === true,
  });
}
function validateExitConditions(unit) {
  try {
    const critical = unit.foundational === true || ['HIGH', 'FOUNDATIONAL'].includes(String(unit.criticality || '').toUpperCase());
    const conditions = array(unit.exit_conditions, `learning_unit:${unit.id || unit.learning_unit_id}.exit_conditions`, 50)
      .map((condition, index) => normalizeExitCondition(condition, `exit_conditions[${index}]`));
    if (critical && !conditions.length) failure('Critical Learning Units require evidence-bearing exit conditions.', 'TEACHING_D08_CRITICAL_EXIT_CONDITION_REQUIRED');
    if (critical && !conditions.some((condition) => condition.criterion.length >= 8 && condition.evidence_type)) {
      failure('Critical Learning Unit exit conditions are not meaningful enough to support later evidence.', 'TEACHING_D08_CRITICAL_EXIT_CONDITION_NOT_MEANINGFUL');
    }
    return { ok: true, value: conditions, critical, ruleVersion: EXIT_CONDITION_RULE_VERSION };
  } catch (error) {
    return { ok: false, reason: error.code || error.message };
  }
}

function validateCoursePlanProposal(output, { audit, sourceItems = [], vpkDecisions = [] } = {}) {
  try {
    object(output, 'Course Plan');
    assertNoAuthoritySmuggling(output);
    if (!audit || audit.status && audit.status !== 'VALIDATED_CANDIDATE') failure('A validated Curriculum Audit is required.', 'TEACHING_D08_CURRICULUM_AUDIT_REQUIRED');
    const auditOutput = object(audit.audit_output, 'Curriculum Audit output');
    const topics = array(output.topics, 'topics', 300);
    const learningUnits = array(output.learning_units, 'learning_units', 1000);
    const dependencies = array(output.dependencies, 'dependencies', 3000);
    const mappings = array(output.source_mappings, 'source_mappings', 3000);
    const prerequisites = array(output.assumed_prerequisites, 'assumed_prerequisites', 500);
    const exclusions = array(output.excluded_sources, 'excluded_sources', 1000);
    const planningSummary = text(output.planning_summary, 'planning_summary', 8000);

    const topicIds = new Set();
    const subtopicIds = new Set();
    const normalizedTopics = topics.map((topic, topicIndex) => {
      object(topic, `topics[${topicIndex}]`);
      const id = text(topic.id, `topics[${topicIndex}].id`, 200);
      if (topicIds.has(id)) failure(`Duplicate Topic ${id}.`);
      topicIds.add(id);
      if (!Number.isInteger(topic.ordinal) || topic.ordinal < 0) failure(`Topic ${id} has invalid ordinal.`);
      const localSubtopics = new Set();
      const normalizedSubtopics = array(topic.subtopics || [], `topics[${topicIndex}].subtopics`, 500).map((subtopic, subIndex) => {
        object(subtopic, `topics[${topicIndex}].subtopics[${subIndex}]`);
        const subId = text(subtopic.id, `subtopic.id`, 200);
        if (localSubtopics.has(subId) || subtopicIds.has(subId)) failure(`Duplicate Subtopic ${subId}.`);
        localSubtopics.add(subId); subtopicIds.add(subId);
        if (!Number.isInteger(subtopic.ordinal) || subtopic.ordinal < 0) failure(`Subtopic ${subId} has invalid ordinal.`);
        return Object.freeze({ id: subId, title: text(subtopic.title, 'subtopic.title', 500), ordinal: subtopic.ordinal });
      });
      return Object.freeze({ id, title: text(topic.title, `topic:${id}.title`, 500), ordinal: topic.ordinal, subtopics: Object.freeze(normalizedSubtopics) });
    });
    if (!normalizedTopics.length) failure('Course Plan must contain at least one Topic.');

    const auditUnits = new Map(array(auditOutput.learning_units || [], 'audit.learning_units', 1000).map((unit) => [String(unit.id), unit]));
    if (!auditUnits.size) failure('Curriculum Audit contains no Learning Units.', 'TEACHING_D08_CURRICULUM_AUDIT_REQUIRED');
    const unitIds = new Set();
    const representedAuditUnits = new Set();
    const vpkByTarget = latestVpk(vpkDecisions);
    const normalizedUnits = learningUnits.map((unit, index) => {
      object(unit, `learning_units[${index}]`);
      const id = text(unit.id, `learning_units[${index}].id`, 200);
      if (unitIds.has(id)) failure(`Duplicate Learning Unit ${id}.`);
      unitIds.add(id);
      const topicId = text(unit.topic_id, `learning_unit:${id}.topic_id`, 200);
      if (!topicIds.has(topicId)) failure(`Learning Unit ${id} references unknown Topic.`);
      const subtopicId = text(unit.subtopic_id, `learning_unit:${id}.subtopic_id`, 200, false);
      if (subtopicId && !subtopicIds.has(subtopicId)) failure(`Learning Unit ${id} references unknown Subtopic.`);
      const auditRefs = array(unit.audit_unit_refs, `learning_unit:${id}.audit_unit_refs`, 100).map(String);
      if (!auditRefs.length || auditRefs.some((ref) => !auditUnits.has(ref))) failure(`Learning Unit ${id} must map only to validated Curriculum Audit units.`, 'TEACHING_D08_AUDIT_UNIT_MAPPING_INVALID');
      auditRefs.forEach((ref) => representedAuditUnits.add(ref));
      const criticality = text(unit.criticality, `learning_unit:${id}.criticality`, 100).toUpperCase();
      if (!CRITICALITIES.has(criticality)) failure(`Learning Unit ${id} has invalid criticality.`);
      if (!Number.isInteger(unit.instructional_load_min_minutes) || unit.instructional_load_min_minutes < 0 || !Number.isInteger(unit.instructional_load_max_minutes) || unit.instructional_load_max_minutes < unit.instructional_load_min_minutes) failure(`Learning Unit ${id} has invalid instructional load.`);
      const exit = validateExitConditions({ ...unit, id, criticality });
      if (!exit.ok) failure(`Learning Unit ${id} exit conditions failed validation.`, exit.reason);
      const mode = String(unit.instructional_mode || 'STANDARD').toUpperCase();
      if (!['STANDARD', 'VPK_COMPRESSED'].includes(mode)) failure(`Learning Unit ${id} has invalid instructional mode.`);
      let laterAssessmentBasis = null;
      if (mode === 'VPK_COMPRESSED') {
        const everyValidated = auditRefs.every((ref) => vpkByTarget.get(`LEARNING_UNIT:${ref}`)?.decision_status === 'VALIDATED_PRIOR_KNOWLEDGE');
        if (!everyValidated) failure(`Learning Unit ${id} cannot compress ordinary instruction without current VPK evidence.`, 'TEACHING_D08_VPK_COMPRESSION_UNAUTHORIZED');
        laterAssessmentBasis = 'VALIDATED_PRIOR_KNOWLEDGE';
      }
      return Object.freeze({
        id,
        title: text(unit.title, `learning_unit:${id}.title`, 500),
        topic_id: topicId,
        subtopic_id: subtopicId,
        audit_unit_refs: Object.freeze(auditRefs),
        intended_competence: text(unit.intended_competence, `learning_unit:${id}.intended_competence`, 4000),
        exit_conditions: Object.freeze(exit.value),
        criticality,
        foundational: unit.foundational === true,
        instructional_load_min_minutes: unit.instructional_load_min_minutes,
        instructional_load_max_minutes: unit.instructional_load_max_minutes,
        instructional_mode: mode,
        later_assessment_basis: laterAssessmentBasis,
        planning_attention: Object.freeze(array(unit.planning_attention || [], `learning_unit:${id}.planning_attention`, 100).map((entry, i) => text(entry, `planning_attention[${i}]`, 1000))),
      });
    });
    const missingAuditUnits = [...auditUnits.keys()].filter((ref) => !representedAuditUnits.has(ref));
    if (missingAuditUnits.length) failure(`Course Plan omitted Curriculum Audit Learning Units: ${missingAuditUnits.join(', ')}`, 'TEACHING_D08_REQUIRED_UNIT_OMITTED');

    const normalizedDependencies = dependencies.map((dependency, index) => {
      object(dependency, `dependencies[${index}]`);
      const from = text(dependency.learning_unit_id, 'dependency.learning_unit_id', 200);
      const to = text(dependency.prerequisite_learning_unit_id, 'dependency.prerequisite_learning_unit_id', 200);
      if (!unitIds.has(from) || !unitIds.has(to) || from === to) failure('Course Plan dependency references invalid Learning Units.');
      return Object.freeze({ learning_unit_id: from, prerequisite_learning_unit_id: to, dependency_kind: text(dependency.dependency_kind || 'PREREQUISITE', 'dependency.dependency_kind', 100), rationale: text(dependency.rationale, 'dependency.rationale', 2000, false) });
    });
    const edges = new Map([...unitIds].map((id) => [id, []]));
    normalizedDependencies.forEach((dependency) => edges.get(dependency.learning_unit_id).push(dependency.prerequisite_learning_unit_id));
    const visiting = new Set(); const visited = new Set();
    const walk = (id) => { if (visiting.has(id)) failure('Course Plan Learning Unit dependencies contain a cycle.', 'TEACHING_D08_DEPENDENCY_CYCLE'); if (visited.has(id)) return; visiting.add(id); edges.get(id).forEach(walk); visiting.delete(id); visited.add(id); };
    [...unitIds].forEach(walk);

    const sourceByRef = new Map(sourceItems.map((source) => [String(source.source_ref), source]));
    const mappingBySource = new Map();
    const normalizedMappings = mappings.map((mapping, index) => {
      object(mapping, `source_mappings[${index}]`);
      const sourceRef = text(mapping.source_ref, 'source_mapping.source_ref', 700);
      const source = sourceByRef.get(sourceRef);
      if (!source) failure(`Unknown source mapping ${sourceRef}.`);
      const learningUnitIds = [...new Set(array(mapping.learning_unit_ids, `source_mapping:${sourceRef}.learning_unit_ids`, 200).map(String))];
      if (!learningUnitIds.length || learningUnitIds.some((id) => !unitIds.has(id))) failure(`Source mapping ${sourceRef} has invalid Learning Units.`);
      if (mappingBySource.has(sourceRef)) failure(`Duplicate source mapping ${sourceRef}.`);
      mappingBySource.set(sourceRef, learningUnitIds);
      return Object.freeze({ source_ref: sourceRef, learning_unit_ids: Object.freeze(learningUnitIds) });
    });
    const exclusionBySource = new Map();
    const normalizedExclusions = exclusions.map((exclusion, index) => {
      object(exclusion, `excluded_sources[${index}]`);
      const sourceRef = text(exclusion.source_ref, 'excluded_source.source_ref', 700);
      const source = sourceByRef.get(sourceRef);
      if (!source) failure(`Unknown excluded source ${sourceRef}.`);
      if (source.academically_meaningful === true || source.classification === 'ACADEMICALLY_MEANINGFUL') failure(`Required meaningful source ${sourceRef} cannot be excluded by a Course Plan proposal.`, 'TEACHING_D08_REQUIRED_SOURCE_EXCLUSION_FORBIDDEN');
      const reason = text(exclusion.reason, `excluded_source:${sourceRef}.reason`, 3000);
      exclusionBySource.set(sourceRef, reason);
      return Object.freeze({ source_ref: sourceRef, reason });
    });
    const unresolvedSources = sourceItems.filter((source) => (source.academically_meaningful === true || source.classification === 'ACADEMICALLY_MEANINGFUL') && !mappingBySource.has(String(source.source_ref)));
    if (unresolvedSources.length) failure(`Required meaningful source remains unmapped: ${unresolvedSources.map((source) => source.source_ref).join(', ')}`, 'TEACHING_D08_REQUIRED_SOURCE_UNMAPPED');
    const unaccountedNonRequired = sourceItems.filter((source) => !(source.academically_meaningful === true || source.classification === 'ACADEMICALLY_MEANINGFUL') && !mappingBySource.has(String(source.source_ref)) && !exclusionBySource.has(String(source.source_ref)));
    if (unaccountedNonRequired.length) failure(`Source items require explicit mapping or exclusion: ${unaccountedNonRequired.map((source) => source.source_ref).join(', ')}`, 'TEACHING_D08_SOURCE_ACCOUNTING_INCOMPLETE');

    const vpkPrereqs = latestVpk(vpkDecisions);
    const normalizedPrerequisites = prerequisites.map((prerequisite, index) => {
      const prerequisiteRef = text(prerequisite.prerequisite_ref, `assumed_prerequisites[${index}].prerequisite_ref`, 500);
      const current = vpkPrereqs.get(`PREREQUISITE:${prerequisiteRef}`);
      return Object.freeze({
        prerequisite_ref: prerequisiteRef,
        disclosure: text(prerequisite.disclosure, `assumed_prerequisites[${index}].disclosure`, 3000),
        validation_status: current?.decision_status === 'VALIDATED_PRIOR_KNOWLEDGE' ? 'VALIDATED_PRIOR_KNOWLEDGE' : 'UNVERIFIED',
      });
    });
    const requiredPrereqs = new Set((auditOutput.assumed_prerequisites || []).map((item) => String(item.prerequisite_ref || item.prerequisite_learning_unit_id || '')).filter(Boolean));
    const disclosedPrereqs = new Set(normalizedPrerequisites.map((item) => item.prerequisite_ref));
    const omittedPrereqs = [...requiredPrereqs].filter((ref) => !disclosedPrereqs.has(ref));
    if (omittedPrereqs.length) failure(`Course Plan omitted assumed prerequisites: ${omittedPrereqs.join(', ')}`, 'TEACHING_D08_PREREQUISITE_DISCLOSURE_REQUIRED');

    const normalized = Object.freeze({
      topics: Object.freeze(normalizedTopics),
      learning_units: Object.freeze(normalizedUnits),
      dependencies: Object.freeze(normalizedDependencies),
      source_mappings: Object.freeze(normalizedMappings),
      assumed_prerequisites: Object.freeze(normalizedPrerequisites.map(Object.freeze)),
      excluded_sources: Object.freeze(normalizedExclusions),
      planning_summary: planningSummary,
    });
    return { ok: true, value: normalized, scopeChecksum: digest({ topics: normalizedTopics, learning_units: normalizedUnits, dependencies: normalizedDependencies, source_mappings: normalizedMappings, assumed_prerequisites: normalizedPrerequisites, excluded_sources: normalizedExclusions }) };
  } catch (error) {
    return { ok: false, reason: error.code || error.message };
  }
}

function reconcileCoverage({ sourceItems = [], mappings = [], exclusions = [], coverageRows = [], learningUnits = [], stage = 'PRE_ACTIVATION' } = {}) {
  if (!['PRE_ACTIVATION', 'END_OF_COURSE'].includes(stage)) failure('Unsupported Coverage Audit stage.');
  const mappedBySource = new Map();
  for (const mapping of mappings) {
    const sourceId = String(mapping.source_content_item_id || '');
    if (!sourceId || !mapping.learning_unit_id) continue;
    const set = mappedBySource.get(sourceId) || new Set();
    set.add(String(mapping.learning_unit_id));
    mappedBySource.set(sourceId, set);
  }
  const approvedExclusions = new Map(exclusions.filter((item) => item.approved === true && String(item.reason || '').trim() && String(item.approval_authority_ref || '').trim()).map((item) => [String(item.source_content_item_id), item]));
  const latestCoverage = new Map();
  for (const row of coverageRows) latestCoverage.set(String(row.source_content_item_id), row);
  const unitNames = new Map(learningUnits.map((unit) => [String(unit.learning_unit_id), unit.title]));
  const required = sourceItems.filter((source) => source.academically_meaningful === true || source.classification === 'ACADEMICALLY_MEANINGFUL');
  const unresolved = [];
  const accounted = [];
  const incomplete = [];
  for (const source of required) {
    const sourceId = String(source.source_content_item_id);
    const mapped = mappedBySource.get(sourceId);
    if (!mapped?.size) {
      if (approvedExclusions.has(sourceId)) {
        accounted.push({ label: source.content_summary || source.source_ref, basis: 'APPROVED_EXCLUSION' });
      } else {
        unresolved.push({ label: source.content_summary || source.source_ref, reason: 'REQUIRED_SOURCE_UNMAPPED' });
      }
      continue;
    }
    if (stage === 'PRE_ACTIVATION') {
      accounted.push({ label: source.content_summary || source.source_ref, basis: 'MAPPED' });
      continue;
    }
    const coverage = latestCoverage.get(sourceId);
    if (coverage?.instructionally_complete_at && COMPLETION_BASES.has(String(coverage.instructional_completion_basis))) {
      accounted.push({ label: source.content_summary || source.source_ref, basis: String(coverage.instructional_completion_basis) });
    } else {
      incomplete.push({ label: source.content_summary || source.source_ref, mappedUnits: [...mapped].map((id) => unitNames.get(id) || 'Required Learning Unit') });
    }
  }
  const status = unresolved.length ? 'BLOCKED' : stage === 'END_OF_COURSE' && incomplete.length ? 'INCOMPLETE' : 'PASS';
  return Object.freeze({
    stage,
    status,
    pass: status === 'PASS',
    unresolved: Object.freeze(unresolved.map(Object.freeze)),
    accounted: Object.freeze(accounted.map(Object.freeze)),
    incomplete: Object.freeze(incomplete.map(Object.freeze)),
    totals: Object.freeze({ required: required.length, accounted: accounted.length, unresolved: unresolved.length, incomplete: incomplete.length }),
    rule_version: COVERAGE_RULE_VERSION,
    policy_version: COVERAGE_RULE_VERSION,
    mastery_state: undefined,
  });
}

function activationDecision({ reconciliation, learningUnits = [] } = {}) {
  if (!reconciliation || reconciliation.stage !== 'PRE_ACTIVATION') failure('Pre-activation Coverage reconciliation is required.');
  const invalidCritical = learningUnits.filter((unit) => {
    if (!(unit.foundational === true || ['HIGH', 'FOUNDATIONAL'].includes(String(unit.criticality)))) return false;
    const result = validateExitConditions({ ...unit, id: unit.learning_unit_id || unit.id });
    return !result.ok;
  });
  const allowed = reconciliation.status === 'PASS' && invalidCritical.length === 0;
  return Object.freeze({ allowed, decision: allowed ? 'COVERAGE_READY_FOR_D10_ACTIVATION' : 'ACTIVATION_BLOCKED', blocker_codes: Object.freeze([...(reconciliation.unresolved.length ? ['REQUIRED_SOURCE_UNMAPPED'] : []), ...(invalidCritical.length ? ['CRITICAL_EXIT_CONDITION_INVALID'] : [])]), authoritative_owner: 'Course lifecycle/Progression' });
}
function completionDecision({ reconciliation } = {}) {
  if (!reconciliation || reconciliation.stage !== 'END_OF_COURSE') failure('End-of-Course Coverage reconciliation is required.');
  if (reconciliation.status === 'PASS') return Object.freeze({ allowed: true, decision: 'COVERAGE_COMPLETE', incomplete_is_fail: false, policy_version: 'incomplete-required-content.v1' });
  return Object.freeze({ allowed: false, decision: 'INCOMPLETE_RECOVERY_REQUIRED', incomplete_is_fail: false, policy_version: 'incomplete-required-content.v1' });
}

function buildCoverageReport({ sourceItems = [], reconciliation, scopeChanges = [], prerequisites = [] } = {}) {
  if (!reconciliation) failure('Coverage reconciliation is required.');
  const supplemental = sourceItems.filter((source) => source.source_kind === 'STUDENT_SUPPLEMENT' || source.source_kind === 'AUTHORITATIVE_SCHOOL_SCOPE').length;
  const latestChange = [...scopeChanges].sort((a, b) => String(b.detected_at || '').localeCompare(String(a.detected_at || '')))[0] || null;
  const gaps = [...reconciliation.unresolved, ...reconciliation.incomplete].map((item) => item.label);
  return Object.freeze({
    headline: reconciliation.status === 'PASS' ? 'Course coverage is accounted for.' : 'Course coverage needs review.',
    status: reconciliation.status,
    summary: reconciliation.status === 'PASS'
      ? `KIWI has accounted for all ${reconciliation.totals.required} required course source item${reconciliation.totals.required === 1 ? '' : 's'}.`
      : `${gaps.length} required course item${gaps.length === 1 ? ' needs' : 's need'} attention before the next protected course transition.`,
    whatKiwiFound: Object.freeze({ requiredMeaningfulItems: reconciliation.totals.required, supplementarySources: supplemental, assumedPrerequisites: prerequisites.length }),
    gaps: Object.freeze(gaps),
    latestScopeUpdate: latestChange ? latestChange.student_summary || 'A Course scope update is under review.' : null,
    completionMeaning: reconciliation.stage === 'END_OF_COURSE' ? 'Coverage completion means required curriculum was taught or independently validated as prior knowledge; it is not the same thing as mastery.' : 'Pre-activation coverage means required curriculum is represented in the reviewed plan; it is not the same thing as mastery.',
  });
}

function classifyScopeChange({ currentSources = [], candidateSources = [], courseLifecycle = 'DRAFT' } = {}) {
  const key = (source) => `${source.source_kind}|${source.source_ref}`;
  const current = new Map(currentSources.map((source) => [key(source), source]));
  const candidate = new Map(candidateSources.map((source) => [key(source), source]));
  const added = []; const removed = []; const changed = []; const metadataOnly = [];
  for (const [sourceKey, next] of candidate) {
    const previous = current.get(sourceKey);
    if (!previous) { added.push(next); continue; }
    if (String(previous.content_hash || '') !== String(next.content_hash || '')) changed.push({ before: previous, after: next });
    else if (String(previous.source_version_ref || '') !== String(next.source_version_ref || '')) metadataOnly.push({ before: previous, after: next });
  }
  for (const [sourceKey, previous] of current) if (!candidate.has(sourceKey)) removed.push(previous);
  const material = added.length > 0 || removed.length > 0 || changed.length > 0;
  const classification = material ? 'FORMAL_COURSE_PLAN_UPDATE' : metadataOnly.length ? 'MINOR_SUPPLEMENTARY_UPDATE' : 'NONE';
  return Object.freeze({
    classification,
    requiresPlanVersion: material,
    courseSnapshotMustRemainPinned: material && String(courseLifecycle).toUpperCase() !== 'DRAFT',
    added: Object.freeze(added), removed: Object.freeze(removed), changed: Object.freeze(changed), metadataOnly: Object.freeze(metadataOnly),
    diffDigest: digest({ added: added.map(key), removed: removed.map(key), changed: changed.map((row) => [key(row.before), row.before.content_hash, row.after.content_hash]) }),
    ruleVersion: SCOPE_CHANGE_RULE_VERSION,
    policyVersion: SCOPE_CHANGE_RULE_VERSION,
  });
}

function buildPlanDiff(previousBundle = {}, nextPlan = {}) {
  const previousTitles = new Set((previousBundle.learningUnits || []).map((unit) => String(unit.title)));
  const nextTitles = new Set((nextPlan.learning_units || []).map((unit) => String(unit.title)));
  const added = [...nextTitles].filter((title) => !previousTitles.has(title));
  const removed = [...previousTitles].filter((title) => !nextTitles.has(title));
  const previousPrereqs = new Set((previousBundle.prerequisites || []).map((item) => String(item.prerequisite_ref)));
  const nextPrereqs = new Set((nextPlan.assumed_prerequisites || []).map((item) => String(item.prerequisite_ref)));
  const prerequisiteChanges = [...new Set([...previousPrereqs, ...nextPrereqs].filter((ref) => previousPrereqs.has(ref) !== nextPrereqs.has(ref)))];
  return Object.freeze({ added_learning_units: Object.freeze(added), removed_learning_units: Object.freeze(removed), prerequisite_changes: Object.freeze(prerequisiteChanges), student_summary: added.length || removed.length || prerequisiteChanges.length ? 'The Course Plan was updated after reviewed academic scope or structure changes. Previous Learning Units remain in historical lineage.' : 'No material Course Plan structure change was detected.' });
}

function evaluateVpkContradiction({ currentDecision, validatorId, validatorVersion, evidence = [] } = {}) {
  if (!currentDecision || currentDecision.decision_status !== 'VALIDATED_PRIOR_KNOWLEDGE') return Object.freeze({ changed: false, reason: 'NO_CURRENT_VALIDATED_PRIOR_KNOWLEDGE' });
  const controlled = evidence.filter((item) => item?.controlled === true && item.independent === true && item.contradicts === true && String(item.evidenceRef || '').trim() && String(item.probeRef || '').trim());
  if (!controlled.length) return Object.freeze({ changed: false, reason: 'NO_CONTROLLED_CONTRADICTORY_EVIDENCE' });
  return Object.freeze({
    changed: true,
    status: 'NOT_VALIDATED',
    supersedesVpkDecisionId: currentDecision.vpk_decision_id,
    targetKind: currentDecision.target_kind,
    targetRef: currentDecision.target_ref,
    validatorId: text(validatorId, 'validatorId', 200),
    validatorVersion: text(validatorVersion, 'validatorVersion', 100),
    evidenceRefs: Object.freeze(controlled.map((item) => String(item.evidenceRef))),
    provenanceRefs: Object.freeze(controlled.map((item) => `evidence:${String(item.evidenceRef)}`)),
    probeRefs: Object.freeze([...new Set(controlled.map((item) => String(item.probeRef)))]),
    policyVersion: 'validated-prior-knowledge.v1',
    contradictionRuleVersion: VPK_CONTRADICTION_RULE_VERSION,
    reasons: Object.freeze(['LATER_CONTROLLED_EVIDENCE_CONTRADICTED_VALIDATED_PRIOR_KNOWLEDGE']),
  });
}

module.exports = {
  PLAN_SCHEMA_VERSION,
  COVERAGE_RULE_VERSION,
  SCOPE_CHANGE_RULE_VERSION,
  EXIT_CONDITION_RULE_VERSION,
  VPK_CONTRADICTION_RULE_VERSION,
  digest,
  validateExitConditions,
  validateCoursePlanProposal,
  reconcileCoverage,
  activationDecision,
  completionDecision,
  buildCoverageReport,
  classifyScopeChange,
  buildPlanDiff,
  evaluateVpkContradiction,
};
