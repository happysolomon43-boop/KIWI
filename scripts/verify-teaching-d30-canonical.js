'use strict';

const fs = require('node:fs');
const path = require('node:path');
const d30 = require('../teaching/d30');
const { createTeachingPromptControlPlane } = require('../teaching/prompt-runtime');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function invariant(condition, message) {
  if (!condition) throw new Error(`D30 verification failed: ${message}`);
}

function taskAnchorExists(anchor) {
  const relative = String(anchor || '').trim();
  if (!relative) return false;
  const candidates = relative.includes('/')
    ? [relative]
    : [path.join('teaching', 'd30', relative), relative];
  return candidates.some((candidate) => fs.existsSync(path.join(root, candidate)));
}

function verifyTaskAccounting() {
  d30.assertD30TaskCensus();
  d30.assertTaskAccountingComplete();
  invariant(d30.D30_TASK_IDS.length === 46, 'canonical D30 task count drift');
  invariant(Object.keys(d30.TASK_ACCOUNTING).length === 46, 'D30 task accounting count drift');
  for (const taskId of d30.D30_TASK_IDS) {
    const accounting = d30.TASK_ACCOUNTING[taskId];
    invariant(Boolean(accounting), `task accounting missing ${taskId}`);
    for (const anchor of accounting.anchors) {
      invariant(taskAnchorExists(anchor), `${taskId} accounting anchor does not exist: ${anchor}`);
    }
  }
}

function verifyHumanReviewGate() {
  invariant(typeof d30.buildHumanReviewQueue === 'function', 'human academic review queue is not exported');
  invariant(typeof d30.validateHumanReviewSubmission === 'function', 'human academic review validator is not exported');
  invariant(typeof d30.createD30BoundedCommand === 'function', 'run-scoped bounded qualification command is not exported');
  const family = d30.getFamilyDefinition('TPF-02');
  const record = {
    sessionId:'00000000-0000-4000-8000-000000000001',
    runId:'00000000-0000-4000-8000-000000000002',
    caseId:'D30-STATIC-C4-REVIEW',
    familyId:'TPF-02',
    capabilityId:'teaching.course.curriculum_structure_analysis',
    routeKey:'static::review-route',
    routeRole:'PRIMARY',
    modelId:'static-model',
    provider:'static-provider',
    promptFamilyVersion:family.version,
    promptSha256:family.promptSha256,
    criticality:'C4',
    attemptNo:1,
    outputArtifact:{ conclusion:'bounded review artifact', review_required:false },
    defects:[],
  };
  const queue = d30.buildHumanReviewQueue([record]);
  invariant(queue.length === 1, 'C4 run did not enter independent human academic review queue');
  const queueItem = queue[0];
  invariant(queueItem.runId === record.runId && queueItem.attemptNo === 1, 'human review queue lost exact run/attempt identity');
  const baseSubmission={
    sessionId:record.sessionId,
    runId:record.runId,
    attemptNo:record.attemptNo,
    caseId:record.caseId,
    familyId:record.familyId,
    capabilityId:record.capabilityId,
    routeKey:record.routeKey,
  };
  const automated = d30.validateHumanReviewSubmission({
    ...baseSubmission,
    reviewerRef:'automated-reviewer',
    reviewerKind:'AUTOMATED',
    independent:true,
    decision:'PASS',
    rubric:{ academicCorrectness:'PASS' },
  }, queueItem);
  invariant(automated.valid === false, 'automated review was accepted as C4 human academic review');
  invariant(automated.errors.includes('HUMAN_ACADEMIC_REVIEWER_REQUIRED'), 'automated reviewer rejection reason drift');
  const human = d30.validateHumanReviewSubmission({
    ...baseSubmission,
    reviewerRef:'independent-human-academic-reviewer',
    reviewerKind:'HUMAN_ACADEMIC',
    independent:true,
    decision:'PASS',
    rubric:{ academicCorrectness:'PASS', authorityDiscipline:'PASS', provenance:'PASS' },
  }, queueItem);
  invariant(human.valid === true, 'valid independent human academic review was rejected');
  const wrongAttempt=d30.validateHumanReviewSubmission({...baseSubmission,attemptNo:2,reviewerRef:'independent-human-academic-reviewer',reviewerKind:'HUMAN_ACADEMIC',independent:true,decision:'PASS',rubric:{academicCorrectness:'PASS'}},queueItem);
  invariant(wrongAttempt.valid === false && wrongAttempt.errors.includes('ATTEMPT_NO_MISMATCH'), 'human review attempt identity is not fail-closed');
}

