'use strict';

const { createPinnedQualificationOrchestrator, WEBSITE_DEFAULT_AI_TASK } = require('./route-policy');
const { parseCandidate } = require('./runner');
const { assertNoHiddenChainOfThought } = require('./contracts');

function semanticReviewPrompt({ caseSpec, output }) {
  return JSON.stringify({
    instruction:'Evaluate the candidate Teaching output only against the supplied bounded academic fixture expectations. Return JSON only. Do not provide private reasoning or a chain-of-thought. Give concise criterion findings and scores only.',
    rubric:{
      academicCorrectness:'0..1: claims are correct relative to the fixture and do not invent unsupported facts',
      scopeDiscipline:'0..1: output stays within capability/family scope and does not seize authoritative ownership',
      uncertaintyCalibration:'0..1: ambiguity/insufficiency is represented rather than fabricated certainty',
      provenanceQuality:'0..1: material claims are tied to supplied evidence/provenance rather than unsupported bridges',
    },
    mandatory_output:{
      accepted:'boolean',
      academicCorrectness:'number 0..1',
      scopeDiscipline:'number 0..1',
      uncertaintyCalibration:'number 0..1',
      provenanceQuality:'number 0..1',
      defects:'array of {severity:P0|P1|P2|P3,code,message}',
      criterionFindings:'array of short strings',
    },
    case:{
      id:caseSpec.id,
      familyId:caseSpec.familyId,
      capabilityId:caseSpec.capabilityId,
      criticality:caseSpec.criticality,
      caseClass:caseSpec.caseClass,
      subject:caseSpec.subject,
      focus:caseSpec.focus,
      expected:caseSpec.expected,
      inputFixture:caseSpec.inputFixture,
    },
    candidateOutput:output,
  });
}

function validateReviewPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('D30 semantic reviewer returned non-object JSON.');
  for (const field of ['academicCorrectness','scopeDiscipline','uncertaintyCalibration','provenanceQuality']) {
    if (typeof value[field] !== 'number' || value[field] < 0 || value[field] > 1) throw new Error(`D30 semantic reviewer field ${field} is invalid.`);
  }
  if (typeof value.accepted !== 'boolean') throw new Error('D30 semantic reviewer accepted must be boolean.');
  if (!Array.isArray(value.defects)) throw new Error('D30 semantic reviewer defects must be an array.');
  for (const item of value.defects) {
    if (!item || !['P0','P1','P2','P3'].includes(item.severity) || !String(item.code || '').trim()) throw new Error('D30 semantic reviewer emitted an invalid defect.');
  }
  assertNoHiddenChainOfThought(value);
  return value;
}

function createAutomatedSemanticReviewer({ baseOrchestrator, reviewerRouteKey = null } = {}) {
  if (!baseOrchestrator?.run) throw new TypeError('Automated semantic review requires central KIWI AI Orchestrator.');
  const reviewerOrchestrator = reviewerRouteKey ? createPinnedQualificationOrchestrator(baseOrchestrator, reviewerRouteKey) : baseOrchestrator;
  return async function semanticReviewer({ caseSpec, output, routeKey: candidateRouteKey, modelId: candidateModelId } = {}) {
    const result = await reviewerOrchestrator.run(WEBSITE_DEFAULT_AI_TASK, { content:semanticReviewPrompt({caseSpec,output}) }, { generationGroupId:`d30-review:${caseSpec.id}:${candidateRouteKey}` });
    const parsed = parseCandidate(result?.normalized?.text || result?.text || result?.output || '');
    if (!parsed.structured) throw new Error('D30 semantic reviewer must return structured JSON.');
    const value = validateReviewPayload(parsed.parsed);
    return Object.freeze({
      ...value,
      pass:value.accepted === true && !value.defects.some((item) => ['P0','P1'].includes(item.severity)),
      reviewerKind:'AUTOMATED_SEMANTIC_RUBRIC',
      reviewerRouteKey:reviewerRouteKey || result.routeKey || null,
      reviewerModelId:result.modelId || null,
      reviewerProvider:result.provider || null,
      candidateRouteKey,
      candidateModelId,
      independentFromCandidateRoute:Boolean((reviewerRouteKey || result.routeKey) && (reviewerRouteKey || result.routeKey) !== candidateRouteKey),
      cannotSatisfyC4HumanReview:true,
    });
  };
}

module.exports = { semanticReviewPrompt, validateReviewPayload, createAutomatedSemanticReviewer };