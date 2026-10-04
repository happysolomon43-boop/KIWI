'use strict';

const { createTeachingPromptControlPlane } = require('../prompt-runtime');
const { listCapabilities, getCapability } = require('../capability-registry');
const { integrityReview } = require('../d16/contracts');
const { validateTpf15Controls, validatePassAControls, validatePassBControls } = require('../d20/intelligence');
const {
  TPF08,
  STYLE_FIELDS,
  SAFE_PROFILE_LIBRARY,
  buildStyleEnvelope,
  validateStyleEnvelope,
} = require('../d22/contracts');
const { CROSS_FAMILY_WORKFLOWS } = require('./family-matrix');

const DETERMINISTIC_BOUNDARIES = Object.freeze({
  AUTHORITATIVE_PACKAGE_LOCK: 'teaching.assessment.assessment_package_locking',
  GRADEBOOK_OWNER: 'teaching.progression.gradebook_calculation',
});

const WORKFLOW_IDS = Object.freeze({
  TEACHING_EVIDENCE: 'TEACHING_EVIDENCE_CHAIN',
  ASSESSMENT_CONSTRUCTION: 'ASSESSMENT_CONSTRUCTION_CHAIN',
  MARKING_REVIEW: 'MARKING_REVIEW_CHAIN',
  INTEGRITY_HANDOFF: 'INTEGRITY_HANDOFF',
  TEACHER_STYLE: 'TEACHER_STYLE_CHAIN',
});

function invariant(condition, message, code = 'TEACHING_D30_CROSS_FAMILY_INCOMPATIBLE') {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
}

function familyCapabilities(familyId) {
  return listCapabilities().filter((capability) => capability.prompt_family_id === familyId);
}

function verifyFamilyNode(promptControl, familyId) {
  const family = promptControl.listPromptFamilies().find((entry) => entry.id === familyId);
  invariant(Boolean(family), `Cross-family node is not registered: ${familyId}`);
  const frozen = promptControl.createFrozenPromptBinding(familyId, family.version);
  const capabilities = familyCapabilities(familyId);
  invariant(capabilities.length > 0, `Cross-family node has no capability bindings: ${familyId}`);
  for (const capability of capabilities) {
    invariant(capability.authority_ceiling !== 'T0', `${familyId} model family unexpectedly contains T0 capability ${capability.id}`);
    const contract = promptControl.getCapabilityContract(capability.id);
    invariant(contract.promptFamily?.id === familyId, `${capability.id} contract family drift`);
    invariant(contract.authoritativeOwnerBoundary === capability.authoritative_owner_boundary, `${capability.id} owner-boundary drift`);
    invariant(contract.outputContract?.hiddenChainOfThoughtAllowed === false, `${capability.id} hidden reasoning boundary drift`);
  }
  return Object.freeze({
    familyId,
    familyVersion:family.version,
    promptSha256:frozen.promptSourceSha256,
    capabilityCount:capabilities.length,
    authorityCeilings:Object.freeze([...new Set(capabilities.map((capability) => capability.authority_ceiling))]),
    ownerBoundaries:Object.freeze([...new Set(capabilities.map((capability) => capability.authoritative_owner_boundary))]),
  });
}

function verifyDeterministicBoundary(capabilityId, expectedOwnerFragment) {
  const capability = getCapability(capabilityId);
  invariant(capability.authority_ceiling === 'T0', `${capabilityId} must remain T0`);
  invariant(capability.prompt_family_id == null, `${capabilityId} must remain promptless`);
  invariant(capability.execution_class === 'DETERMINISTIC', `${capabilityId} must remain deterministic`);
  invariant(String(capability.authoritative_owner_boundary).includes(expectedOwnerFragment), `${capabilityId} owner boundary drift`);
  return Object.freeze({
    capabilityId:capability.id,
    authorityCeiling:capability.authority_ceiling,
    promptFamily:capability.prompt_family_id,
    ownerBoundary:capability.authoritative_owner_boundary,
  });
}

function verifyMarkingReviewBoundary() {
  const marking = validateTpf15Controls({
    aggregation_handoff:{
      deterministic_aggregation_required:true,
      official_total_not_committed:true,
      rounding_external:true,
      gradebook_commit_external:true,
    },
  });
  invariant(marking === null, 'TPF-15 deterministic aggregation handoff failed');
  const passA = validatePassAControls({
    artifact_controls:{
      original_credit_seen:false,
      overall_result_seen:false,
      raw_appeal_text_seen:false,
      review_direction_policy_seen:false,
      downstream_consequence_seen:false,
      freeze_before_comparison_required:true,
    },
    criterion_independent_judgments:[],
  });
  invariant(passA === null, 'TPF-16 independent Pass A control failed');
  const passB = validatePassBControls({
    blind_first:{
      attempted:true,
      achieved:true,
      pass_a_frozen_before_comparison:true,
      independent_pass_a_ref:'d30-cross-family-pass-a',
    },
    review_outcome:{
      official_mark_not_committed:true,
      deterministic_reaggregation_required_if_changed:true,
      gradebook_commit_external:true,
      audit_history_preserve_original:true,
    },
  });
  invariant(passB === null, 'TPF-16 comparison Pass B control failed');
  return Object.freeze({ deterministicAggregation:true, blindPassA:true, comparisonPassB:true });
}

