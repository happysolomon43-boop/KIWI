'use strict';

const { D30_TASK_IDS } = require('./contracts');

const TASK_ACCOUNTING = Object.freeze({
  'TCH-0819': Object.freeze({ area:'evaluation_harness', anchors:['runner.js','validators.js','qualification.js','repository.js'] }),
  'TCH-0820': Object.freeze({ area:'golden_cases', anchors:['corpus.js','family-matrix.js'] }),
  'TCH-0821': Object.freeze({ area:'negative_counterexamples', anchors:['corpus.js','family-matrix.js','validators.js'] }),
  'TCH-0822': Object.freeze({ area:'counterfactual_invariance', anchors:['corpus.js','validators.js'] }),
  'TCH-0823': Object.freeze({ area:'cross_subject_coverage', anchors:['family-matrix.js','corpus.js'] }),
  'TCH-0824': Object.freeze({ area:'uncertainty_calibration', anchors:['corpus.js','validators.js','semantic-reviewer.js'] }),
  'TCH-0825': Object.freeze({ area:'prompt_content_injection', anchors:['corpus.js','runner.js','validators.js'] }),
  'TCH-0826': Object.freeze({ area:'authority_attacks', anchors:['corpus.js','runner.js','validators.js'] }),
  'TCH-0827': Object.freeze({ area:'independent_high_stakes_review', anchors:['human-review.js','validators.js','tests/teaching/unit/d30-canonical-qualification.test.js'] }),
  'TCH-0828': Object.freeze({ area:'immutable_regression_gate', anchors:['qualification-plan.js','qualification.js','repository.js'] }),
  'TCH-0829': Object.freeze({ area:'versioned_provenance', anchors:['contracts.js','qualification.js','repository.js'] }),
  'TCH-0830': Object.freeze({ area:'defect_severity_and_triage', anchors:['validators.js','qualification.js','repository.js'] }),
  'TCH-0831': Object.freeze({ area:'stochastic_stability', anchors:['qualification.js','qualification-plan.js'] }),
  'TCH-0832': Object.freeze({ area:'cross_family_workflows', anchors:['family-matrix.js','corpus.js','runner.js'] }),
  'TCH-0834': Object.freeze({ area:'prompt_behavior_briefs', anchors:['governance.js','maintenance-context.js'] }),
  'TCH-0835': Object.freeze({ area:'prompt_authoring_lifecycle', anchors:['governance.js'] }),
  'TCH-0836': Object.freeze({ area:'prompt_static_audit', anchors:['governance.js'] }),
  'TCH-0837': Object.freeze({ area:'prompt_failure_taxonomy', anchors:['governance.js'] }),
  'TCH-0838': Object.freeze({ area:'constitution_capability_context', anchors:['maintenance-context.js','governance.js'] }),
  'TCH-0839': Object.freeze({ area:'prompt_boundary_separation', anchors:['governance.js','maintenance-context.js'] }),
  'TCH-0840': Object.freeze({ area:'course_foundation_authoring_wave', anchors:['governance.js','maintenance-context.js'] }),
  'TCH-0841': Object.freeze({ area:'learning_engine_authoring_wave', anchors:['governance.js','maintenance-context.js'] }),
  'TCH-0842': Object.freeze({ area:'assessment_integrity_authoring_wave', anchors:['governance.js','maintenance-context.js'] }),
  'TCH-0843': Object.freeze({ area:'outcomes_translation_authoring_wave', anchors:['governance.js','maintenance-context.js'] }),
  'TCH-0844': Object.freeze({ area:'dependency_order', anchors:['maintenance-context.js'] }),
  'TCH-0845': Object.freeze({ area:'authoring_stop_conditions', anchors:['governance.js'] }),
  'TCH-0846': Object.freeze({ area:'evaluation_before_freeze', anchors:['governance.js','qualification.js'] }),
  'TCH-0847': Object.freeze({ area:'frozen_identity_trace', anchors:['contracts.js','governance.js','maintenance-context.js'] }),
  'TCH-0848': Object.freeze({ area:'model_provenance_trace', anchors:['qualification.js','repository.js'] }),
  'TCH-0849': Object.freeze({ area:'prompt_change_control_hold', anchors:['governance.js'] }),
  'TCH-0850': Object.freeze({ area:'no_hidden_chain_of_thought', anchors:['contracts.js','evidence.js','semantic-reviewer.js'] }),
  'TCH-0851': Object.freeze({ area:'structured_evidence_only', anchors:['evidence.js','semantic-reviewer.js','repository.js'] }),
  'TCH-0852': Object.freeze({ area:'prompt_approval_gate', anchors:['governance.js'] }),
  'TCH-0853': Object.freeze({ area:'high_stakes_independence', anchors:['human-review.js','validators.js'] }),
  'TCH-0854': Object.freeze({ area:'prompt_regression_replay', anchors:['qualification-plan.js','qualification.js'] }),
  'TCH-0855': Object.freeze({ area:'prompt_governance_traceability', anchors:['governance.js','repository.js'] }),
  'TCH-0857': Object.freeze({ area:'canonical_cross_family_contracts', anchors:['family-matrix.js','corpus.js','runner.js'] }),
  'TCH-0860': Object.freeze({ area:'full_phase16_corpus', anchors:['corpus.js','family-matrix.js'] }),
  'TCH-0861': Object.freeze({ area:'validators_rubrics_runners_storage', anchors:['validators.js','runner.js','semantic-reviewer.js','repository.js'] }),
  'TCH-0862': Object.freeze({ area:'primary_route_qualification', anchors:['route-policy.js','qualification-plan.js','runner.js','qualification.js'] }),
  'TCH-0863': Object.freeze({ area:'fallback_route_qualification', anchors:['route-policy.js','qualification-plan.js','qualification.js'] }),
  'TCH-0864': Object.freeze({ area:'orchestrator_fallback_verification', anchors:['runner.js','route-policy.js'] }),
  'TCH-0865': Object.freeze({ area:'stability_defect_closure_regression', anchors:['qualification.js','qualification-plan.js','repository.js'] }),
  'TCH-0866': Object.freeze({ area:'route_production_qualification_report', anchors:['qualification.js','repository.js'] }),
  'TCH-0902': Object.freeze({ area:'ppl_empirical_comparison', anchors:['qualification.js','repository.js','corpus.js'] }),
  'TCH-0920': Object.freeze({ area:'tpf20_empirical_qualification', anchors:['corpus.js','runner.js','qualification-plan.js','qualification.js'] }),
});

function assertTaskAccountingComplete() {
  const expected = [...D30_TASK_IDS].sort();
  const actual = Object.keys(TASK_ACCOUNTING).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    const missing = expected.filter((id) => !actual.includes(id));
    const extra = actual.filter((id) => !expected.includes(id));
    throw new Error(`D30 task accounting drift. Missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}`);
  }
  for (const [id, entry] of Object.entries(TASK_ACCOUNTING)) {
    if (!entry.area || !Array.isArray(entry.anchors) || entry.anchors.length === 0) throw new Error(`D30 task accounting is incomplete for ${id}.`);
  }
  return true;
}

assertTaskAccountingComplete();

module.exports = { TASK_ACCOUNTING, assertTaskAccountingComplete };