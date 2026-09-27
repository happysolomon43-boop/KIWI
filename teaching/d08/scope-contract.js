'use strict';

const { SCOPE_CHANGE_RULE_VERSION, VPK_CONTRADICTION_RULE_VERSION, digest, text } = require('./contracts-core');

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

module.exports = { classifyScopeChange, buildPlanDiff, evaluateVpkContradiction };
