'use strict';

// Provider-facing structured-output schemas for TPF-02. These mirror the
// canonical runtime validators in tpf02-direct.js, but remain neutral KIWI
// generation controls. Deterministic validation is still the source of truth.

const STRING = Object.freeze({ type: 'string' });
const NULLABLE_STRING = Object.freeze({ type: 'string', nullable: true });
const BOOLEAN = Object.freeze({ type: 'boolean' });
const STRING_ARRAY = Object.freeze({ type: 'array', items: STRING });

const SOURCE_WALK_ITEM_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    source_item_ref: STRING,
    analysis_status: Object.freeze({ type: 'string', enum: Object.freeze(['complete','partial','unreadable']) }),
    note: NULLABLE_STRING,
  }),
  required: Object.freeze(['source_item_ref','analysis_status','note']),
  propertyOrdering: Object.freeze(['source_item_ref','analysis_status','note']),
});

const AUDIT_SCOPE_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    subject_or_course: STRING,
    trusted_scope_version: STRING,
    source_refs: STRING_ARRAY,
    source_walk: Object.freeze({ type: 'array', items: SOURCE_WALK_ITEM_SCHEMA }),
  }),
  required: Object.freeze(['subject_or_course','trusted_scope_version','source_refs','source_walk']),
  propertyOrdering: Object.freeze(['subject_or_course','trusted_scope_version','source_refs','source_walk']),
});

const SOURCE_INVENTORY_ITEM_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    source_item_ref: STRING,
    provenance: STRING,
    academic_meaning: STRING,
    proposed_scope_classification: Object.freeze({
      type: 'string',
      enum: Object.freeze(['required','supplementary','duplicate','non_instructional','outside_approved_scope','unresolved']),
    }),
    scope_classification_basis: STRING,
    duplicate_of_ref: NULLABLE_STRING,
    content_validity_status: Object.freeze({
      type: 'string',
      enum: Object.freeze(['current_supported','outdated_or_inaccurate','disputed','historical_or_contextual','not_applicable','unresolved']),
    }),
    content_validity_basis: NULLABLE_STRING,
    confidence: Object.freeze({ type: 'string', enum: Object.freeze(['high','medium','low']) }),
  }),
  required: Object.freeze([
    'source_item_ref','provenance','academic_meaning','proposed_scope_classification',
    'scope_classification_basis','duplicate_of_ref','content_validity_status',
    'content_validity_basis','confidence',
  ]),
  propertyOrdering: Object.freeze([
    'source_item_ref','provenance','academic_meaning','proposed_scope_classification',
    'scope_classification_basis','duplicate_of_ref','content_validity_status',
    'content_validity_basis','confidence',
  ]),
});

const SUBTOPIC_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    subtopic_id: STRING,
    title: STRING,
  }),
  required: Object.freeze(['subtopic_id','title']),
  propertyOrdering: Object.freeze(['subtopic_id','title']),
});

const TOPIC_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    topic_id: STRING,
    title: STRING,
    source_item_refs: STRING_ARRAY,
    subtopics: Object.freeze({ type: 'array', items: SUBTOPIC_SCHEMA }),
  }),
  required: Object.freeze(['topic_id','title','source_item_refs','subtopics']),
  propertyOrdering: Object.freeze(['topic_id','title','source_item_refs','subtopics']),
});

const LEARNING_UNIT_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    learning_unit_id: STRING,
    title: STRING,
    intended_competence: STRING,
    source_item_refs: STRING_ARRAY,
    topic_refs: STRING_ARRAY,
    subtopic_id: NULLABLE_STRING,
    prerequisite_refs: STRING_ARRAY,
    dependency_type_notes: NULLABLE_STRING,
    criticality: Object.freeze({ type: 'string', enum: Object.freeze(['foundational','major','supporting','enrichment','unresolved']) }),
    criticality_basis: STRING,
    proposed_exit_evidence: STRING,
    gap_refs: STRING_ARRAY,
    uncertainties: STRING_ARRAY,
  }),
  required: Object.freeze([
    'learning_unit_id','title','intended_competence','source_item_refs','topic_refs',
    'subtopic_id','prerequisite_refs','dependency_type_notes','criticality',
    'criticality_basis','proposed_exit_evidence','gap_refs','uncertainties',
  ]),
  propertyOrdering: Object.freeze([
    'learning_unit_id','title','intended_competence','source_item_refs','topic_refs',
    'subtopic_id','prerequisite_refs','dependency_type_notes','criticality',
    'criticality_basis','proposed_exit_evidence','gap_refs','uncertainties',
  ]),
});

