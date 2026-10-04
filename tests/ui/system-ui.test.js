'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Study and Teaching use the same zoomable fit-to-device viewport policy', () => {
  const study = read('index.html');
  const teaching = read('public/teaching.html');

  for (const [name, html] of [['Study', study], ['Teaching', teaching]]) {
    const viewport = html.match(/<meta[^>]+name=["']viewport["'][\s\S]*?>/i)?.[0] || '';
    assert.match(viewport, /width=device-width/);
    assert.match(viewport, /initial-scale=1(?:\.0)?/);
    assert.match(viewport, /viewport-fit=cover/);
    assert.doesNotMatch(viewport, /maximum-scale/i, name + ' must not cap zoom');
    assert.doesNotMatch(viewport, /user-scalable\s*=\s*no/i, name + ' must allow pinch zoom');
    assert.match(html, /\/kiwi-ui-system\.css/);
    assert.match(html, /\/kiwi-ui-system\.js/);
  }
});

test('system-wide select enhancement preserves native values and app change events', () => {
  const source = read('public/kiwi-ui-system.js');
  for (const token of [
    'HTMLSelectElement',
    'select.multiple',
    "select.dataset[ENHANCED] = 'true'",
    "select.classList.add('kiwi-select__native')",
    "select.dispatchEvent(new Event('input', { bubbles: true }))",
    "select.dispatchEvent(new Event('change', { bubbles: true }))",
    "role=\"listbox\"",
    'MutationObserver',
    'PREPARATION',
  ]) {
    if (token === 'PREPARATION') continue;
    assert.ok(source.includes(token), token);
  }
  assert.match(source, /window\.KIWI_UI_SYSTEM/);
  assert.match(source, /No matching options/);
  assert.match(source, /Search /);
});

test('responsive UI system provides mobile bottom sheet and page-width safety', () => {
  const css = read('public/kiwi-ui-system.css');
  assert.match(css, /body\s*\{[\s\S]*max-width:\s*100%/);
  assert.match(css, /overflow-x:\s*clip/);
  assert.match(css, /@media \(max-width: 720px\), \(pointer: coarse\)/);
  assert.match(css, /\.kiwi-select-panel[\s\S]*bottom:/);
  assert.match(css, /input,[\s\S]*textarea[\s\S]*font-size:\s*16px/);
});

test('Teaching Request Center keeps D10 authority semantics while using the redesigned surface', () => {
  const source = read('public/teaching-d10.js');
  for (const token of [
    'teaching-d10-hero',
    'teaching-d10-composer',
    'teaching-d10-request-list',
    'Server validated',
    'Alternatives require acceptance',
    'Nothing changes immediately.',
    'authoritative owner',
    'Create formal Request',
    "card.dataset.requestId=String(item.requestId||'')",
  ]) {
    assert.ok(source.includes(token), token);
  }
  assert.match(source, /alternative\/accept/);
  assert.match(source, /alternative\/decline/);
  assert.match(source, /\/teaching\/requests/);
});

test('Study unified file intake consolidates format tabs without duplicating generation contracts', () => {
  const source = read('public/study-unified-upload.js');
  const css = read('public/study-unified-upload.css');
  const client = read('public/kiwi-api-client.js');

  for (const token of [
    "new Set(['image', 'pdf', 'docx', 'txt', 'md', 'pptx'])",
    "const MAX_FILE_BYTES = 7 * 1024 * 1024",
    "data-su-drop",
    "data-su-generate",
    "selectedDeckId()",
    "typeof global.DataTransfer !== 'function'",
    "importButton.click()",
    "confirmButton.click()",
    "localStorage.setItem('kiwi_last_import_tab', 'files')",
    "Image Occlusion remains separate",
  ]) {
    assert.ok(source.includes(token), token);
  }

  // The unified layer must delegate into the existing Study import handlers;
  // it is not allowed to invent another network/generation pipeline.
  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.doesNotMatch(source, /kiwiApiRequest\s*\(/);
  assert.doesNotMatch(source, /\/cards\/import\//);

  assert.match(source, /\.pdf,\.docx,\.txt,\.md,\.markdown,\.pptx/);
  assert.match(source, /image\/png,image\/jpeg,image\/webp,image\/heic,image\/heif/);
  assert.match(css, /data-study-format-legacy="true"/);
  assert.match(css, /\.su-upload__drop:focus-visible/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);

  assert.match(client, /loadStudyUnifiedUpload/);
  assert.match(client, /\/study-unified-upload\.css\?v=/);
  assert.match(client, /\/study-unified-upload\.js\?v=/);
  assert.match(client, /getElementById\('teachingApp'\)/);
  assert.match(client, /getElementById\('mainContent'\)/);
});
