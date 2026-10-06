'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const typography = fs.readFileSync(path.join(ROOT, 'public/teaching-typography-system.css'), 'utf8');
const display = fs.readFileSync(path.join(ROOT, 'public/teaching-display.js'), 'utf8');
const interaction = fs.readFileSync(path.join(ROOT, 'public/teaching-interaction-system.js'), 'utf8');

function declarationCount(property, valueFragment) {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedValue = valueFragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (typography.match(new RegExp(`${escapedProperty}\\s*:\\s*[^;]*${escapedValue}[^;]*;`, 'g')) || []).length;
}

test('Teaching display installs the canonical typography stylesheet after the shared UI module is evaluated', () => {
  const uiImport = display.indexOf("import './teaching-ui-system.js");
  const typographyHref = display.indexOf('/teaching-typography-system.css');
  const installCall = display.lastIndexOf('ensureTeachingTypographyStyles();');

  assert.ok(uiImport >= 0, 'Teaching display must still load the shared UI system.');
  assert.ok(typographyHref > uiImport, 'Typography contract must be declared after the UI-system import.');
  assert.ok(installCall > typographyHref, 'Typography stylesheet must be installed by Teaching display.');
  assert.match(display, /data-teaching-typography|dataset\.teachingTypography/);
});

test('Teaching typography contract disables synthetic/stretch rendering and browser text inflation', () => {
  assert.match(typography, /font-synthesis:\s*none\s*!important/);
  assert.match(typography, /font-stretch:\s*normal\s*!important/);
  assert.match(typography, /-webkit-text-size-adjust:\s*100%\s*!important/);
  assert.match(typography, /text-size-adjust:\s*100%\s*!important/);
});

test('Teaching typography has one token owner and future components inherit it without selector registration', () => {
  assert.match(typography, /--font-body:\s*var\(--teaching-font-body\)/);
  assert.match(typography, /--font-display:\s*var\(--teaching-font-display\)/);
  assert.match(typography, /--font-mono:\s*var\(--teaching-font-mono\)/);
  assert.match(typography, /html\[data-app="kiwi-teaching"\]\s+body\s+\*/);
  assert.doesNotMatch(interaction, /fonts\.googleapis\.com/);
  assert.doesNotMatch(interaction, /font-family:\s*var\(--font-/);
  assert.doesNotMatch(interaction, /"DM Sans",sans-serif/);
});

test('Teaching typography contract is cascade-authoritative for semantic type roles', () => {
  assert.doesNotMatch(typography, /:where\(/, 'Zero-specificity typography selectors can be defeated by legacy feature CSS.');
  assert.ok(declarationCount('font-family', '!important') >= 10, 'Semantic roles must authoritatively own their font family.');
  assert.ok(declarationCount('font-size', '!important') >= 9, 'Semantic roles must authoritatively own their font size.');
  assert.ok(declarationCount('font-weight', '!important') >= 9, 'Semantic roles must authoritatively own their font weight.');
  assert.ok(declarationCount('line-height', '!important') >= 9, 'Semantic roles must authoritatively own line height.');
});

test('Teaching typography preserves explicit semantic exceptions for code and mathematical content', () => {
  assert.match(typography, /\.tc-step p/);
  assert.match(typography, /var\(--teaching-font-mono\)\s*!important/);
  assert.match(typography, /html\[data-app="kiwi-teaching"\]\s+\.tc-math/);
  assert.match(typography, /\.tc-math[\s\S]*var\(--teaching-font-body\)\s*!important/);
});
