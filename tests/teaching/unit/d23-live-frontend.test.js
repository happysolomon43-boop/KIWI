'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'../../..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

const REQUIRED_LEGACY_IDS=[
  'teachingApp','teachingMenuPanel','teachingSettingsPanel','teachingOverlay','teachingMenuButton',
  'teachingMenuClose','teachingSettingsButton','teachingSettingsClose','teachingSwitchToKiwiButton',
  'teachingConfirmDialog','teachingConfirmCancel','teachingConfirmAccept','teachingDockShell',
  'teachingDock','teachingDockItemTemplate','teachingMenuFuture',
];

test('D23 owns the actual /teaching.html production entrypoint',()=>{
  const html=read('public/teaching.html');
  assert.match(html,/\/teaching-d23-live\.css/);
  assert.match(html,/\/teaching-d23-live\.js/);
  assert.match(html,/class="d23-rail"/);
  assert.match(html,/class="d23-mobile-dock"/);
  assert.match(html,/id="d23SecondaryMenu"/);
  for(const id of REQUIRED_LEGACY_IDS) assert.match(html,new RegExp(`id="${id}"`),`missing legacy integration hook ${id}`);
  for(const label of ['Today','Courses','Calendar','Work','Record']) assert.match(html,new RegExp(`>${label}<`),`visible primary destination ${label}`);
  assert.equal((html.match(/data-d23-primary=/g)||[]).length,10,'desktop rail and mobile dock must each expose five primary destinations');
  assert.ok(html.indexOf('/teaching-d23-live.js')>html.indexOf('/teaching-d16.js'),'D23 visible renderer must load after predecessor frontend modules');
});

test('D23 visible renderer reads authoritative D23 projections instead of recreating truth',()=>{
  const js=read('public/teaching-d23-live.js');
  for(const endpoint of [
    '/teaching/information/today','/teaching/information/courses','/teaching/information/calendar',
    '/teaching/information/work','/teaching/information/record','/teaching/information/requests',
    '/teaching/information/archive','/teaching/information/study','/teaching/information/classes/',
  ]) assert.ok(js.includes(endpoint),`missing visible D23 read ${endpoint}`);
  for(const marker of ['COURSE_TABS','Course Plan','Teacher','Nothing is pulling at you.','Impromptu means impromptu','Official marks ≠ learning inference.']) assert.ok(js.includes(marker),marker);
  assert.doesNotMatch(js,/localStorage|sessionStorage|indexedDB/i,'browser persistence may not become academic truth');
  assert.doesNotMatch(js,/Student Knowledge Model|Pedagogy Engine|Assessment Blueprint|Evidence Event/,'internal engines may not become visible navigation');
});

test('D23 live stylesheet is materially distinct from the legacy green Teaching shell',()=>{
  const css=read('public/teaching-d23-live.css');
  for(const marker of ['--d23-bg:#07090d','--d23-lime:#c9ff72','.d23-rail','.d23-mobile-dock','.d23-course-nav','.d23-timeline','.d23-truth']) assert.ok(css.includes(marker),marker);
  assert.match(css,/DM Serif Display/);
  assert.match(css,/width:238px/);
});

test('D23 router exposes JSON for every visible composition surface',()=>{
  const routes=read('teaching/d23/routes.js');
  for(const route of [
    '/information/work','/information/requests','/information/archive',
    '/information/courses/:id/overview','/information/courses/:id/plan',
    '/information/courses/:id/materials','/information/courses/:id/work',
    '/information/courses/:id/results','/information/classes/:id/event',
  ]) assert.ok(routes.includes(route),route);
});
