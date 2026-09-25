'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function fail(message) {
  console.error('[D03] FAIL:', message);
  process.exitCode = 1;
}

function check(condition, message) {
  if (!condition) fail(message);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
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
  'teaching/prompt-runtime/constitution.js',
  'teaching/prompt-runtime/prompt-catalog.js',
  'teaching/prompt-runtime/route-control.js',
  'teaching/prompt-runtime/preparation.js',
  'teaching/prompt-runtime/contracts.js',
  'teaching/prompt-runtime/index.js',
  'tests/teaching/unit/d03-control-plane.test.js',
  '.github/workflows/teaching-d03-control.yml',
];

for (const file of required) {
  check(fs.existsSync(path.join(root, file)), `missing D03 artifact: ${file}`);
}

const manifest = JSON.parse(Buffer.concat([0,1,2,3].map((index) =>
  fs.readFileSync(path.join(root, 'teaching', 'prompt-runtime', 'frozen', `prompt-family-catalog.v1.3.part-${String(index).padStart(2, '0')}`))
)).toString('utf8'));
check(
  manifest.manifest_source_sha256 === '4276531b4fad9cab683dc9b829f857715ec561dd548aeb384459007515ffe6ce',
  'Prompt Manifest v1.3 source identity drifted'
);
check(manifest.manifest_version === '1.3', 'D03 implementation baseline must record Prompt Manifest v1.3');
check(manifest.prompt_family_count === 19, 'Prompt Manifest must contain exactly 19 families');
check(manifest.model_eligible_capability_count === 147, 'Prompt Manifest must cover 147 model-eligible capabilities');
check(
  manifest.combined_prompt_pack?.sha256 === '173b091587e16604c112d9f500c3915bb0057aab8946aacb2c0a5ca8da8c7aae',
  'D03 must pin the user-authorized combined Prompt Pack v1.3 hash'
);
check(
  manifest.families.reduce((sum, family) => sum + family.capability_count, 0) === 147,
  'Prompt-family capability census must total 147'
);

const routeControl = fs.readFileSync(
  path.join(root, 'teaching/prompt-runtime/route-control.js'),
  'utf8'
);
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

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
check(Boolean(packageJson.scripts?.['verify:teaching:d03']), 'package.json missing verify:teaching:d03');

const migrationsDir = path.join(root, 'migrations');
if (fs.existsSync(migrationsDir)) {
  check(
    !fs.readdirSync(migrationsDir).some((name) => /teaching_d03/i.test(name)),
    'D03 must not pull D04 Teaching persistence forward'
  );
}

if (!process.exitCode) {
  console.log('[D03] PASS: Capability Registry, prompt runtime and route-control foundation are structurally complete and production-held.');
}
