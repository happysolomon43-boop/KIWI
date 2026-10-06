'use strict';

const {
  TPF02_MAX_OUTPUT_TOKENS,
  TPF02_TOP_LEVEL_FIELDS,
  buildTpf02AcademicInput,
  validateTpf02Schema,
  validateTpf02Domain,
} = require('./tpf02-direct');
const {
  createOrchestrationPlan,
  executeOrchestrationPlan,
} = require('../orchestrator/composition');

const TPF02_STAGED_PIPELINE_VERSION = 'tpf02-staged-v1';
const TPF02_STAGING_SOURCE_THRESHOLD = 64;
const TPF02_SOURCE_BATCH_SIZE = 24;
const TPF02_BATCH_MAX_OUTPUT_TOKENS = 24_000;
const TPF02_INVENTORY_SCHEMA_ID = 'tpf02.source-inventory-batch';
const TPF02_SYNTHESIS_SCHEMA_ID = 'tpf02.curriculum-audit-synthesis';
const TPF02_SYNTHESIS_FIELDS = Object.freeze(
  TPF02_TOP_LEVEL_FIELDS.filter((field) => field !== 'source_inventory')
);

function invalid(reason) {
  return Object.freeze({ ok: false, reason });
}
function valid(value) {
  return Object.freeze({ ok: true, value });
}
function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function exactFields(value, fields) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function sourceRefSet(sources = []) {
  return new Set((sources || []).map((source) => `source:${String(source?.source_content_item_id || '').trim()}`));
}
function sameSet(left, right) {
  if (left.size !== right.size) return false;
  for (const item of left) if (!right.has(item)) return false;
  return true;
}
function freezeArray(value) {
  return Object.freeze([...(value || [])]);
}

function shouldStageTpf02({ sources = [] } = {}) {
  return Array.isArray(sources) && sources.length > TPF02_STAGING_SOURCE_THRESHOLD;
}

function partitionSources(sources = [], size = TPF02_SOURCE_BATCH_SIZE) {
  if (!Array.isArray(sources) || sources.length === 0) return Object.freeze([]);
  const safeSize = Math.max(1, Math.min(Number(size) || TPF02_SOURCE_BATCH_SIZE, TPF02_SOURCE_BATCH_SIZE));
  const chunks = [];
  for (let index = 0; index < sources.length; index += safeSize) {
    chunks.push(Object.freeze(sources.slice(index, index + safeSize)));
  }
  return Object.freeze(chunks);
}

function inventoryShell(candidate, academicInput) {
  return Object.freeze({
    status: 'ok',
    input_state_reference: candidate.input_state_reference,
    review_required: false,
    review_reasons: Object.freeze([]),
    audit_scope: Object.freeze({
      subject_or_course: academicInput.audit_scope.subject_or_course,
      source_refs: freezeArray(academicInput.audit_scope.source_refs),
      trusted_scope_version: academicInput.audit_scope.trusted_scope_version,
    }),
    source_inventory: freezeArray(candidate.source_inventory),
    topics: Object.freeze([]),
    learning_units: Object.freeze([]),
    assumed_prerequisites: Object.freeze([]),
    source_conflicts: Object.freeze([]),
    coverage_gaps: Object.freeze([]),
    structure_change_proposals: Object.freeze([]),
    unresolved_items: Object.freeze([]),
    student_facing_summary_candidate: null,
  });
}

function inventoryValidators(academicInput) {
  const validationContext = Object.freeze({
    inputStateReference: academicInput.input_state_reference,
    trustedScopeVersion: academicInput.audit_scope.trusted_scope_version,
    sourceItems: academicInput.source_items,
  });
  const expectedRefs = sourceRefSet(
    academicInput.source_items.map((item) => ({ source_content_item_id: String(item.source_item_ref).replace(/^source:/, '') }))
  );

  return Object.freeze({
    schemaValidator: async (candidate) => {
      if (!exactFields(candidate, ['input_state_reference', 'source_inventory'])) {
        return invalid('TPF02_SOURCE_INVENTORY_BATCH_TOP_LEVEL_CONTRACT_MISMATCH');
      }
      const schema = validateTpf02Schema(inventoryShell(candidate, academicInput));
      return schema.ok ? valid(candidate) : schema;
    },
    domainValidator: async (candidate) => {
      const domain = validateTpf02Domain(inventoryShell(candidate, academicInput), validationContext);
      return domain.ok ? valid(candidate) : domain;
    },
    provenanceValidator: async (candidate) => {
      const actual = new Set((candidate?.source_inventory || []).map((item) => String(item.source_item_ref || '')));
      return Object.freeze({
        ok: sameSet(expectedRefs, actual),
        reason: 'TPF02_SOURCE_INVENTORY_BATCH_CENSUS_MISMATCH',
      });
    },
  });
}

function assembleCanonicalAudit(synthesis, sourceInventory) {
  if (!exactFields(synthesis, TPF02_SYNTHESIS_FIELDS)) {
    return invalid('TPF02_SYNTHESIS_TOP_LEVEL_CONTRACT_MISMATCH');
  }
  const assembled = {};
  for (const field of TPF02_TOP_LEVEL_FIELDS) {
    assembled[field] = field === 'source_inventory' ? freezeArray(sourceInventory) : synthesis[field];
  }
  return valid(Object.freeze(assembled));
}