function verifyIntegrityHandoff() {
  const review = integrityReview({
    policyVersion:'d30-cross-family-contract-check',
    signals:[{type:'STYLE_ANOMALY',source:'D30_FIXTURE',value:'bounded'}],
    ruleAlignment:'ALIGNED',
    capabilityEvidence:'UNRESOLVED',
    activeFormalAssessment:true,
  });
  invariant(review.misconductVerdict === null, 'TPF-11 integrity handoff fabricated misconduct verdict');
  invariant(review.guiltProbability === null, 'TPF-11 integrity handoff fabricated guilt probability');
  invariant(review.midAttemptVerificationAllowed === false, 'TPF-11 integrity handoff bypassed active assessment isolation');
  return Object.freeze({
    misconductVerdictOwned:false,
    guiltProbabilityOwned:false,
    midAttemptVerificationAllowed:review.midAttemptVerificationAllowed,
    policyVersion:review.policyVersion,
  });
}

function verifyTeacherStyleEnvelope() {
  const envelope = buildStyleEnvelope({
    teacherIdentityRef:'d30-teacher-style-contract',
    coreTraits:SAFE_PROFILE_LIBRARY.BALANCED,
    familiarityLevel:'established',
  });
  const validated = validateStyleEnvelope(envelope);
  invariant(JSON.stringify(Object.keys(validated)) === JSON.stringify(STYLE_FIELDS), 'TPF-18 → TPF-08 exact style-envelope field order/set drift');
  invariant(TPF08.styleEnvelopeVersion === 'tpf08.teacher-style-envelope.v1', 'TPF-08 style envelope version drift');
  return Object.freeze({ version:TPF08.styleEnvelopeVersion, fields:Object.freeze([...STYLE_FIELDS]) });
}

function createCrossFamilyWorkflowExecutor({ promptControl = createTeachingPromptControlPlane() } = {}) {
  promptControl.assertReady();
  const workflowById = new Map(CROSS_FAMILY_WORKFLOWS.map((workflow) => [workflow.id, workflow]));

  return async function executeCrossFamilyWorkflow(caseSpec) {
    invariant(caseSpec?.kind === 'CROSS_FAMILY', 'Cross-family executor requires CROSS_FAMILY case');
    const workflow = workflowById.get(caseSpec.workflow?.id);
    invariant(Boolean(workflow), `Unknown cross-family workflow: ${caseSpec.workflow?.id}`);
    invariant(JSON.stringify(caseSpec.workflow.chain) === JSON.stringify(workflow.chain), `${workflow.id} chain drift`);
    invariant(caseSpec.workflow.terminalOwner === workflow.terminalOwner, `${workflow.id} terminal owner drift`);

    const familyNodes = workflow.chain.filter((node) => /^TPF-\d{2}$/.test(node)).map((familyId) => verifyFamilyNode(promptControl, familyId));
    const checks = {
      familyNodes,
      deterministicBoundary:null,
      markingReview:null,
      integrityHandoff:null,
      teacherStyleEnvelope:null,
      risk:caseSpec.inputFixture?.risk || 'CROSS_FAMILY_HANDOFF',
    };

    if (workflow.id === WORKFLOW_IDS.ASSESSMENT_CONSTRUCTION) {
      checks.deterministicBoundary = verifyDeterministicBoundary(DETERMINISTIC_BOUNDARIES.AUTHORITATIVE_PACKAGE_LOCK, 'Assessment Attempt/Package');
    } else if (workflow.id === WORKFLOW_IDS.MARKING_REVIEW) {
      checks.markingReview = verifyMarkingReviewBoundary();
      checks.deterministicBoundary = verifyDeterministicBoundary(DETERMINISTIC_BOUNDARIES.GRADEBOOK_OWNER, 'Gradebook');
    } else if (workflow.id === WORKFLOW_IDS.INTEGRITY_HANDOFF) {
      checks.integrityHandoff = verifyIntegrityHandoff();
    } else if (workflow.id === WORKFLOW_IDS.TEACHER_STYLE) {
      checks.teacherStyleEnvelope = verifyTeacherStyleEnvelope();
    }

    const adverse = checks.risk === 'ADVERSE_OWNER_ESCALATION';
    const authorityPreserved = familyNodes.every((node) => node.authorityCeilings.every((level) => level !== 'T0')) &&
      (!checks.deterministicBoundary || checks.deterministicBoundary.authorityCeiling === 'T0') &&
      (!adverse || familyNodes.every((node) => node.ownerBoundaries.length > 0));
    const provenancePreserved = familyNodes.every((node) => /^[0-9a-f]{64}$/.test(node.promptSha256));
    const handoffCompatible = authorityPreserved && provenancePreserved &&
      (workflow.id !== WORKFLOW_IDS.ASSESSMENT_CONSTRUCTION || Boolean(checks.deterministicBoundary)) &&
      (workflow.id !== WORKFLOW_IDS.MARKING_REVIEW || Boolean(checks.markingReview && checks.deterministicBoundary)) &&
      (workflow.id !== WORKFLOW_IDS.INTEGRITY_HANDOFF || Boolean(checks.integrityHandoff)) &&
      (workflow.id !== WORKFLOW_IDS.TEACHER_STYLE || Boolean(checks.teacherStyleEnvelope));

    return Object.freeze({
      workflowId:workflow.id,
      terminalOwner:workflow.terminalOwner,
      authorityPreserved,
      provenancePreserved,
      handoffCompatible,
      checks:Object.freeze(checks),
    });
  };
}

module.exports = {
  DETERMINISTIC_BOUNDARIES,
  WORKFLOW_IDS,
  familyCapabilities,
  verifyFamilyNode,
  verifyDeterministicBoundary,
  verifyMarkingReviewBoundary,
  verifyIntegrityHandoff,
  verifyTeacherStyleEnvelope,
  createCrossFamilyWorkflowExecutor,
};