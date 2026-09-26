'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { loadPromptBodyStore, getFrozenPromptBodyRecord } = require('../../../teaching/prompt-runtime/prompt-body-store');
const { getPromptBody, listPromptFamilies } = require('../../../teaching/prompt-runtime/prompt-catalog');
const { createTeachingPromptControlPlane } = require('../../../teaching/prompt-runtime');
const { composeTeachingModelContent } = require('../../../teaching/prompt-runtime/prompt-composer');

const dir = path.resolve(__dirname, '../../../teaching/prompt-runtime/frozen/v1.3');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('all 19 individual frozen bodies have unique exact manifested filenames, versions and bytes', () => {
  const records = loadPromptBodyStore();
  const families = listPromptFamilies();
  assert.equal(records.size, 19);
  assert.equal(new Set(families.map(f => f.promptFile)).size, 19);
  assert.deepEqual(fs.readdirSync(dir).sort(), families.map(f => f.promptFile).sort());
  for (const family of families) {
    const record = getPromptBody(family.id, family.version);
    assert.deepEqual(record, getFrozenPromptBodyRecord(family.id));
    assert.equal(record.promptFile, family.promptFile);
    assert.equal(record.version, family.version);
    assert.equal(hash(fs.readFileSync(path.join(dir, record.promptFile))), family.promptSha256);
    assert.equal(Buffer.byteLength(record.promptText), record.byteLength);
  }
});

test('unknown family, wrong version, altered body and extra files fail closed', () => {
  assert.throws(() => getPromptBody('TPF-20', '1.0'), { code: 'TEACHING_PROMPT_FAMILY_UNKNOWN' });
  const family = listPromptFamilies()[0];
  assert.throws(() => getPromptBody(family.id, '999'), { code: 'TEACHING_PROMPT_VERSION_UNMANIFESTED' });
  const tmp = fs.mkdtempSync(path.join(process.cwd(), 'kiwi-frozen-'));
  try {
    for (const name of fs.readdirSync(dir)) fs.copyFileSync(path.join(dir, name), path.join(tmp, name));
    const file = path.join(tmp, family.promptFile);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('KIWI', 'KIXI'));
    assert.throws(() => loadPromptBodyStore({ directory: tmp }), { code: 'TEACHING_UNMANIFESTED_PROMPT_TEXT_REJECTED' });
    fs.copyFileSync(path.join(dir, family.promptFile), file);
    fs.writeFileSync(path.join(tmp, 'TPF-20_extra.md'), 'unmanifested');
    assert.throws(() => loadPromptBodyStore({ directory: tmp }), { code: 'TEACHING_UNMANIFESTED_PROMPT_TEXT_REJECTED' });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('composition keeps exact frozen bytes separate from untrusted academic data', () => {
  const control = createTeachingPromptControlPlane();
  control.assertReady();
  const capability = control.listCapabilities().find(c => c.authority_ceiling !== 'T0');
  const contract = control.getCapabilityContract(capability.id);
  const invocation = control.createInvocation({ capabilityId: capability.id, taskMode: 'test',
    directive: { bounded_actions: ['interpret'], allowed_operations: ['respond'], prohibited_operations: ['mutate'],
      evidence_purpose: 'test', downstream_handoff: { type: 'validation', validator_ids: ['test'], commit_owner_boundary: capability.authoritative_owner_boundary } },
    contextLanes: { trustedAuthoritativeState: {}, permissionConstraints: {}, provenanceLinkedAcademicContent: [], untrustedContent: [] },
    stateReference: { aggregate_type: 'course', aggregate_id: 'c', state_version: '1' },
    outputSchema: { id: 'test', version: '1', uncertainty_states: ['INSUFFICIENT_EVIDENCE', 'UNRESOLVED_CONFLICT', 'REVIEW_NEEDED'],
      review_needed_field: 'reviewNeeded', state_bearing_fields: [], student_facing_field: null, declared_fields: [], validate: async value => ({ ok: true, value }) },
    audit: { correlation_id: 'test' } });
  const sentinel = 'STUDENT_DATA_SENTINEL';
  const content = composeTeachingModelContent({ invocation, academicInput: { student: sentinel } });
  const body = content.split('<KIWI_TEACHING_FROZEN_PROMPT>\n')[1].split('</KIWI_TEACHING_FROZEN_PROMPT>')[0];
  assert.equal(hash(Buffer.from(body)), getPromptBody(capability.prompt_family_id, contract.promptFamily.version).promptSha256);
  assert.equal(body.includes(sentinel), false);
  assert.ok(content.includes(`<KIWI_TEACHING_ACADEMIC_INPUT_DATA_JSON>\n`));
  assert.ok(content.includes(sentinel));
  assert.ok(content.includes('KIWI_TEACHING_RUNTIME_CONTRACT_JSON'));
});
