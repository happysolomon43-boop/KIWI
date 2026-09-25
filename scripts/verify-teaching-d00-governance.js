'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const gov = path.join(root, 'docs', 'teaching', 'governance');
const baselinePath = path.join(gov, 'canonical-baseline.json');

function fail(message) {
  console.error('[D00] FAIL:', message);
  process.exitCode = 1;
}

function assert(condition, message) {
  if (!condition) fail(message);
}

const requiredFiles = [
  'README.md',
  'canonical-baseline.json',
  'source-resolution.md',
  'decision-log.md',
  'terminology.md',
  'authority-and-state-contracts.md',
  'intelligence-and-ppl.md',
  'release-scope.md',
  'dependency-change-control.md',
  'blueprint-traceability.md',
];

for (const file of requiredFiles) {
  assert(fs.existsSync(path.join(gov, file)), 'missing governance artifact: ' + file);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

assert(baseline.delivery === 'D00', 'delivery must be D00');
assert(baseline.counts.permanent_tasks === 902, 'permanent task count must be 902');
assert(baseline.counts.deliveries === 32, 'delivery count must be 32');
assert(baseline.counts.capabilities === 169, 'capability count must be 169');
assert(baseline.counts.model_eligible_capabilities === 147, 'model-eligible count must be 147');
assert(baseline.counts.t0_promptless_capabilities === 22, 'T0 promptless count must be 22');
assert(baseline.counts.prompt_families === 19, 'prompt family count must be 19');
assert(baseline.d00_task_ids.length === 26, 'D00 must contain exactly 26 TCH tasks');
assert(new Set(baseline.d00_task_ids).size === 26, 'D00 task IDs must be unique');
assert(baseline.route_qualification === 'UNQUALIFIED_UNTIL_D30', 'Teaching AI routes must remain unqualified until D30');
assert(baseline.production_release === 'NOT_AUTHORIZED_UNTIL_D31', 'production release must remain blocked until D31');

const expectedPpl = new Set([
  'teaching.preparation.workspace_state_transition',
  'teaching.preparation.materiality_staleness_reconciliation',
  'teaching.preparation.finalization_readiness_gate',
  'teaching.preparation.protected_content_isolation',
]);
assert(baseline.ppl_t0_capabilities.length === 4, 'exactly four PPL T0 capabilities required');
for (const id of baseline.ppl_t0_capabilities) assert(expectedPpl.has(id), 'unexpected PPL T0 capability: ' + id);

const expectedHashes = {
  blueprint: '01fc144a33fa2ce839a7505e67922d723539664a72d957cf282dc498a7d72158',
  backlog: '4d296dd650ca7ffc55607d4d31e355e8afa49c476c577d42bf9cd665f4460092',
  capability_registry: 'a68e19eff631d43d4ab31ddd15b46298dc4ffb48dc2006758e85f712200c4ef4',
  orchestrator_event_runtime: 'f3f7b806e5e5f69bf7be52de2db6f12b17b39edc9f1910ebbc9520b1e591798d',
  ppl_standard: '6299a0378c7f409128eaca623193f56677eabe952b2c2d92368a8f883d7606f3',
  delivery_roadmap: 'ca21c8e3da2a1ffeeb46a5e807ac7f0f8254f499260308184fd1b71752b68bb0',
  delivery_task_map: '9bd1efae6160248c39c2bde73f942b040cef6f2a71d8c2c4c65bd67f0500a1db',
  final_freeze: '3ae10e85afc1a83c5bb7c60e4f98352540c2c56444b83b6843a461b8731dbbbd',
};

for (const [key, sha] of Object.entries(expectedHashes)) {
  assert(baseline.canonical[key]?.sha256 === sha, 'canonical hash mismatch for ' + key);
}

if (!process.exitCode) {
  console.log('[D00] PASS: canonical governance baseline is internally consistent.');
}
