'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('Teaching runtime loads Results before the original-shell information bridge', () => {
  const runtime = read('public/kiwi-runtime-config.js');
  const d15 = runtime.indexOf("import('/teaching-d15.js')");
  const bridge = runtime.indexOf("import('/teaching-original-bridge.js')");
  assert.ok(d15 >= 0, 'D15 Results/Record projection must load for Teaching');
  assert.ok(bridge > d15, 'original-shell information bridge must load after D15');
});

test('original Teaching shell exposes accepted secondary and Course surfaces without replacing the shell', () => {
  const bridge = read('public/teaching-original-bridge.js');
  const html = read('public/teaching.html');

  assert.match(bridge, /registerSection\(\{ id:'teacher', label:'Teacher'/);
  assert.match(bridge, /id:'archive', label:'Archived Courses'/);
  assert.match(bridge, /id:'study-packs', label:'Study Packs'/);
  assert.match(bridge, /id:'record', label:'Record'/);

  assert.match(bridge, /\/teaching\/information\/archive/);
  assert.match(bridge, /\/teaching\/information\/study/);
  assert.match(bridge, /\/teaching\/information\/courses\/\$\{encodeURIComponent\(courseId\)\}\/overview/);
  assert.match(bridge, /\/teaching\/information\/courses\/\$\{encodeURIComponent\(courseId\)\}\/materials/);
  assert.match(bridge, /\/teaching\/information\/record/);
  assert.match(bridge, /\/teaching\/record\/attendance/);

  assert.match(bridge, /\/teacher\/interaction-profile/);
  assert.match(bridge, /\/teacher\/questions/);
  assert.match(bridge, /\/teacher\/change-request/);

  assert.doesNotMatch(bridge, /registerSection\(\{\s*id:'materials'/);
  assert.doesNotMatch(html, /teaching\/d23\/ui|teaching-d23|information-architecture/i);
});

test('Study Packs are user-opened and never navigate while rendering their Course groups', () => {
  const bridge = read('public/teaching-original-bridge.js');
  assert.doesNotMatch(bridge, /if\s*\(openCourse\(group\.courseId\)\)/);
  assert.match(bridge, /action\('Open Course', \(\) => openCourse\(group\.courseId\)\)/);
  assert.match(bridge, /action\('Open Pack', \(\) => showStudyPack\(pack, group\)\)/);
});

test('primary dock remains the original-shell compact Courses Calendar Work Record Menu model', () => {
  const bridge = read('public/teaching-original-bridge.js');
  for (const label of ['Courses','Calendar','Work','Record','Menu']) {
    assert.match(bridge, new RegExp(`dockItem\\('[^']+'\\s*,\\s*'${label}'`));
  }
  assert.doesNotMatch(bridge, /dockItem\('archive'/);
  assert.doesNotMatch(bridge, /dockItem\('study-packs'/);
  assert.doesNotMatch(bridge, /dockItem\('requests'/);
});

test('Course Overview keeps Materials and Study Packs contextual while Teacher is a Course tab', () => {
  const bridge = read('public/teaching-original-bridge.js');
  assert.match(bridge, /action\('Course Materials', \(\) => showMaterials\(courseId\)\)/);
  assert.match(bridge, /action\('Study Packs', \(\) => \{ state\.studyCourseId = courseId; nav\.open\('study-packs'\); \}\)/);
  assert.match(bridge, /action\('Teacher', \(\) => openCourse\(courseId, 'teacher'\)\)/);
  assert.match(bridge, /data-course-materials/);
});
