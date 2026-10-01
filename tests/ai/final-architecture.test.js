'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const { AI_TASKS } = require('../../services/ai/task-registry');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'tests'].includes(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(absolute));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(absolute);
  }
  return out;
}

function rel(file) {
  return path.relative(root, file).replace(/\\/g, '/');
}

const productionJs = walk(root);

test('versioned Gemini model IDs remain centralized in the active model catalog', () => {
  for (const file of productionJs) {
    const relative = rel(file);
    if (['services/ai/model-catalog.js', 'services/ai/model-history.js'].includes(relative)) continue;
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(
      source,
      /gemini-\d+(?:\.\d+)+(?:-[a-z0-9-]+)/i,
      `${relative} must not hard-code a versioned Gemini model ID`
    );
  }
});

test('only the raw Google HTTP transport knows the Google provider endpoint', () => {
  for (const file of productionJs) {
    const relative = rel(file);
    const source = fs.readFileSync(file, 'utf8');
    if (relative === 'services/ai/google-http-transport.js') {
      assert.match(source, /generativelanguage\.googleapis\.com/);
    } else {
      assert.doesNotMatch(source, /generativelanguage\.googleapis\.com/, `${relative} bypasses the Google adapter boundary`);
    }
  }
});

test('provider credential environment variables are discovered only by the credential registry', () => {
  for (const file of productionJs) {
    const relative = rel(file);
    const source = fs.readFileSync(file, 'utf8');
    const containsCredentialName = /GEMINI_API_KEY(?:_\d+)?|GROQ_API_KEY(?:_\d+)?|CLOUDFLARE_WORKERS_AI_API_TOKEN(?:_\d+)?/.test(source);
    if (!containsCredentialName) continue;
    assert.equal(
      relative,
      'services/ai/credential-registry.js',
      `${relative} must not discover provider credentials directly`
    );
  }
});

test('feature code cannot inject provider-native payloads, providers, or model overrides', () => {
  for (const file of productionJs) {
    const relative = rel(file);
    if (relative.startsWith('services/ai/')) continue;
    const source = fs.readFileSync(file, 'utf8');

    assert.doesNotMatch(source, /thinkingConfig|reasoning_effort|max_completion_tokens/, `${relative} leaks provider-native reasoning`);
    assert.doesNotMatch(source, /\binlineData\b/, `${relative} constructs Google image payloads directly`);
    assert.doesNotMatch(source, /\bVISION_ROUTES\b/, `${relative} reintroduces a separate vision route`);
    assert.doesNotMatch(source, /\bpreferredModelId\b|\bmodelOverride\b/, `${relative} bypasses central model routing`);
    assert.doesNotMatch(source, /gemini-\d+(?:\.\d+)+|qwen\/qwen|@cf\/black-forest-labs/i, `${relative} hard-codes an AI model`);
    assert.doesNotMatch(source, /createGeminiTransport|createProjectPool|runIsolatedProvider/, `${relative} imports migration-era execution architecture`);
  }
});

test('the public AI module does not export migration-era runtimes', () => {
  const source = fs.readFileSync(path.join(root, 'services/ai/index.js'), 'utf8');
  for (const forbidden of [
    'createProjectPool',
    'createGroqCredentialPool',
    'createGeminiTransport',
    'runIsolatedProvider',
    'VISION_ROUTES',
    'createMediaCapabilityRuntime',
    'createDefaultMediaCapabilityRuntime',
    'createVisualCapabilityRuntime',
    'createDefaultVisualCapabilityRuntime',
  ]) {
    assert.doesNotMatch(source, new RegExp(`\\b${forbidden}\\b`), `public AI index still exposes ${forbidden}`);
  }
});


test('migration-era runtime modules are physically retired from production source', () => {
  for (const relative of [
    'services/ai/capability-adapter.js',
    'services/ai/gemini-transport.js',
    'services/ai/isolated-provider-executor.js',
    'services/ai/media-capability-factory.js',
    'services/ai/media-capability-runtime.js',
    'services/ai/media-model-catalog.js',
    'services/ai/media-telemetry.js',
    'services/ai/project-pool.js',
    'services/ai/visual-capability-factory.js',
    'services/ai/visual-capability-runtime.js',
    'services/ai/visual-model-catalog.js',
    'services/ai/visual-telemetry.js',
  ]) {
    assert.equal(fs.existsSync(path.join(root, relative)), false, `${relative} must remain retired`);
  }
});

test('every statically referenced ai.run task is registered', () => {
  const registered = new Set(Object.keys(AI_TASKS));
  const referenced = new Set();

  for (const file of productionJs) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bai\.run\(\s*['"]([A-Z0-9_]+)['"]/g)) {
      referenced.add(match[1]);
      assert.ok(registered.has(match[1]), `${rel(file)} uses unregistered AI task ${match[1]}`);
    }
  }

  assert.ok(referenced.size > 0, 'expected static ai.run task references');
});

test('all canonical task IDs remain wired into production code', () => {
  const indexSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
  for (const taskId of Object.keys(AI_TASKS)) {
    assert.match(indexSource, new RegExp(`\\b${taskId}\\b`), `${taskId} is registered but no longer wired into index.js`);
  }
});
