'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const {
  loadPromptBodyStore,
  getFrozenPromptBodyRecord,
} = require('../../../teaching/prompt-runtime/prompt-body-store');
const {
  getPromptBody,
  listPromptFamilies,
} = require('../../../teaching/prompt-runtime/prompt-catalog');
const { createTeachingPromptControlPlane } = require('../../../teaching/prompt-runtime');
const { composeTeachingModelContent } = require('../../../teaching/prompt-runtime/prompt-composer');

const historicalDir = path.resolve(__dirname, '../../../teaching/prompt-runtime/frozen/v1.3');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('all 20 frozen bodies are exact while the historical 19-file directory remains unchanged', () => {
  const records = loadPromptBodyStore();
  const families = listPromptFamilies();
  const historicalFamilies = families.filter(f => f.id !== 'TPF-20');

  assert.equal(records.size, 20);
  assert.equal(families.length, 20);
  assert.equal(new Set(families.map(f => f.promptFile)).size, 20);
  assert.equal(historicalFamilies.length, 19);
  assert.deepEqual(
    fs.readdirSync(historicalDir).sort(),
    historicalFamilies.map(f => f.promptFile).sort()
  );

  for (const family of families) {
    const record = getPromptBody(family.id, family.version);
    assert.deepEqual(record, getFrozenPromptBodyRecord(family.id));
    assert.equal(record.promptFile, family.promptFile);
    assert.equal(record.version, family.version);
    assert.equal(hash(Buffer.from(record.promptText, 'utf8')), family.promptSha256);
    assert.equal(Buffer.byteLength(record.promptText), record.byteLength);
    if (family.id !== 'TPF-20') {
      assert.equal(hash(fs.readFileSync(path.join(historicalDir, record.promptFile))), family.promptSha256);
      assert.equal(record.storage, 'individual_utf8_file');
    } else {
      assert.equal(record.storage, 'gzip_base64_repository_asset');
      assert.equal(record.promptSha256, 'd8d13f679e6817c1c02935e6581f5fc6ad512812004b59eebcf9a7d85c962e67');
    }
  }
});

