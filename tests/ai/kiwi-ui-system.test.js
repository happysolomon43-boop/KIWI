'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const jsPath = path.join(root, 'public/kiwi-ui-system.js');
const cssPath = path.join(root, 'public/kiwi-ui-system.css');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

test('system-wide selector runtime remains syntactically valid', () => {
  assert.doesNotThrow(() => new vm.Script(read(jsPath), { filename: jsPath }));
});

test('system-wide selectors anchor to their field on touch/mobile by default', () => {
  const js = read(jsPath);
  const css = read(cssPath);

  assert.match(js, /function panelModeFor\(select\)/);
  assert.match(js, /return select\?\.dataset\?\.kiwiSelectMode === 'sheet' \? 'sheet' : 'anchored'/);
  assert.match(js, /portal\.dataset\.placement = placeAbove \? 'above' : 'below'/);
  assert.match(js, /window\.visualViewport\?\.addEventListener\('resize', positionPanel/);

  assert.doesNotMatch(js, /MOBILE_QUERY/);
  assert.doesNotMatch(js, /matchMedia\([^\n]*pointer:\s*coarse[^\n]*\)\.matches/);

  // Touch/mobile sizing remains, but it must no longer force every panel to
  // bottom:...; bottom-sheet styling is explicit opt-in only.
  assert.match(css, /\.kiwi-select-portal\[data-mode="sheet"\] \.kiwi-select-panel/);
  assert.match(css, /data-kiwi-select-mode="sheet"/);
  const mobileBlock = css.match(/@media \(max-width: 720px\), \(pointer: coarse\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(mobileBlock, /bottom\s*:/);
  assert.doesNotMatch(mobileBlock, /top:\s*auto/);
});

test('selector can flip above when there is not enough room below', () => {
  const js = read(jsPath);
  assert.match(js, /availableBelow < preferredMinimum && availableAbove > availableBelow/);
  assert.match(js, /rect\.top - gap - measuredHeight/);
  assert.match(js, /rect\.bottom \+ gap/);
});
