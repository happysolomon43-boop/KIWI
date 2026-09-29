'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const { loadPromptBodyStore, promptBodyStoreStatus } = require('../teaching/prompt-runtime/prompt-body-store');
const registry = require('../teaching/capability-registry');

function fail(message) {
  console.error('[D03] FAIL:', message);
  process.exitCode = 1;
}

function check(condition, message) {
  if (!condition) fail(message);
}

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

const required = [
  'teaching/capability-registry/index.js',
  'teaching/capability-registry/registry-data.v1.1.part-00.b64',
  'teaching/capability-registry/registry-data.v1.1.part-01.b64',
  'teaching/prompt-runtime/frozen/source-baseline.d03.json',
  'teaching/prompt-runtime/frozen/prompt-family-catalog.v1.3.part-00',
  'teaching/prompt-runtime/frozen/prompt-family-catalog.v1.3.part-01',
  'teaching/prompt-runtime/frozen/prompt-family-catalog.v1.3.part-02',
  'teaching/prompt-runtime/frozen/prompt-family-catalog.v1.3.part-03',
  'teaching/prompt-runtime/frozen/prompt-manifest.v1.4.json.gz.b64',
  'teaching/prompt-runtime/frozen/TPF-20_Class_Grounded_Study_Note_v1.0_DESIGN_FROZEN.md.gz.b64',
  'docs/teaching/change-control/KIWI_Teaching_D03_TPF20_Successor_Correction_v1.0.md',
  'teaching/prompt-runtime/constitution.js',
  'teaching/prompt-runtime/prompt-catalog.js',
  'teaching/prompt-runtime/prompt-body-store.js',
  'teaching/prompt-runtime/route-control.js',
  'teaching/prompt-runtime/preparation.js',
  'teaching/prompt-runtime/contracts.js',
  'teaching/prompt-runtime/index.js',
  'tests/teaching/unit/d03-control-plane.test.js',
  'tests/teaching/unit/d03-prompt-bodies.test.js',
  '.github/workflows/teaching-d03-control.yml',
];

for (const file of required) {
  check(fs.existsSync(path.join(root, file)), `missing D03 artifact: ${file}`);
}

const historicalBytes = Buffer.concat([0,1,2,3].map((index) =>
  fs.readFileSync(path.join(root, 'teaching', 'prompt-runtime', 'frozen', `prompt-family-catalog.v1.3.part-${String(index).padStart(2, '0')}`))
));
const historical = JSON.parse(historicalBytes.toString('utf8'));

const successorAsset = fs.readFileSync(
  path.join(root, 'teaching', 'prompt-runtime', 'frozen', 'prompt-manifest.v1.4.json.gz.b64'),
  'utf8'
).trim();
const successorBytes = zlib.gunzipSync(Buffer.from(successorAsset, 'base64'));
const manifest = JSON.parse(successorBytes.toString('utf8'));

check(
  digest(successorBytes) === '7757b50cbf4cfb501158beeaccfbfd5776bc8ca8f7257b4855f5ed5fcdf67e3d',
  'Prompt Manifest v1.4 exact source hash drifted'
);
check(manifest.manifest_version === '1.4', 'D03 successor baseline must record Prompt Manifest v1.4');
check(manifest.prompt_family_count === 20, 'Prompt Manifest must contain exactly 20 families');
check(manifest.model_eligible_capability_count === 148, 'Prompt Manifest must cover 148 model-eligible capabilities');
check(
  manifest.combined_prompt_pack?.sha256 === '6632f5c566fb81906c5ecf27e7d5412a330b93f63c429d46f3bee65aac91ab5d',
  'D03 must pin the exact v1.4 combined Prompt Pack hash'
);
check(
  manifest.families.reduce((sum, family) => sum + family.capability_count, 0) === 148,
  'Prompt-family capability census must total 148'
);
check(historical.manifest_source_sha256 === '4276531b4fad9cab683dc9b829f857715ec561dd548aeb384459007515ffe6ce',
  'Historical Prompt Manifest v1.3 identity drifted');
check(historical.prompt_family_count === 19 && historical.model_eligible_capability_count === 147,
  'Historical 19-family baseline must remain intact');

for (const oldFamily of historical.families) {
  const current = manifest.families.find((family) => family.family_id === oldFamily.family_id);
  check(Boolean(current), `Historical family missing from v1.4: ${oldFamily.family_id}`);
  for (const key of ['family_id','name','version','criticality','capability_count','prompt_file','prompt_sha256']) {
    check(current?.[key] === oldFamily[key], `Historical binding changed: ${oldFamily.family_id}.${key}`);
  }
}

const tpf20 = manifest.families.find((family) => family.family_id === 'TPF-20');
check(Boolean(tpf20), 'TPF-20 missing from successor manifest');
check(tpf20.version === '1.0' && tpf20.criticality === 'C3' && tpf20.capability_count === 1,
  'TPF-20 manifest metadata drifted');
check(tpf20.prompt_sha256 === 'd8d13f679e6817c1c02935e6581f5fc6ad512812004b59eebcf9a7d85c962e67',
  'TPF-20 prompt SHA drifted');

try {
  const bodies = loadPromptBodyStore();
  const status = promptBodyStoreStatus();
  check(bodies.size === 20 && status.promptBodiesRuntimeAvailable && status.promptBodiesVerified,
    '20 frozen prompt bodies must be present and hash verified');
  const record = bodies.get('TPF-20');
  check(record?.promptSha256 === tpf20.prompt_sha256, 'TPF-20 runtime body must match v1.4 manifest');
  console.log('[D03] PASS: 20/20 runtime prompt bodies match Prompt Manifest v1.4.');
} catch (error) { fail(`frozen prompt body readiness: ${error.message}`); }