const ASSUMED_PREREQUISITE_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    assumed_prerequisite_id: STRING,
    capability: STRING,
    why_required: STRING,
    source_or_academic_basis: STRING,
    inside_course_scope: BOOLEAN,
  }),
  required: Object.freeze([
    'assumed_prerequisite_id','capability','why_required','source_or_academic_basis','inside_course_scope',
  ]),
  propertyOrdering: Object.freeze([
    'assumed_prerequisite_id','capability','why_required','source_or_academic_basis','inside_course_scope',
  ]),
});

const SOURCE_CONFLICT_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    conflict_id: STRING,
    conflict: STRING,
    conflict_type: Object.freeze({ type: 'string', enum: Object.freeze(['scope_authority','factual_content','terminology','sequencing','other']) }),
    source_item_refs: STRING_ARRAY,
    authority_context: STRING,
    resolution_status: Object.freeze({ type: 'string', enum: Object.freeze(['resolved_by_authoritative_rule','proposed_resolution','unresolved']) }),
    resolution_or_required_review: STRING,
    blocking: BOOLEAN,
  }),
  required: Object.freeze([
    'conflict_id','conflict','conflict_type','source_item_refs','authority_context',
    'resolution_status','resolution_or_required_review','blocking',
  ]),
  propertyOrdering: Object.freeze([
    'conflict_id','conflict','conflict_type','source_item_refs','authority_context',
    'resolution_status','resolution_or_required_review','blocking',
  ]),
});

const COVERAGE_GAP_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    gap_id: STRING,
    required_area: STRING,
    source_item_refs: STRING_ARRAY,
    why_gap_matters: STRING,
    available_support: STRING,
    supplementation_needed: STRING,
    blocking: BOOLEAN,
  }),
  required: Object.freeze([
    'gap_id','required_area','source_item_refs','why_gap_matters','available_support',
    'supplementation_needed','blocking',
  ]),
  propertyOrdering: Object.freeze([
    'gap_id','required_area','source_item_refs','why_gap_matters','available_support',
    'supplementation_needed','blocking',
  ]),
});

const STRUCTURE_CHANGE_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    type: Object.freeze({ type: 'string', enum: Object.freeze(['split','merge','compress']) }),
    affected_unit_refs: STRING_ARRAY,
    resulting_unit_refs: STRING_ARRAY,
    source_item_refs_before: STRING_ARRAY,
    source_item_refs_after: STRING_ARRAY,
    proposal: STRING,
    reason: STRING,
  }),
  required: Object.freeze([
    'type','affected_unit_refs','resulting_unit_refs','source_item_refs_before',
    'source_item_refs_after','proposal','reason',
  ]),
  propertyOrdering: Object.freeze([
    'type','affected_unit_refs','resulting_unit_refs','source_item_refs_before',
    'source_item_refs_after','proposal','reason',
  ]),
});

const RECONCILIATION_ROW_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    source_item_ref: STRING,
    learning_unit_refs: STRING_ARRAY,
  }),
  required: Object.freeze(['source_item_ref','learning_unit_refs']),
  propertyOrdering: Object.freeze(['source_item_ref','learning_unit_refs']),
});

const RECONCILIATION_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    required_item_map: Object.freeze({ type: 'array', items: RECONCILIATION_ROW_SCHEMA }),
    unmapped_required_refs: STRING_ARRAY,
  }),
  required: Object.freeze(['required_item_map','unmapped_required_refs']),
  propertyOrdering: Object.freeze(['required_item_map','unmapped_required_refs']),
});

const UNRESOLVED_ITEM_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    unresolved_id: STRING,
    issue: STRING,
    source_item_refs: STRING_ARRAY,
    why_unresolved: STRING,
    required_next_input_or_review: STRING,
    blocks_responsible_planning: BOOLEAN,
  }),
  required: Object.freeze([
    'unresolved_id','issue','source_item_refs','why_unresolved',
    'required_next_input_or_review','blocks_responsible_planning',
  ]),
  propertyOrdering: Object.freeze([
    'unresolved_id','issue','source_item_refs','why_unresolved',
    'required_next_input_or_review','blocks_responsible_planning',
  ]),
});