function synthesisValidators({ academicInput, sourceInventory }) {
  const validationContext = Object.freeze({
    inputStateReference: academicInput.input_state_reference,
    trustedScopeVersion: academicInput.audit_scope.trusted_scope_version,
    sourceItems: academicInput.source_items,
  });
  const expectedRefs = new Set(academicInput.source_items.map((item) => item.source_item_ref));

  return Object.freeze({
    schemaValidator: async (candidate) => {
      const assembled = assembleCanonicalAudit(candidate, sourceInventory);
      if (!assembled.ok) return assembled;
      return validateTpf02Schema(assembled.value);
    },
    domainValidator: async (candidate) => validateTpf02Domain(candidate, validationContext),
    provenanceValidator: async (candidate) => {
      const actual = new Set((candidate?.source_inventory || []).map((item) => String(item.source_item_ref || '')));
      return Object.freeze({
        ok: sameSet(expectedRefs, actual),
        reason: 'CURRICULUM_SOURCE_PROVENANCE_INCOMPLETE',
      });
    },
    validationContext,
  });
}

function stageDirective(baseDirective, { stage, batchIndex = null, batchCount = null } = {}) {
  const suffix = batchIndex == null ? stage : `${stage}:${batchIndex + 1}/${batchCount}`;
  return Object.freeze({
    ...baseDirective,
    bounded_actions: Object.freeze([
      ...(baseDirective?.bounded_actions || []),
      `perform TPF-02 staged preparation ${suffix}`,
    ]),
    allowed_operations: Object.freeze([
      ...(baseDirective?.allowed_operations || []),
      stage === 'SOURCE_INVENTORY'
        ? 'return only the requested source-inventory batch artifact'
        : 'return only the requested synthesis fields; the runtime deterministically attaches the validated source inventory',
    ]),
  });
}

function createInventoryBatchRequest({ makeBaseRequest, course, sources, batchIndex, batchCount, correlationId }) {
  const baseInput = buildTpf02AcademicInput({ course, sources });
  const academicInput = Object.freeze({
    ...baseInput,
    task_mode: 'SOURCE_INVENTORY',
    preparation_stage: Object.freeze({
      pipeline_version: TPF02_STAGED_PIPELINE_VERSION,
      stage: 'SOURCE_INVENTORY',
      batch_index: batchIndex,
      batch_count: batchCount,
      whole_artifact_review_pending: true,
    }),
  });
  const validators = inventoryValidators(academicInput);
  const sourceRefs = academicInput.source_items.map((item) => item.source_item_ref);
  const outputSchema = Object.freeze({
    id: TPF02_INVENTORY_SCHEMA_ID,
    version: '1',
    uncertainty_states: Object.freeze(['unresolved']),
    review_needed_field: null,
    declared_fields: Object.freeze(['input_state_reference', 'source_inventory']),
    validate: validators.schemaValidator,
  });
  const request = makeBaseRequest({
    capabilityId: 'teaching.curriculum.source_content_inventory_discovery',
    course,
    taskMode: 'SOURCE_INVENTORY',
    outputSchema,
    contextSpec: {
      authoritative_refs: [{ ref: `course:${course.course_id}` }],
      provenance_refs: sourceRefs.map((ref) => ({ ref })),
      context_kind: 'curriculum_source_inventory_batch',
      access_purpose: 'source_accounting',
    },
    academicInput,
    provenanceRefs: sourceRefs,
  });
  return Object.freeze({
    ...request,
    correlationId,
    directive: stageDirective(request.directive, { stage: 'SOURCE_INVENTORY', batchIndex, batchCount }),
    generation: Object.freeze({
      maxOutputTokens: TPF02_BATCH_MAX_OUTPUT_TOKENS,
      structuredOutput: Object.freeze({ mimeType: 'application/json' }),
    }),
    validationContext: validators.validationContext || {},
    schemaValidator: validators.schemaValidator,
    domainValidator: validators.domainValidator,
    provenanceValidator: validators.provenanceValidator,
  });
}