test('unknown family, wrong version, altered historical body and extra historical files fail closed', () => {
  assert.throws(() => getPromptBody('TPF-21', '1.0'), { code: 'TEACHING_PROMPT_FAMILY_UNKNOWN' });
  const family = listPromptFamilies().find(f => f.id !== 'TPF-20');
  assert.throws(() => getPromptBody(family.id, '999'), { code: 'TEACHING_PROMPT_VERSION_UNMANIFESTED' });
  const tmp = fs.mkdtempSync(path.join(process.cwd(), 'kiwi-frozen-'));
  try {
    for (const name of fs.readdirSync(historicalDir)) {
      fs.copyFileSync(path.join(historicalDir, name), path.join(tmp, name));
    }
    const file = path.join(tmp, family.promptFile);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('KIWI', 'KIXI'));
    assert.throws(
      () => loadPromptBodyStore({ directory: tmp }),
      { code: 'TEACHING_UNMANIFESTED_PROMPT_TEXT_REJECTED' }
    );
    fs.copyFileSync(path.join(historicalDir, family.promptFile), file);
    fs.writeFileSync(path.join(tmp, 'TPF-99_extra.md'), 'unmanifested');
    assert.throws(
      () => loadPromptBodyStore({ directory: tmp }),
      { code: 'TEACHING_UNMANIFESTED_PROMPT_TEXT_REJECTED' }
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('TPF-20 compressed repository asset fails closed if its exact frozen bytes are altered', () => {
  const asset = path.resolve(
    __dirname,
    '../../../teaching/prompt-runtime/frozen/TPF-20_Class_Grounded_Study_Note_v1.0_DESIGN_FROZEN.md.gz.b64'
  );
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'kiwi-tpf20-'));
  const tmpAsset = path.join(tmpDir, 'TPF-20_Class_Grounded_Study_Note_v1.0_DESIGN_FROZEN.md.gz.b64');
  try {
    const encoded = fs.readFileSync(asset, 'utf8').trim();
    const bytes = zlib.gunzipSync(Buffer.from(encoded, 'base64'));
    const altered = Buffer.from(bytes);
    altered[altered.length - 1] = altered[altered.length - 1] ^ 1;
    fs.writeFileSync(tmpAsset, zlib.gzipSync(altered).toString('base64'));
    assert.throws(
      () => loadPromptBodyStore({ tpf20Asset: tmpAsset }),
      { code: 'TEACHING_UNMANIFESTED_PROMPT_TEXT_REJECTED' }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('composition keeps exact frozen bytes separate from untrusted academic data', () => {
  const control = createTeachingPromptControlPlane();
  control.assertReady();
  const capability = control.listCapabilities().find(c => c.authority_ceiling !== 'T0');
  const contract = control.getCapabilityContract(capability.id);
  const invocation = control.createInvocation({
    capabilityId: capability.id,
    taskMode: 'test',
    directive: {
      bounded_actions: ['interpret'],
      allowed_operations: ['respond'],
      prohibited_operations: ['mutate'],
      evidence_purpose: 'test',
      downstream_handoff: {
        type: 'validation',
        validator_ids: ['test'],
        commit_owner_boundary: capability.authoritative_owner_boundary,
      },
    },
    contextLanes: {
      trustedAuthoritativeState: {},
      permissionConstraints: {},
      provenanceLinkedAcademicContent: [],
      untrustedContent: [],
    },
    stateReference: { aggregate_type: 'course', aggregate_id: 'c', state_version: '1' },
    outputSchema: {
      id: 'test',
      version: '1',
      uncertainty_states: ['INSUFFICIENT_EVIDENCE', 'UNRESOLVED_CONFLICT', 'REVIEW_NEEDED'],
      review_needed_field: 'reviewNeeded',
      state_bearing_fields: [],
      student_facing_field: null,
      declared_fields: [],
      validate: async value => ({ ok: true, value }),
    },
    audit: { correlation_id: 'test' },
  });
  assert.throws(
    () => composeTeachingModelContent({ invocation, academicInput: { text: 'x'.repeat(65536) } }),
    { code: 'TEACHING_ACADEMIC_INPUT_INVALID' }
  );
  const sentinel = 'STUDENT_DATA_SENTINEL';
  const content = composeTeachingModelContent({ invocation, academicInput: { student: sentinel } });
  const body = content
    .split('<KIWI_TEACHING_FROZEN_PROMPT>\n')[1]
    .split('</KIWI_TEACHING_FROZEN_PROMPT>')[0];
  assert.equal(
    hash(Buffer.from(body)),
    getPromptBody(capability.prompt_family_id, contract.promptFamily.version).promptSha256
  );
  assert.equal(body.includes(sentinel), false);
  assert.ok(content.includes('<KIWI_TEACHING_ACADEMIC_INPUT_DATA_JSON>\n'));
  assert.ok(content.includes(sentinel));
  assert.ok(content.includes('KIWI_TEACHING_RUNTIME_CONTRACT_JSON'));
});

test('TPF-20 can compose through the same central structural prompt path without route qualification', () => {
  const control = createTeachingPromptControlPlane();
  control.assertReady();
  const capability = control.getCapability('teaching.study.class_grounded_note_generation');
  const invocation = control.createInvocation({
    capabilityId: capability.id,
    taskMode: 'PRE_CLASS_NOTE_PREPARATION',
    directive: {
      bounded_actions: ['prepare_grounded_note_draft'],
      allowed_operations: ['prepare_grounded_note_draft'],
      prohibited_operations: ['publish_note', 'mutate_authoritative_state'],
      evidence_purpose: 'class_grounded_study_note',
      downstream_handoff: {
        type: 'independent_validation',
        validator_ids: ['study-note-validator'],
        commit_owner_boundary: capability.authoritative_owner_boundary,
      },
    },
    contextLanes: {
      trustedAuthoritativeState: {},
      permissionConstraints: {},
      provenanceLinkedAcademicContent: [],
      untrustedContent: [],
    },
    stateReference: {
      aggregate_type: 'class',
      aggregate_id: 'class-1',
      state_version: '1',
      precondition_token: 'class-1:1',
    },
    outputSchema: {
      id: 'study.note.test',
      version: '1',
      uncertainty_states: ['INSUFFICIENT_EVIDENCE', 'UNRESOLVED_CONFLICT', 'REVIEW_NEEDED'],
      review_needed_field: 'reviewNeeded',
      state_bearing_fields: [],
      student_facing_field: null,
      declared_fields: ['reviewNeeded'],
      validate: async value => ({ ok: true, value }),
    },
    audit: { correlation_id: 'tpf20-test' },
  });

  assert.equal(invocation.prompt.family_id, 'TPF-20');
  assert.equal(invocation.capability.authority_ceiling, 'T3');
  assert.equal(invocation.route_control.qualificationStatus, 'UNQUALIFIED');
  assert.equal(invocation.route_control.productionAuthorized, false);
  const content = composeTeachingModelContent({
    invocation,
    academicInput: { lesson_plan_ref: 'lesson-1@4' },
  });
  const body = content
    .split('<KIWI_TEACHING_FROZEN_PROMPT>\n')[1]
    .split('</KIWI_TEACHING_FROZEN_PROMPT>')[0];
  assert.equal(hash(Buffer.from(body)), 'd8d13f679e6817c1c02935e6581f5fc6ad512812004b59eebcf9a7d85c962e67');
});
