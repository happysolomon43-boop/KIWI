'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function fail(message) {
  console.error('[D01] FAIL:', message);
  process.exitCode = 1;
}

function check(condition, message) {
  if (!condition) fail(message);
}

const required = [
  'teaching/README.md',
  'teaching/index.js',
  'teaching/config/index.js',
  'teaching/config/feature-flags.js',
  'teaching/domain/ids.js',
  'teaching/domain/time.js',
  'teaching/events/names.js',
  'teaching/events/contracts.js',
  'teaching/events/dispatcher.js',
  'teaching/events/idempotency.js',
  'teaching/events/audit.js',
  'teaching/integrations/kiwi-subjects.js',
  'teaching/integrations/kiwi-exam-interface.js',
  'teaching/integrations/kiwi-notifications.js',
  'teaching/repositories/index.js',
  'teaching/services/teaching-service.js',
  'teaching/security/privileged-operations.js',
  'teaching/security/secret-audit.js',
  'public/teaching.html',
  'public/teaching.js',
  'public/kiwi-runtime-config.js',
  'public/kiwi-api-client.js',
  'teaching-backend.js',
  'tests/teaching/unit/foundation.test.js',
  'tests/teaching/unit/backend-router.test.js',
  'tests/teaching/integration/supabase-foundation.test.js',
];

const moduleFolders = [
  'curriculum','courses','lessons','classroom','controller','pedagogy','knowledge',
  'scheduling','attendance','work','assessment','grading','requests','teacher-identity',
  'progression','shared-ui',
];

for (const file of required) {
  check(fs.existsSync(path.join(root, file)), `missing D01 artifact: ${file}`);
}

for (const moduleName of moduleFolders) {
  check(
    fs.existsSync(path.join(root, 'teaching', 'modules', moduleName, 'index.js')),
    `missing Teaching module boundary: ${moduleName}`
  );
}

const indexJs = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
for (const forbidden of [
  /postgres(?:ql)?:\/\/[^\s'"]+/i,
  /process\.env\.ADMIN_MASTER_TOKEN\s*\|\|\s*['"]/,
  /process\.env\.JWT_SECRET\s*\|\|\s*['"]/,
]) {
  check(!forbidden.test(indexJs), `index.js still contains a forbidden secret fallback pattern: ${forbidden}`);
}

check(
  indexJs.includes("require('./services/runtime-secrets')"),
  'index.js must use the runtime secret boundary'
);
check(
  indexJs.includes('subjectSource: db.subjects'),
  'Teaching router must receive the existing KIWI Subject source through injection'
);

const teachingJs = fs.readFileSync(path.join(root, 'public', 'teaching.js'), 'utf8');
check(
  teachingJs.includes("from '/kiwi-api-client.js'"),
  'Teaching frontend must use the shared KIWI API client'
);
check(
  !/gemini|openai|anthropic|vertex|bedrock/i.test(teachingJs),
  'Teaching frontend must not contain provider-specific routing assumptions'
);

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
check(Boolean(packageJson.scripts?.['test:teaching']), 'package.json missing test:teaching');
check(Boolean(packageJson.scripts?.['test:teaching:integration']), 'package.json missing integration test script');
check(Boolean(packageJson.scripts?.['verify:teaching:d01']), 'package.json missing D01 verifier script');

if (!process.exitCode) {
  console.log('[D01] PASS: Teaching repository/module/test foundation is structurally complete.');
}