const TPF02_CURRICULUM_AUDIT_RESPONSE_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    input_state_reference: STRING,
    task_mode: STRING,
    execution_stage: Object.freeze({
      type: 'string',
      enum: Object.freeze(['SINGLE_PASS','SOURCE_INVENTORY_STAGE','WHOLE_CURRICULUM_SYNTHESIS_STAGE']),
    }),
    audit_scope: AUDIT_SCOPE_SCHEMA,
    source_inventory: Object.freeze({ type: 'array', items: SOURCE_INVENTORY_ITEM_SCHEMA }),
    topics: Object.freeze({ type: 'array', items: TOPIC_SCHEMA }),
    learning_units: Object.freeze({ type: 'array', items: LEARNING_UNIT_SCHEMA }),
    assumed_prerequisites: Object.freeze({ type: 'array', items: ASSUMED_PREREQUISITE_SCHEMA }),
    source_conflicts: Object.freeze({ type: 'array', items: SOURCE_CONFLICT_SCHEMA }),
    coverage_gaps: Object.freeze({ type: 'array', items: COVERAGE_GAP_SCHEMA }),
    structure_change_proposals: Object.freeze({ type: 'array', items: STRUCTURE_CHANGE_SCHEMA }),
    source_to_unit_reconciliation: RECONCILIATION_SCHEMA,
    unresolved_items: Object.freeze({ type: 'array', items: UNRESOLVED_ITEM_SCHEMA }),
    status: Object.freeze({
      type: 'string',
      enum: Object.freeze(['ok','unresolved','blocked_insufficient_sources','blocked_authority_conflict']),
    }),
    review_required: BOOLEAN,
    review_reasons: STRING_ARRAY,
    student_facing_summary_candidate: NULLABLE_STRING,
  }),
  required: Object.freeze([
    'input_state_reference','task_mode','execution_stage','audit_scope','source_inventory',
    'topics','learning_units','assumed_prerequisites','source_conflicts','coverage_gaps',
    'structure_change_proposals','source_to_unit_reconciliation','unresolved_items','status',
    'review_required','review_reasons','student_facing_summary_candidate',
  ]),
  propertyOrdering: Object.freeze([
    'input_state_reference','task_mode','execution_stage','audit_scope','source_inventory',
    'topics','learning_units','assumed_prerequisites','source_conflicts','coverage_gaps',
    'structure_change_proposals','source_to_unit_reconciliation','unresolved_items','status',
    'review_required','review_reasons','student_facing_summary_candidate',
  ]),
});

const DECOMPOSITION_PATCH_UNIT_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    learning_unit_id: STRING,
    title: STRING,
    intended_competence: STRING,
    source_item_refs: STRING_ARRAY,
    prerequisite_refs: STRING_ARRAY,
    dependency_type_notes: NULLABLE_STRING,
    criticality: Object.freeze({ type: 'string', enum: Object.freeze(['foundational','major','supporting','enrichment','unresolved']) }),
    criticality_basis: STRING,
    proposed_exit_evidence: STRING,
    uncertainties: STRING_ARRAY,
  }),
  required: Object.freeze([
    'learning_unit_id','title','intended_competence','source_item_refs','prerequisite_refs',
    'dependency_type_notes','criticality','criticality_basis','proposed_exit_evidence','uncertainties',
  ]),
  propertyOrdering: Object.freeze([
    'learning_unit_id','title','intended_competence','source_item_refs','prerequisite_refs',
    'dependency_type_notes','criticality','criticality_basis','proposed_exit_evidence','uncertainties',
  ]),
});

const TPF02_DECOMPOSITION_PATCH_RESPONSE_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    input_state_reference: STRING,
    task_mode: Object.freeze({ type: 'string', enum: Object.freeze(['SPLIT_UNIT']) }),
    execution_stage: Object.freeze({ type: 'string', enum: Object.freeze(['SINGLE_PASS']) }),
    target_unit_id: STRING,
    decision: Object.freeze({ type: 'string', enum: Object.freeze(['split','keep','unresolved']) }),
    resulting_units: Object.freeze({ type: 'array', items: DECOMPOSITION_PATCH_UNIT_SCHEMA }),
    split_reason: NULLABLE_STRING,
    unit_justification: NULLABLE_STRING,
    course_ratio_justification: NULLABLE_STRING,
    unresolved_reason: NULLABLE_STRING,
    required_next_input_or_review: NULLABLE_STRING,
    review_required: BOOLEAN,
  }),
  required: Object.freeze([
    'input_state_reference','task_mode','execution_stage','target_unit_id','decision',
    'resulting_units','split_reason','unit_justification','course_ratio_justification',
    'unresolved_reason','required_next_input_or_review','review_required',
  ]),
  propertyOrdering: Object.freeze([
    'input_state_reference','task_mode','execution_stage','target_unit_id','decision',
    'resulting_units','split_reason','unit_justification','course_ratio_justification',
    'unresolved_reason','required_next_input_or_review','review_required',
  ]),
});

module.exports = {
  TPF02_CURRICULUM_AUDIT_RESPONSE_SCHEMA,
  TPF02_DECOMPOSITION_PATCH_RESPONSE_SCHEMA,
};
