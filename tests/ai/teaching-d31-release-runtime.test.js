'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTeachingPromptControlPlane } = require('../../teaching/prompt-runtime');
const { createD31ReleaseOrchestrator } = require('../../teaching/d31/release-orchestrator');
const { curriculumAuditRequest } = require('../../teaching/d07/intelligence');

test('D31 curriculum audit reaches the central boundary through D05 with registered authority and source context', async () => {
  const course = { course_id: 'course-1', student_id: 'student-1', state_version: 1, lifecycle_state: 'DRAFT', subject_snapshot_ref: 'subject:1:scope' };
  const source = { source_content_item_id: 'source-1', student_id: 'student-1', course_id: 'course-1', source_kind: 'PRIMARY_KIWI_SUBJECT', source_ref: 'subject:1:card:1', content_summary: 'Nutrition source text' };
  const seen = [];
  const rows = new Map();
  const runtimePlatform = {
    promptControl: createTeachingPromptControlPlane(),
    aiBoundary: { async execute(input) { seen.push(input); return { accepted: false }; } },
    orchestrationStore: {
      async begin(envelope) { rows.set(envelope.execution_id, { status: 'PENDING' }); return { inserted: true }; },
      async mark(id, status) { rows.get(id).status = status; },
    },
  };
  const query = async (sql, params) => {
    if(sql.includes('teaching_runtime.academic_authority_revocations'))return {rows:[]};
    if (sql.includes('public.teaching_courses')) return { rows: params[0] === 'student-1' && params[1] === 'course-1' ? [course] : [] };
    if (sql.includes('public.teaching_source_content_items')) return { rows: params[0] === 'student-1' && params[1] === 'course-1' && params[2] === 'source-1' ? [source] : [] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  const orchestrator = createD31ReleaseOrchestrator({ runtimePlatform, query, randomUUID: () => 'execution-1' });
  const result = await orchestrator.execute(curriculumAuditRequest({ course, sources: [source] }));
  assert.equal(result.accepted, false);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].intelligenceClass, 'DIRECT-AI');
  assert.equal(seen[0].authorityLevel, 'T3');
  assert.match(seen[0].request.content, /Nutrition source text/);
  assert.equal(rows.get('execution-1').status, 'NOOP');
});
