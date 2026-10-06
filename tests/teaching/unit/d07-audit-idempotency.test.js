'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  sourceInventoryDigest,
  currentValidatedAudit,
  decorateAuditIdempotency,
} = require('../../../teaching/d07/audit-idempotency-service');

function setupFixture() {
  const course = {
    course_id: 'course-1',
    state_version: 2,
  };
  const sources = [
    { source_ref: 'source-a', content_hash: 'hash-a' },
    { source_ref: 'source-b', content_hash: 'hash-b' },
  ];
  const inventoryDigest = sourceInventoryDigest(sources);
  const curriculumAudit = {
    curriculum_audit_id: 'audit-1',
    prompt_family_version: '1.1',
    output_schema_version: '2',
    status: 'VALIDATED_CANDIDATE',
    input_state_reference: 'teaching_course:course-1:state:2',
    source_inventory_digest: inventoryDigest,
    validation_metadata: {
      state_version: '2',
      source_census: 2,
      domain_validated: true,
      lineage_reconciled: true,
    },
  };
  return { course, sources, curriculumAudit };
}

test('D07 recognizes only a validated audit for the exact current state and source digest', () => {
  const setup = setupFixture();
  assert.equal(currentValidatedAudit(setup)?.curriculum_audit_id, 'audit-1');

  const changedSource = setupFixture();
  changedSource.sources[1] = { ...changedSource.sources[1], content_hash: 'hash-b-v2' };
  assert.equal(currentValidatedAudit(changedSource), null);

  const changedState = setupFixture();
  changedState.course = { ...changedState.course, state_version: 3 };
  assert.equal(currentValidatedAudit(changedState), null);

  const failedValidation = setupFixture();
  failedValidation.curriculumAudit = {
    ...failedValidation.curriculumAudit,
    validation_metadata: {
      ...failedValidation.curriculumAudit.validation_metadata,
      domain_validated: false,
    },
  };
  assert.equal(currentValidatedAudit(failedValidation), null);
});

test('D07 retry returns the already-persisted current audit without invoking AI again', async () => {
  let modelBackedRuns = 0;
  const setup = setupFixture();
  const service = {
    async getSetup() { return setup; },
    async runAudit() {
      modelBackedRuns += 1;
      return { curriculum_audit_id: 'audit-new' };
    },
  };
  const decorated = decorateAuditIdempotency(service);
  const audit = await decorated.runAudit({ id: 'student-1' }, 'course-1');
  assert.equal(audit.curriculum_audit_id, 'audit-1');
  assert.equal(modelBackedRuns, 0);
});

test('D07 performs a new audit when current Course sources no longer match the persisted artifact', async () => {
  let modelBackedRuns = 0;
  const setup = setupFixture();
  setup.sources[0] = { ...setup.sources[0], content_hash: 'changed-hash' };
  const service = {
    async getSetup() { return setup; },
    async runAudit() {
      modelBackedRuns += 1;
      return { curriculum_audit_id: 'audit-new' };
    },
  };
  const decorated = decorateAuditIdempotency(service);
  const audit = await decorated.runAudit({ id: 'student-1' }, 'course-1');
  assert.equal(audit.curriculum_audit_id, 'audit-new');
  assert.equal(modelBackedRuns, 1);
});

test('D07 service composition applies audit idempotency before truncation recovery', () => {
  const source = fs.readFileSync(require.resolve('../../../teaching/d07'), 'utf8');
  assert.match(source, /decorateAuditIdempotency\(unique\)/);
  assert.match(source, /decorateTruncationRecovery\(idempotent/);
});

 test('D07 rebuilds a current-state legacy audit instead of reusing pre-Lineage-Law output', async () => {
   const setup = setupFixture();
   setup.curriculumAudit.prompt_family_version = '1.0';
   setup.curriculumAudit.output_schema_version = 'tpf02.curriculum-audit.v1';
   let runs = 0;
   const service = decorateAuditIdempotency({ async getSetup() { return setup; }, async runAudit() { runs++; return {curriculum_audit_id: 'v1.1-audit'}; } });
   assert.equal(currentValidatedAudit(setup), null);
   assert.equal((await service.runAudit({id:'student-1'}, 'course-1')).curriculum_audit_id, 'v1.1-audit');
   assert.equal(runs, 1);
   const unreconciled = setupFixture();
   unreconciled.curriculumAudit.validation_metadata.lineage_reconciled = false;
   assert.equal(currentValidatedAudit(unreconciled), null);
 });
