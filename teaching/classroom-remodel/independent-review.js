'use strict';
const {createAutomatedSemanticReviewer}=require('../d30/semantic-reviewer');
const {fail}=require('./contracts');
function createClassroomIndependentReviewService({baseOrchestrator,reviewerRouteKey,qualificationReader,caseSpecReader,candidateProvenanceReader,randomUUID}={}) {
 for(const fn of [qualificationReader,caseSpecReader,candidateProvenanceReader,randomUUID])if(typeof fn!=='function')throw new TypeError('Classroom review needs owned case specifications, generation provenance and route evidence');
 const review=createAutomatedSemanticReviewer({baseOrchestrator,reviewerRouteKey});
 async function run({artifacts,context,workflow,whole}) {
  const provenance=await Promise.all(artifacts.map(candidateProvenanceReader));
  if(provenance.some(p=>!p?.routeKey||!p.modelIdentifier||!p.executionId))fail('CLASSROOM_GENERATION_PROVENANCE_MISSING');
  if(provenance.some(p=>p.routeKey===reviewerRouteKey))fail('CLASSROOM_REVIEW_INDEPENDENCE_COLLAPSED');
  const evidence=await qualificationReader({reviewerRouteKey,artifacts,provenance});
  if(evidence?.status!=='QUALIFIED'||evidence.evidenceKind!=='OBSERVED_LIVE_PROVIDER'||!evidence.evidenceId)fail('CLASSROOM_REVIEW_ROUTE_NOT_QUALIFIED');
  const caseSpec=await caseSpecReader({artifacts,context,workflow,whole});
  if(!caseSpec?.id||!caseSpec.expected||!caseSpec.inputFixture)fail('CLASSROOM_REVIEW_EXPECTATIONS_MISSING');
  const result=await review({caseSpec,output:whole?artifacts.map(a=>({kind:a.artifact_kind,payload:a.payload})):artifacts[0].payload,routeKey:provenance[0].routeKey,modelId:provenance[0].modelIdentifier});
  if(result.reviewerRouteKey!==reviewerRouteKey||!result.independentFromCandidateRoute||!result.pass)fail('CLASSROOM_INDEPENDENT_REVIEW_REJECTED');
  const receipt={accepted:true,independent:true,routeQualified:true,reviewId:randomUUID(),reviewerKind:result.reviewerKind,reviewerRouteKey:result.reviewerRouteKey,reviewerModelId:result.reviewerModelId,qualificationEvidenceId:evidence.evidenceId,generationExecutions:provenance.map(p=>p.executionId),cannotSatisfyC4HumanReview:true,criterionFindings:result.criterionFindings||[]};
  return whole?{...receipt,contentHashes:artifacts.map(a=>a.content_sha256)}:{...receipt,contentHash:artifacts[0].content_sha256};
 }
 return Object.freeze({reviewArtifact:({artifact,...args})=>run({...args,artifacts:[artifact],whole:false}),reviewWholeArtifact:args=>run({...args,whole:true})});
}
module.exports={createClassroomIndependentReviewService};
