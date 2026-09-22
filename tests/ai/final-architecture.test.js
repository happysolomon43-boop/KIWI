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

test('Gemini model IDs remain centralized in the model catalog', () => {
  for (const file of productionJs) {
    const relative = rel(file);
    if (relative === 'services/ai/model-catalog.js') continue;

    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(
      source,
      /gemini-\d+(?:\.\d+)+(?:-[a-z0-9-]+)/i,
      `${relative} must not hard-code a versioned Gemini model ID`
    );
  }
});

test('only the Gemini transport knows the provider HTTP endpoint', () => {
  for (const file of productionJs) {
    const relative = rel(file);
    const source = fs.readFileSync(file, 'utf8');

    if (relative === 'services/ai/gemini-transport.js') {
      assert.match(source, /generativelanguage\.googleapis\.com/);
    } else {
      assert.doesNotMatch(
        source,
        /generativelanguage\.googleapis\.com/,
        `${relative} must not call Gemini directly`
      );
    }
  }
});

test('only the project pool discovers Gemini API-key environment variables', () => {
  for (const file of productionJs) {
    const relative = rel(file);
    const source = fs.readFileSync(file, 'utf8');

    if (relative === 'services/ai/project-pool.js') {
      assert.match(source, /GEMINI_API_KEY/);
    } else {
      assert.doesNotMatch(
        source,
        /GEMINI_API_KEY(?:_\d+)?/,
        `${relative} must not read Gemini API keys`
      );
    }
  }
});

test('feature code cannot reintroduce provider thinking/model overrides or legacy wrapper calls', () => {
  for (const file of productionJs) {
    const relative = rel(file);
    if (relative.startsWith('services/ai/')) continue;

    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /thinkingConfig/, `${relative} bypasses task reasoning policy`);
    assert.doesNotMatch(source, /modelOverride/, `${relative} bypasses model routing policy`);
    assert.doesNotMatch(source, /geminiModel\.generateContent/, `${relative} bypasses the orchestrator`);
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
    assert.match(
      indexSource,
      new RegExp(`\\b${taskId}\\b`),
      `${taskId} is registered but no longer wired into index.js`
    );
  }
});
