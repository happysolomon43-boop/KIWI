'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(root, relative));

test('original Teaching document loads Work, Results and D23 as independent ordered modules', () => {
  const entry = read('public/teaching-d16.js');
  const core = read('public/teaching-d16-core.js');
  const html = read('public/teaching.html');
  const runtime = read('public/kiwi-runtime-config.js');

  assert.match(entry, /import '\.\/teaching-d16-core\.js\?v=20261003-runtime-fix-1';/);
  assert.doesNotMatch(entry, /\bimport\s*\(/);
  const d16Import = html.indexOf('/teaching-d16.js?v=20261003-runtime-fix-1');
  const d15Import = html.indexOf('/teaching-d15.js?v=20261003-runtime-fix-1');
  const d23Import = html.indexOf('/teaching-d23.js?v=20261003-runtime-fix-1');
  assert.ok(d16Import >= 0, 'Work module must be loaded by the Teaching document');
  assert.ok(d15Import > d16Import, 'Results must load after Work');
  assert.ok(d23Import > d15Import, 'D23 composition must load after Results');
  assert.match(core, /nav\.register\(\{id:'work'/);
  assert.doesNotMatch(runtime, /teaching-bootstrap|teaching-original-bridge|teaching-d15\.js|teaching-d23\.js/);
  assert.equal(exists('public/teaching-bootstrap.js'), false);
  assert.equal(exists('public/teaching-original-bridge.js'), false);
  assert.equal(exists('public/teaching-d15.js'), true);
  assert.equal(exists('public/teaching-d23.js'), true);
});

test('every directly loaded Teaching feature module parses before deployment', () => {
  for (const relative of [
    'public/teaching-d08.js',
    'public/teaching-d09.js',
    'public/teaching-d10.js',
    'public/teaching-classroom.js',
    'public/teaching-d16-core.js',
    'public/teaching-d15.js',
    'public/teaching-d23.js',
  ]) {
    assert.doesNotThrow(() => new vm.Script(read(relative), { filename: relative }));
  }
});

test('retired Teaching bridge and polish loaders cannot run from the active module graph', () => {
  const d09 = read('public/teaching-d09.js');
  assert.doesNotMatch(d09, /teaching-original-bridge|teaching-original-polish/);
});

test('original Teaching shell exposes accepted secondary and Course surfaces without replacing the shell', () => {
  const d23 = read('public/teaching-d23.js');
  const html = read('public/teaching.html');

  assert.match(d23, /registerSection\(\{ id:'teacher', label:'Teacher'/);
  assert.match(d23, /id:'archive', label:'Archived Courses'/);
  assert.match(d23, /id:'study-packs', label:'Study Packs'/);
  assert.match(d23, /id:'record', label:'Record'/);

  assert.match(d23, /\/teaching\/information\/archive/);
  assert.match(d23, /\/teaching\/information\/study/);
  assert.match(d23, /\/teaching\/information\/courses\/\$\{encodeURIComponent\(courseId\)\}\/overview/);
  assert.match(d23, /\/teaching\/information\/courses\/\$\{encodeURIComponent\(courseId\)\}\/materials/);
  assert.match(d23, /\/teaching\/information\/record/);
  assert.match(d23, /\/teaching\/record\/attendance/);

  assert.match(d23, /\/teacher\/interaction-profile/);
  assert.match(d23, /\/teacher\/questions/);
  assert.match(d23, /\/teacher\/change-request/);

  assert.doesNotMatch(d23, /registerSection\(\{\s*id:'materials'/);
  assert.doesNotMatch(html, /teaching-d23-live|class="d23-shell"/i);
  assert.match(html, /id="teachingApp"/);
});

test('Study Packs are user-opened and never navigate while rendering their Course groups', () => {
  const d23 = read('public/teaching-d23.js');
  assert.doesNotMatch(d23, /if\s*\(openCourse\(group\.courseId\)\)/);
  assert.match(d23, /action\('Open Course', \(\) => openCourse\(group\.courseId\)\)/);
  assert.match(d23, /action\('Open Pack', \(\) => showStudyPack\(pack, group\)\)/);
});

test('primary dock remains the original-shell compact Courses Calendar Work Record Menu model', () => {
  const d23 = read('public/teaching-d23.js');
  for (const label of ['Courses','Calendar','Work','Record','Menu']) {
    assert.match(d23, new RegExp(`dockItem\\('[^']+'\\s*,\\s*'${label}'`));
  }
  assert.doesNotMatch(d23, /dockItem\('archive'/);
  assert.doesNotMatch(d23, /dockItem\('study-packs'/);
  assert.doesNotMatch(d23, /dockItem\('requests'/);
});

test('Course Overview keeps Materials and Study Packs contextual while Teacher is a Course tab', () => {
  const d23 = read('public/teaching-d23.js');
  assert.match(d23, /action\('Course Materials', \(\) => showMaterials\(courseId\)\)/);
  assert.match(d23, /action\('Study Packs', \(\) => \{ state\.studyCourseId = courseId; nav\.open\('study-packs'\); \}\)/);
  assert.match(d23, /action\('Teacher', \(\) => openCourse\(courseId, 'teacher'\)\)/);
  assert.match(d23, /data-course-materials/);
});
