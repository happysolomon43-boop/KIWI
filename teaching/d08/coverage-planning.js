'use strict';

const COVERAGE_HINT_MAX_CHARS = 180;

function invalid(message, reason = 'TEACHING_D08_TPF03_COVERAGE_MAP_INVALID') {
  return { ok: false, reason, message };
}

function sourceAliasIndex(sources = []) {
  const aliases = new Map();
  for (const source of sources) {
    const canonical = String(source?.source_ref || '').trim();
    const id = String(source?.source_content_item_id || '').trim();
    if (!canonical) continue;
    aliases.set(canonical, canonical);
    if (id) {
      aliases.set(id, canonical);
      aliases.set(`source:${id}`, canonical);
    }
  }
  return aliases;
}

function isLineageReconciledAudit(auditOutput = {}) {
  return Boolean(
    auditOutput?.source_to_unit_reconciliation
    && Array.isArray(auditOutput.source_to_unit_reconciliation.required_item_map)
    && Array.isArray(auditOutput.source_to_unit_reconciliation.unmapped_required_refs)
  );
}

function legacyRequiredSources(sources = []) {
  return sources.filter((source) => (
    source?.classification === 'ACADEMICALLY_MEANINGFUL'
    && source?.academically_meaningful !== false
    && String(source?.source_ref || '').trim()
  ));
}

function requiredSourceRefs({ auditOutput = {}, sources = [] } = {}) {
  const aliases = sourceAliasIndex(sources);
  if (isLineageReconciledAudit(auditOutput)) {
    return [...new Set((auditOutput.source_inventory || [])
      .filter((item) => item?.proposed_scope_classification === 'required')
      .map((item) => aliases.get(String(item?.source_item_ref || '').trim()))
      .filter(Boolean))];
  }
  return legacyRequiredSources(sources).map((source) => String(source.source_ref));
}

function compactHint(value, maxChars = COVERAGE_HINT_MAX_CHARS) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function academicMeaningBySource(auditOutput = {}, sources = []) {
  const aliases = sourceAliasIndex(sources);
  const meanings = new Map();
  for (const item of auditOutput.source_inventory || []) {
    const canonical = aliases.get(String(item?.source_item_ref || '').trim());
    if (!canonical) continue;
    const meaning = compactHint(item?.academic_meaning);
    if (meaning) meanings.set(canonical, meaning);
  }
  return meanings;
}

function auditCoverageState({ auditOutput = {}, sources = [], sourceUnitGraph = new Map() } = {}) {
  const required = requiredSourceRefs({ auditOutput, sources });
  const missing = required.filter((sourceRef) => !(sourceUnitGraph.get(sourceRef) || []).length);
  return Object.freeze({
    lineageReconciled: isLineageReconciledAudit(auditOutput),
    requiredSourceRefs: Object.freeze(required),
    missingSourceRefs: Object.freeze(missing),
  });
}

function buildCoverageObligations({ auditOutput = {}, sources = [], sourceUnitGraph = new Map() } = {}) {
  const state = auditCoverageState({ auditOutput, sources, sourceUnitGraph });
  if (state.lineageReconciled) return Object.freeze([]);
  const meanings = academicMeaningBySource(auditOutput, sources);
  const byRef = new Map(sources.map((source) => [String(source?.source_ref || '').trim(), source]));
  return Object.freeze(state.missingSourceRefs.map((sourceRef) => {
    const source = byRef.get(sourceRef) || {};
    return Object.freeze({
      source_ref: sourceRef,
      academic_hint: meanings.get(sourceRef)
        || compactHint(source.classification_reason)
        || compactHint(source.content_summary)
        || null,
    });
  }));
}