const census = registry.assertRegistryIntegrity();
check(
  census.total === 170 && census.modelEligible === 148 && census.t0Promptless === 22 &&
  census.promptFamilies === 20 && census.legacyAliases === 165,
  'Capability Registry successor census must be 170/148/22/20 with 165 historical aliases'
);
const noteCapability = registry.getCapability('teaching.study.class_grounded_note_generation');
check(noteCapability.execution_class === 'DIRECT-AI', 'TPF-20 capability must remain DIRECT-AI');
check(noteCapability.authority_ceiling === 'T3', 'TPF-20 capability must remain T3');
check(noteCapability.model_posture === 'MODEL_PRIMARY', 'TPF-20 capability model posture must remain MODEL_PRIMARY');
check(noteCapability.prompt_family_id === 'TPF-20', 'TPF-20 capability binding drifted');
check(noteCapability.prompt_family_version === '1.0', 'TPF-20 capability family version must remain v1.0');

const correctionDoc = fs.readFileSync(
  path.join(root, 'docs/teaching/change-control/KIWI_Teaching_D03_TPF20_Successor_Correction_v1.0.md'),
  'utf8'
);
for (const token of [
  'TCH-0919',
  '170/148/22/20',
  'd8d13f679e6817c1c02935e6581f5fc6ad512812004b59eebcf9a7d85c962e67',
  'UNQUALIFIED',
  'D30',
]) {
  check(correctionDoc.includes(token), `D03 TPF-20 correction record missing ${token}`);
}

const promptCatalogCode = fs.readFileSync(
  path.join(root, 'teaching/prompt-runtime/prompt-catalog.js'),
  'utf8'
);
check(
  /function assertManifestedPromptText/.test(promptCatalogCode) &&
    /TEACHING_UNMANIFESTED_PROMPT_TEXT_REJECTED/.test(promptCatalogCode) &&
    /sha256\(Buffer\.from\(promptText, 'utf8'\)\)/.test(promptCatalogCode),
  'D03 must reject unmanifested prompt text by exact family SHA-256'
);
check(/Historical prompt binding changed in v1\.4/.test(promptCatalogCode),
  'D03 must mechanically protect TPF-01–TPF-19 bindings from successor drift');

const routeControl = fs.readFileSync(
  path.join(root, 'teaching/prompt-runtime/route-control.js'),
  'utf8'
);
check(/number <= 20/.test(routeControl), 'D03 route manifest must include all 20 families');
check(/qualificationStatus:\s*QUALIFICATION_STATUS\.UNQUALIFIED/.test(routeControl), 'D03 routes must default to UNQUALIFIED');
check(/productionAuthorized:\s*false/.test(routeControl), 'D03 model routes must remain production blocked');
check(/productionAuthorizationGate:\s*'D31'/.test(routeControl), 'D03 production authorization must remain gated to D31');
check(/humanAcademicReviewRequired:\s*family\.criticality === 'C4'/.test(routeControl), 'D03 C4 routes must carry independent human academic review requirement');
check(/allowedPrimaryRoutes:\s*Object\.freeze\(\[\]\)/.test(routeControl), 'D03 must not embed primary model routes');
check(/allowedFallbackRoutes:\s*Object\.freeze\(\[\]\)/.test(routeControl), 'D03 must not embed fallback model routes');

const codeFiles = [
  'teaching/capability-registry/index.js',
  'teaching/prompt-runtime/constitution.js',
  'teaching/prompt-runtime/prompt-catalog.js',
  'teaching/prompt-runtime/route-control.js',
  'teaching/prompt-runtime/preparation.js',
  'teaching/prompt-runtime/contracts.js',
  'teaching/prompt-runtime/index.js',
];
const codeText = codeFiles.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
check(
  !/(gemini|openai|anthropic|vertex|bedrock|flash[-_ ]?lite|\bflash\b)/i.test(codeText),
  'D03 Teaching control code must not hard-code provider/model identity'
);
check(
  !/(chain_of_thought_allowed\s*:\s*true|hiddenChainOfThoughtAllowed\s*:\s*true)/i.test(codeText),
  'D03 prompt contracts must not require hidden chain-of-thought'
);

const contracts = fs.readFileSync(
  path.join(root, 'teaching', 'prompt-runtime', 'contracts.js'),
  'utf8'
);
for (const requiredToken of [
  'bounded_actions',
  'allowed_operations',
  'prohibited_operations',
  'evidence_purpose',
  'downstream_handoff',
  'TEACHING_T4_CONTEXT_ALLOWLIST_REQUIRED',
]) {
  check(contracts.includes(requiredToken), `D03 structural prompt contract missing ${requiredToken}`);
}

const runtime = fs.readFileSync(path.join(root, 'teaching/runtime/index.js'), 'utf8');
check(runtime.includes("require('../prompt-runtime')"), 'Teaching runtime must compose the D03 prompt control plane');
check(runtime.includes('promptControl.assertReady()'), 'Teaching runtime must verify D03 control-plane readiness');
check(runtime.includes('20/20 families, manifest v1.4'), 'Runtime readiness log must report the successor prompt census');

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
check(Boolean(packageJson.scripts?.['verify:teaching:d03']), 'package.json missing verify:teaching:d03');

const migrationsDir = path.join(root, 'migrations');
if (fs.existsSync(migrationsDir)) {
  check(
    !fs.readdirSync(migrationsDir).some((name) => /teaching_d03/i.test(name)),
    'D03 correction must not pull D04 Teaching persistence into D03'
  );
}

if (!process.exitCode) {
  console.log('[D03] PASS: successor 170/148/22/20 registry + exact TPF-20 v1.0 are hash-locked, historical 19 families are unchanged, and all routes remain production-held.');
}
