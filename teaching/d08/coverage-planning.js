'use strict';

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

function requiredMeaningfulSources(sources = []) {
  return sources.filter((source) => (
    source?.classification === 'ACADEMICALLY_MEANINGFUL'
    && source?.academically_meaningful !== false
    && String(source?.source_ref || '').trim()
  ));
}

function academicMeaningBySource(auditOutput = {}, sources = []) {
  const aliases = sourceAliasIndex(sources);
  const meanings = new Map();
  for (const item of auditOutput.source_inventory || []) {
    const canonical = aliases.get(String(item?.source_item_ref || '').trim());
    if (!canonical) continue;
    const meaning = String(item?.academic_meaning || '').trim();
    if (meaning) meanings.set(canonical, meaning);
  }
  return meanings;
}

function buildCoverageObligations({ auditOutput = {}, sources = [], sourceUnitGraph = new Map() } = {}) {
  const meanings = academicMeaningBySource(auditOutput, sources);
  return requiredMeaningfulSources(sources).map((source) => {
    const sourceRef = String(source.source_ref);
    const existingRefs = Array.from(sourceUnitGraph.get(sourceRef) || [], String);
    return Object.freeze({
      source_ref: sourceRef,
      academic_summary: meanings.get(sourceRef) || String(source.content_summary || source.classification_reason || '').trim() || null,
      existing_learning_unit_refs: Object.freeze([...new Set(existingRefs)]),
      requires_planner_mapping: existingRefs.length === 0,
    });
  });
}

function validateCoverageTreatmentPlan(output, { auditOutput = {}, sources = [], sourceUnitGraph = new Map() } = {}) {
  const map = Array.isArray(output?.coverage_treatment_map) ? output.coverage_treatment_map : [];
  const aliases = sourceAliasIndex(sources);
  const knownUnits = new Set((auditOutput.learning_units || [])
    .map((unit) => String(unit?.learning_unit_id || unit?.id || '').trim())
    .filter(Boolean));
  const requiredSources = requiredMeaningfulSources(sources).map((source) => String(source.source_ref));
  const missingBeforePlanning = new Set(requiredSources.filter((sourceRef) => !(sourceUnitGraph.get(sourceRef) || []).length));
  const plannedBySource = new Map();

  for (const item of map) {
    const rawRef = String(item?.required_source_or_unit_ref || '').trim();
    if (!rawRef) continue;
    const sourceRef = aliases.get(rawRef) || null;
    if (!sourceRef) {
      // TPF-03 also allows Learning Unit-level treatment rows. They do not establish source coverage.
      if (knownUnits.has(rawRef)) continue;
      return invalid(`TPF-03 coverage treatment references unknown material or Learning Unit ${rawRef}.`, 'TEACHING_D08_TPF03_COVERAGE_REFERENCE_INVALID');
    }
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
      `TPF-03 did not fully connect ${unresolved.length} required material item${unresolved.length === 1 ? '' : 's'} to known Learning Units (${preview}${suffix}).`,
      'TEACHING_D08_REQUIRED_SOURCE_UNMAPPED'
    );
  }

  return { ok: true, plannedBySource, missingBeforePlanning };
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
  };
}

module.exports = {
  sourceAliasIndex,
  requiredMeaningfulSources,
  buildCoverageObligations,
  validateCoverageTreatmentPlan,
  mergeCoverageTreatmentMappings,
};