function validateCoverageTreatmentPlan(output, { auditOutput = {}, sources = [], sourceUnitGraph = new Map() } = {}) {
  const state = auditCoverageState({ auditOutput, sources, sourceUnitGraph });
  if (state.lineageReconciled && state.missingSourceRefs.length) {
    return invalid(
      `Validated TPF-02 v1.1 audit is missing Learning Unit lineage for ${state.missingSourceRefs.length} required source item${state.missingSourceRefs.length === 1 ? '' : 's'}. Regenerate the Curriculum Audit instead of repairing it in Course Planning.`,
      'TEACHING_D08_AUDIT_LINEAGE_INVALID'
    );
  }

  const map = Array.isArray(output?.coverage_treatment_map) ? output.coverage_treatment_map : [];
  const aliases = sourceAliasIndex(sources);
  const knownUnits = new Set((auditOutput.learning_units || [])
    .map((unit) => String(unit?.learning_unit_id || unit?.id || '').trim())
    .filter(Boolean));
  const missingBeforePlanning = new Set(state.missingSourceRefs);
  const plannedBySource = new Map();

  for (const item of map) {
    const rawRef = String(item?.required_source_or_unit_ref || '').trim();
    if (!rawRef) continue;
    const sourceRef = aliases.get(rawRef) || null;
    if (!sourceRef) {
      if (knownUnits.has(rawRef)) continue;
      return invalid(`TPF-03 coverage treatment references unknown material or Learning Unit ${rawRef}.`, 'TEACHING_D08_TPF03_COVERAGE_REFERENCE_INVALID');
    }
    if (!missingBeforePlanning.has(sourceRef)) continue;
    if (plannedBySource.has(sourceRef)) {
      return invalid(`TPF-03 repeats material coverage for ${sourceRef}.`, 'TEACHING_D08_TPF03_DUPLICATE_SOURCE_COVERAGE');
    }
    const plannedRefs = [...new Set((item.planned_treatment_refs || []).map((value) => String(value || '').trim()).filter(Boolean))];
    const unknownRefs = plannedRefs.filter((ref) => !knownUnits.has(ref));
    if (unknownRefs.length) {
      return invalid(`TPF-03 mapped ${sourceRef} to unknown Learning Units: ${unknownRefs.join(', ')}`, 'TEACHING_D08_TPF03_COVERAGE_UNIT_INVALID');
    }
    plannedBySource.set(sourceRef, Object.freeze({
      learning_unit_refs: Object.freeze(plannedRefs),
      completeness: String(item.mapping_completeness_proposal || ''),
    }));
  }

  const unresolved = [];
  for (const sourceRef of missingBeforePlanning) {
    const planned = plannedBySource.get(sourceRef);
    if (!planned || planned.completeness !== 'full' || planned.learning_unit_refs.length === 0) unresolved.push(sourceRef);
  }
  if (unresolved.length) {
    const preview = unresolved.slice(0, 4).join(', ');
    const suffix = unresolved.length > 4 ? ` and ${unresolved.length - 4} more` : '';
    return invalid(
      `TPF-03 did not fully connect ${unresolved.length} legacy required material item${unresolved.length === 1 ? '' : 's'} to known Learning Units (${preview}${suffix}).`,
      'TEACHING_D08_REQUIRED_SOURCE_UNMAPPED'
    );
  }

  return { ok: true, plannedBySource, missingBeforePlanning, lineageReconciled: state.lineageReconciled };
}

function mergeCoverageTreatmentMappings({ output, auditOutput = {}, sources = [], sourceUnitGraph = new Map() } = {}) {
  const validated = validateCoverageTreatmentPlan(output, { auditOutput, sources, sourceUnitGraph });
  if (!validated.ok) return validated;
  const merged = new Map([...sourceUnitGraph].map(([sourceRef, refs]) => [String(sourceRef), new Set(Array.from(refs || [], String))]));
  for (const source of sources) {
    const sourceRef = String(source?.source_ref || '').trim();
    if (sourceRef && !merged.has(sourceRef)) merged.set(sourceRef, new Set());
  }
  for (const [sourceRef, planned] of validated.plannedBySource) {
    if (!merged.has(sourceRef)) merged.set(sourceRef, new Set());
    for (const unitRef of planned.learning_unit_refs) merged.get(sourceRef).add(unitRef);
  }
  return {
    ok: true,
    graph: new Map([...merged].map(([sourceRef, refs]) => [sourceRef, Object.freeze([...refs])])),
    lineageReconciled: validated.lineageReconciled,
  };
}

module.exports = {
  COVERAGE_HINT_MAX_CHARS,
  sourceAliasIndex,
  isLineageReconciledAudit,
  legacyRequiredSources,
  requiredSourceRefs,
  auditCoverageState,
  buildCoverageObligations,
  validateCoverageTreatmentPlan,
  mergeCoverageTreatmentMappings,
};
