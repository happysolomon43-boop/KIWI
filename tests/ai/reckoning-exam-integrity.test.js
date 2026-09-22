const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'index.js'), 'utf8');

function section(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test('CBT option integrity never destroys cross-question option text', () => {
  assert.doesNotMatch(source, /function\s+deduplicateCBTOptions\s*\(/);
  assert.doesNotMatch(source, /questions\s*=\s*deduplicateCBTOptions\s*\(/);
  assert.doesNotMatch(source, /questions\[qi\]\[key\]\s*=\s*['"]\[option removed — duplicate\]['"]/);

  const integrity = section(
    'function validateCBTQuestionOptions',
    '// Fisher-Yates shuffle'
  );
  assert.match(integrity, /new Set\(normalized\)\.size\s*!==\s*CBT_OPTION_KEYS\.length/);
  assert.match(integrity, /duplicate_option_within_question/);
  assert.match(integrity, /placeholder_option/);
});

test('parser drops malformed questions rather than persisting placeholder choices', () => {
  const parserStart = source.indexOf('const optionCheck = validateCBTQuestionOptions(parsedQuestion)');
  assert.notEqual(parserStart, -1);
  assert.doesNotMatch(source, /option_a:\s*oA\s*\|\|\s*['"]Not applicable['"]/);
  assert.match(source, /Q\$\{q\.question_number\} DROPPED — invalid options/);
});

test('final CBT integrity runs before minimum-count and Reckoning fallback decisions', () => {
  const generation = section(
    '// ── Shared post-generation checks (both paths)',
    '// Log actual ratio for split path'
  );
  const integrityIndex = generation.indexOf("filterInvalidCBTQuestions(questions || [], 'final integrity')");
  const minIndex = generation.indexOf('const _minAccept');
  assert.ok(integrityIndex >= 0);
  assert.ok(minIndex > integrityIndex);
  assert.match(generation, /generateFallbackExamQuestions/);
});

test('ready Reckoning activation overwrites the legacy creation timestamp', () => {
  const createBlock = section(
    'examSessions: {',
    '// ── exam_questions'
  );
  assert.match(createBlock, /started_at:\s*new Date\(\)/);
  assert.match(createBlock, /status:\s*data\.status \|\| ['"]pending['"]/);

  const start = section(
    'async function startReckoningExam',
    'const RECKONING_FAILSAFE_FAILURES'
  );
  assert.match(start, /exam\.status === ['"]ready['"] \? new Date\(\)/);
  assert.match(start, /started_at:\s*startedAt/);
});

test('missing answer mappings are rejected instead of silently defaulting to A', () => {
  assert.doesNotMatch(source, /const correctLetter = ans\.correct_answer \|\| ['"]A['"]/);
  assert.match(source, /const correctLetter = String\(ans\.correct_answer \|\| ['"]['"]\)\.toUpperCase\(\)/);
});

test('starting a Reckoning activates the exact linked exam before in-progress state', () => {
  const start = section(
    'async function startReckoningExam',
    'const RECKONING_FAILSAFE_FAILURES'
  );
  assert.match(start, /findByIdWithQuestions\(reckoning\.user_id, examSessionId\)/);
  assert.match(start, /!exam\s*\|\|\s*!exam\.is_reckoning/);
  assert.match(start, /status:\s*['"]active['"]/);
  assert.match(start, /status:\s*['"]in_progress['"]/);
  assert.ok(start.indexOf("status: 'active'") < start.lastIndexOf("status: 'in_progress'"));
});

test('Reckoning submission narrowly repairs legacy ready-state split brain', () => {
  const submit = section(
    'async function submitReckoningHandler',
    "brainRouter.post('/reckoning/submit'"
  );
  const linkCheck = submit.indexOf("String(active.exam_session_id) !== String(examId)");
  const repair = submit.indexOf("if (exam.status === 'ready')");
  const strictActiveCheck = submit.indexOf("exam.status !== 'active' || !exam.started_at");
  assert.ok(linkCheck >= 0);
  assert.ok(repair > linkCheck, 'repair must happen only after exact active-Reckoning linkage is proven');
  assert.ok(strictActiveCheck > repair, 'strict active invariant must still be enforced after repair');
  assert.match(submit, /const recoveredStartedAt = new Date\(\)/);
  assert.doesNotMatch(submit, /const recoveredStartedAt = exam\.started_at \|\| new Date\(\)/);
  assert.match(submit, /Recovered linked Reckoning exam stuck in ready state before submit/);
});

test('global Reckoning lockout explicitly allows only the exact linked exam surface', () => {
  const lockout = section(
    'async function reckoningLockout',
    '// ════════════════════════════════════════════════════════════════════════════\n//  AUTH ROUTES'
  );

  assert.match(lockout, /baseUrl\.endsWith\(['"]\/exams['"]\) && active\.exam_session_id/);
  assert.match(lockout, /const firstSegment = pathName\.split\(['"]\/['"]\)\.filter\(Boolean\)\[0\] \|\| ['"]['"]/);
  assert.match(lockout, /String\(firstSegment\) === String\(active\.exam_session_id\)/);
  assert.match(lockout, /if \(String\(firstSegment\) === String\(active\.exam_session_id\)\) return next\(\)/);

  // Normal/past exams must still fall through to the global 423 response.
  const exactExamGate = lockout.indexOf("String(firstSegment) === String(active.exam_session_id)");
  const lockedResponse = lockout.indexOf("res.status(423)");
  assert.ok(exactExamGate >= 0);
  assert.ok(lockedResponse > exactExamGate);
});