function main() {
  verifyTaskAccounting();

  const corpus = d30.validateCorpus();
  invariant(corpus.historicalDistinct === 1904, 'historical Phase-16 distinct floor drift');
  invariant(corpus.tpf20Distinct >= 96, 'TPF-20 amendment floor drift');
  invariant(corpus.totalDistinct >= 2000, 'combined D30 distinct floor drift');
  invariant(corpus.modelEligibleCapabilities === 148, 'model-eligible capability census drift');
  invariant(corpus.seedTraceSlots === 38, 'historical seed traceability drift');

  const promptControl = createTeachingPromptControlPlane();
  promptControl.assertReady();
  const promptStatus = promptControl.status();
  invariant(promptStatus.promptManifestVersion === d30.PROMPT_MANIFEST_VERSION, 'prompt manifest version mismatch');
  invariant(promptStatus.promptManifestSha256 === d30.PROMPT_MANIFEST_SHA256, 'prompt manifest hash mismatch');
  invariant(promptStatus.promptPackSha256 === d30.PROMPT_PACK_SHA256, 'prompt pack hash mismatch');
  invariant(promptStatus.promptFamilyCount === 20, 'prompt family count mismatch');
  invariant(promptStatus.productionModelExecutionAuthorized === false, 'D03 production hold was unexpectedly bypassed');

  const familyIds = new Set(promptControl.listPromptFamilies().map((family) => family.id));
  invariant(d30.FAMILY_DEFINITIONS.every((family) => familyIds.has(family.familyId)), 'D30 family binding missing from frozen prompt runtime');

  const routeSource = read('teaching/d30/route-policy.js');
  invariant(/createAIOrchestrator/.test(routeSource), 'D30 route qualification does not construct through central AI Orchestrator');
  invariant(/QUICK_QUESTIONS/.test(routeSource), 'website-default Teaching task binding missing');
  invariant(/FLASHCARD_GENERATION/.test(routeSource), 'Course Plan flash-generation task binding missing');

  const coordinatorSource=read('teaching/d30/coordinator.js');
  invariant(/findResumableSession/.test(coordinatorSource), 'D30 empirical coordinator is not resumable');
  invariant(/executePplBatch/.test(coordinatorSource), 'D30 coordinator does not execute matched PPL evidence');
  invariant(/finalizePplComparison/.test(coordinatorSource), 'D30 coordinator does not persist/finalize PPL comparison evidence');
  const pplSource=read('teaching/d30/ppl-qualification.js');
  invariant(/OBSERVED_WITHIN_SCENARIO_REPEAT_RANGE/.test(pplSource), 'PPL materiality calibration is not empirical/noise-derived');
  invariant(/teaching\.lesson\.pre_class_lesson_planning/.test(pplSource), 'PPL Lesson qualification is not bound to canonical Lesson planning capability');
  invariant(/teaching\.assessment\.assessment_blueprint_generation/.test(pplSource), 'PPL Assessment qualification is not bound to canonical Assessment planning capability');
  const boundedSource=read('teaching/d30/bounded-command.js');
  invariant(/runId/.test(boundedSource) && /attemptNo/.test(boundedSource), 'bounded D30 review command is not exact-run scoped');
  invariant(/authorizationGate:'D31'/.test(boundedSource), 'bounded D30 command lost the D31 authorization hold');
  const cliSource=read('scripts/run-teaching-d30-qualification.js');
  invariant(/createAIRuntime/.test(cliSource), 'D30 CLI does not initialize the real central AI runtime');
  invariant(/createAutomatedSemanticReviewer/.test(cliSource), 'D30 CLI does not bind the semantic reviewer');
  invariant(/D30_EMPIRICAL_QUALIFICATION/.test(cliSource), 'D30 CLI live-provider confirmation gate is missing');

  const d30Sources = fs.readdirSync(path.join(root, 'teaching', 'd30'))
    .filter((name) => name.endsWith('.js'))
    .map((name) => read(path.join('teaching', 'd30', name)))
    .join('\n');
  invariant(!/require\(['"]\.\.\/\.\.\/services\/ai\/(?:google|groq|cloudflare)-provider-adapter/.test(d30Sources), 'D30 bypasses the central AI Orchestrator with a provider adapter');
  invariant(!/https:\/\/(?:generativelanguage|api\.groq|api\.cloudflare)/i.test(d30Sources), 'D30 contains a direct provider endpoint');

  const migration = read('migrations/20261004_teaching_d30_canonical_qualification.sql');
  for (const table of ['d30_qualification_sessions','d30_case_results','d30_human_reviews','d30_defects','d30_route_decisions','d30_prompt_governance','d30_ppl_comparisons']) {
    invariant(migration.includes(table), `migration missing ${table}`);
  }
  invariant(/production_authorized boolean not null default false check \(production_authorized = false\)/i.test(migration), 'D31 authorization hold is not schema-enforced');
  invariant(/unique \(session_id, family_id, capability_id, route_key, route_role\)/i.test(migration), 'route decisions are not capability-specific');
  invariant(/output_artifact jsonb/i.test(migration), 'bounded human-review artifact persistence missing');
  invariant(/enable row level security/i.test(migration), 'D30 evidence tables are not RLS protected');
  invariant(/revoke all[\s\S]*from anon, authenticated/i.test(migration), 'D30 evidence tables are not closed to client roles');
  const reviewIdentityMigration=read('migrations/20261004_teaching_d30_human_review_run_identity.sql');
  invariant(/run_id uuid/i.test(reviewIdentityMigration), 'D30 human-review run identity column migration missing');
  invariant(/attempt_no integer/i.test(reviewIdentityMigration), 'D30 human-review attempt identity column migration missing');
  invariant(/foreign key \(run_id\)[\s\S]*d30_case_results\(id\)/i.test(reviewIdentityMigration), 'D30 human-review run identity is not tied to empirical case evidence');

  const governanceSource = read('teaching/d30/governance.js');
  invariant(/BEHAVIOR_BRIEF/.test(governanceSource), 'Behavior Brief governance gate missing');
  invariant(/C4_INDEPENDENT_HUMAN_REVIEW_REQUIRED/.test(governanceSource), 'C4 independent human review gate missing');

  verifyHumanReviewGate();

  const fakeLite={routeKey:'static::lite',provider:'static',modelId:'lite',reasoning:'LOW',taskClass:'STATIC'};
  const fakeStrong={routeKey:'static::strong',provider:'static',modelId:'strong',reasoning:'HIGH',taskClass:'STATIC'};
  const fakeOrchestrator={run:async()=>{},plan:()=>({candidates:[fakeLite,fakeStrong]}),router:{resolveCandidates(_taskId,{preparationRoutePosture}={}){return preparationRoutePosture==='economy_maintenance'?[fakeLite]:[fakeStrong];},getTask(){return {};}}};
  const pplPlan=d30.buildPplQualificationPlan({orchestrator:fakeOrchestrator});
  invariant(pplPlan.scenarios.length===8,'PPL matched scenario count drift');
  invariant(d30.buildPplWorkItems(pplPlan).length===72,'PPL durable work-item count drift');

  const report = {
    delivery:'D30',
    tasks:d30.D30_TASK_IDS.length,
    accountedTasks:Object.keys(d30.TASK_ACCOUNTING).length,
    historicalDistinct:corpus.historicalDistinct,
    tpf20Distinct:corpus.tpf20Distinct,
    totalDistinct:corpus.totalDistinct,
    modelEligibleCapabilities:corpus.modelEligibleCapabilities,
    promptFamilies:d30.FAMILY_DEFINITIONS.length,
    manifest:d30.PROMPT_MANIFEST_VERSION,
    humanAcademicReviewGate:'EXACT_RUN_ENFORCED',
    boundedQualificationCli:'PRESENT',
    pplDurableWorkItems:d30.buildPplWorkItems(pplPlan).length,
    productionAuthorized:false,
    nextAuthorizationGate:'D31',
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main();
