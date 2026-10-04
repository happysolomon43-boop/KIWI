'use strict';

const {
  sanitizeAcademicInput,
  validatePassAControls,
  validatePassBControls,
} = require('../d20/intelligence');

const TPF16_PASS_A_CONTROLS = Object.freeze({
  artifact_controls:Object.freeze({
    original_credit_seen:false,
    overall_result_seen:false,
    raw_appeal_text_seen:false,
    review_direction_policy_seen:false,
    downstream_consequence_seen:false,
    freeze_before_comparison_required:true,
  }),
  criterion_independent_judgments:Object.freeze([]),
});

const TPF16_PASS_B_CONTROLS = Object.freeze({
  blind_first:Object.freeze({
    attempted:true,
    achieved:true,
    pass_a_frozen_before_comparison:true,
    independent_pass_a_ref:'d30-pass-a-fixture',
  }),
  review_outcome:Object.freeze({
    official_mark_not_committed:true,
    deterministic_reaggregation_required_if_changed:true,
    gradebook_commit_external:true,
    audit_history_preserve_original:true,
  }),
});

function buildTpf16StructuralFixture() {
  return Object.freeze({
    academicInput:Object.freeze({
      assessment_response:Object.freeze({ response_ref:'d30-response', final:true }),
      rubric_contract:Object.freeze({ rubric_ref:'d30-rubric', immutable:true }),
      marking_context:Object.freeze({ criterion_refs:Object.freeze([]) }),
      pass_a_controls:TPF16_PASS_A_CONTROLS,
      pass_b_controls:TPF16_PASS_B_CONTROLS,
    }),
  });
}

function verifyTpf16BlindFirstStructuralEvidence(fixture = buildTpf16StructuralFixture()) {
  const academicInput = fixture.academicInput || {};
  sanitizeAcademicInput(academicInput, 'independent_pass_a');
  validatePassAControls(academicInput.pass_a_controls);
  validatePassBControls(academicInput.pass_b_controls);
  return Object.freeze({
    independentReviewIsolation:true,
    authority:true,
    provenance:true,
    owner:'teaching/d20/intelligence.js',
    proof:'Pass A prohibited-context sanitization + Pass A controls + Pass B blind-first freeze/handback controls validated',
  });
}

function createCanonicalStructuralEvidenceProvider() {
  return async function invariantEvidenceProvider({ caseSpec } = {}) {
    const evidence = {
      authority:true,
    };
    if (caseSpec?.familyId === 'TPF-16') {
      Object.assign(evidence, verifyTpf16BlindFirstStructuralEvidence());
    }
    return Object.freeze(evidence);
  };
}

module.exports = {
  TPF16_PASS_A_CONTROLS,
  TPF16_PASS_B_CONTROLS,
  buildTpf16StructuralFixture,
  verifyTpf16BlindFirstStructuralEvidence,
  createCanonicalStructuralEvidenceProvider,
};