function createSynthesisRequest({ makeBaseRequest, course, sources, sourceInventory, correlationId }) {
  const baseInput = buildTpf02AcademicInput({ course, sources });
  const academicInput = Object.freeze({
    ...baseInput,
    task_mode: 'DEEP_AUDIT',
    validated_source_inventory: freezeArray(sourceInventory),
    preparation_stage: Object.freeze({
      pipeline_version: TPF02_STAGED_PIPELINE_VERSION,
      stage: 'WHOLE_CURRICULUM_SYNTHESIS',
      source_inventory_validated: true,
      source_inventory_attached_by_runtime: true,
      whole_artifact_review: true,
    }),
  });
  const validators = synthesisValidators({ academicInput, sourceInventory });
  const sourceRefs = academicInput.source_items.map((item) => item.source_item_ref);
  const outputSchema = Object.freeze({
    id: TPF02_SYNTHESIS_SCHEMA_ID,
    version: '1',
    uncertainty_states: Object.freeze([
      'INSUFFICIENT_EVIDENCE',
      'UNRESOLVED_CONFLICT',
      'REVIEW_NEEDED',
      'unresolved',
      'blocked_insufficient_sources',
      'blocked_authority_conflict',
    ]),
    review_needed_field: 'review_required',
    declared_fields: TPF02_SYNTHESIS_FIELDS,
    validate: validators.schemaValidator,
  });
  const request = makeBaseRequest({
    capabilityId: 'teaching.curriculum.deep_curriculum_audit',
    course,
    taskMode: 'DEEP_AUDIT',
    outputSchema,
    contextSpec: {
      authoritative_refs: [{ ref: `course:${course.course_id}` }],
      provenance_refs: sourceRefs.map((ref) => ({ ref })),
      context_kind: 'curriculum_audit_staged_synthesis',
      access_purpose: 'whole_curriculum_synthesis',
    },
    academicInput,
    provenanceRefs: sourceRefs,
  });
  return Object.freeze({
    ...request,
    correlationId,
    directive: stageDirective(request.directive, { stage: 'WHOLE_CURRICULUM_SYNTHESIS' }),
    generation: Object.freeze({
      maxOutputTokens: TPF02_MAX_OUTPUT_TOKENS,
      structuredOutput: Object.freeze({ mimeType: 'application/json' }),
    }),
    validationContext: validators.validationContext,
    schemaValidator: validators.schemaValidator,
    domainValidator: validators.domainValidator,
    provenanceValidator: validators.provenanceValidator,
  });
}

function pipelineCorrelationId(course, sources) {
  const refs = (sources || []).map((source) => String(source?.source_content_item_id || '')).filter(Boolean);
  return `tpf02:${String(course?.course_id || 'course')}:${String(course?.state_version || 'state')}:${refs.length}`;
}

function createStagedCurriculumAuditRunner({ orchestrator, makeBaseRequest } = {}) {
  if (!orchestrator || typeof orchestrator.execute !== 'function') {
    throw new TypeError('Staged TPF-02 execution requires the Teaching Orchestrator.');
  }
  if (typeof makeBaseRequest !== 'function') {
    throw new TypeError('Staged TPF-02 execution requires the D07 base request builder.');
  }

  async function run({ course, sources = [] } = {}) {
    const batches = partitionSources(sources);
    if (batches.length < 2) {
      throw new TypeError('Staged TPF-02 execution requires more than one source batch.');
    }
    const correlationId = pipelineCorrelationId(course, sources);
    const batchIds = batches.map((_, index) => `source-inventory-${String(index + 1).padStart(3, '0')}`);
    const plan = createOrchestrationPlan([
      ...batchIds.map((id, index) => Object.freeze({ id, kind: 'SOURCE_INVENTORY', batchIndex: index, depends_on: [] })),
      Object.freeze({ id: 'whole-curriculum-synthesis', kind: 'SYNTHESIS', depends_on: batchIds }),
    ]);

    const results = await executeOrchestrationPlan(plan, async (step, dependencies) => {
      if (step.kind === 'SOURCE_INVENTORY') {
        return orchestrator.execute(createInventoryBatchRequest({
          makeBaseRequest,
          course,
          sources: batches[step.batchIndex],
          batchIndex: step.batchIndex,
          batchCount: batches.length,
          correlationId,
        }));
      }

      const ordered = batchIds.map((id) => dependencies[id]);
      const rejected = ordered.find((result) => !result?.accepted || !result?.validatedResult?.output);
      if (rejected) return rejected;
      const sourceInventory = Object.freeze(
        ordered.flatMap((result) => result.validatedResult.output.source_inventory || [])
      );
      if (sourceInventory.length !== sources.length) {
        return Object.freeze({
          accepted: false,
          rejectionReason: 'TPF02_STAGED_SOURCE_INVENTORY_CENSUS_MISMATCH',
          validationStage: 'deterministic_authority',
        });
      }
      return orchestrator.execute(createSynthesisRequest({
        makeBaseRequest,
        course,
        sources,
        sourceInventory,
        correlationId,
      }));
    });

    const result = results['whole-curriculum-synthesis'];
    return Object.freeze({
      ...result,
      analysisPipelineVersion: TPF02_STAGED_PIPELINE_VERSION,
      staged: true,
      stageCount: batches.length + 1,
    });
  }

  return Object.freeze({ run, shouldStage: shouldStageTpf02 });
}

module.exports = {
  TPF02_STAGED_PIPELINE_VERSION,
  TPF02_STAGING_SOURCE_THRESHOLD,
  TPF02_SOURCE_BATCH_SIZE,
  TPF02_BATCH_MAX_OUTPUT_TOKENS,
  TPF02_INVENTORY_SCHEMA_ID,
  TPF02_SYNTHESIS_SCHEMA_ID,
  TPF02_SYNTHESIS_FIELDS,
  shouldStageTpf02,
  partitionSources,
  inventoryValidators,
  assembleCanonicalAudit,
  synthesisValidators,
  createInventoryBatchRequest,
  createSynthesisRequest,
  createStagedCurriculumAuditRunner,
};
