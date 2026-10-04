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

function main() {
  d30.assertD30TaskCensus();
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

  const d30Sources = fs.readdirSync(path.join(root, 'teaching', 'd30')).filter((name) => name.endsWith('.js')).map((name) => read(path.join('teaching','d30',name))).join('\n');
  invariant(!/require\(['"]\.\.\/\.\.\/services\/ai\/(?:google|groq|cloudflare)-provider-adapter/.test(d30Sources), 'D30 bypasses the central AI Orchestrator with a provider adapter');
  invariant(!/https:\/\/(?:generativelanguage|api\.groq|api\.cloudflare)/i.test(d30Sources), 'D30 contains a direct provider endpoint');

  const migration = read('migrations/20261004_teaching_d30_canonical_qualification.sql');
  for (const table of ['d30_qualification_sessions','d30_case_results','d30_human_reviews','d30_defects','d30_route_decisions','d30_prompt_governance','d30_ppl_comparisons']) invariant(migration.includes(table), `migration missing ${table}`);
  invariant(/production_authorized boolean not null default false check \(production_authorized = false\)/i.test(migration), 'D31 authorization hold is not schema-enforced');
  invariant(/unique \(session_id, family_id, capability_id, route_key, route_role\)/i.test(migration), 'route decisions are not capability-specific');
  invariant(/output_artifact jsonb/i.test(migration), 'bounded human-review artifact persistence missing');

  const governanceSource = read('teaching/d30/governance.js');
  invariant(/BEHAVIOR_BRIEF/.test(governanceSource), 'Behavior Brief governance gate missing');
  invariant(/C4_INDEPENDENT_HUMAN_REVIEW_REQUIRED/.test(governanceSource), 'C4 independent human review gate missing');

  const report = {
    delivery:'D30',
    tasks:d30.D30_TASK_IDS.length,
    historicalDistinct:corpus.historicalDistinct,
    tpf20Distinct:corpus.tpf20Distinct,
    totalDistinct:corpus.totalDistinct,
    modelEligibleCapabilities:corpus.modelEligibleCapabilities,
    promptFamilies:d30.FAMILY_DEFINITIONS.length,
    manifest:d30.PROMPT_MANIFEST_VERSION,
    productionAuthorized:false,
    nextAuthorizationGate:'D31',
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main();