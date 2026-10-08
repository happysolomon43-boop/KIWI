'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const {
  LONG_RUNNING_ANALYSIS_PROFILE,
  executionProfileForInvocation,
} = require('../../../teaching/orchestrator/ai-adapter');

const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('D09 instructional-load estimation uses the centrally governed long-running profile', () => {
  const profile = executionProfileForInvocation({
    capability: { id: 'teaching.scheduling.instructional_load_estimation' },
    prompt: { family_id: 'TPF-10' },
    output_schema: { id: 'tpf10.instructional-load-estimation' },
  });

  assert.equal(profile, 'LONG_RUNNING_ANALYSIS');
  assert.equal(profile, LONG_RUNNING_ANALYSIS_PROFILE);
  assert.equal(executionProfileForInvocation({
    capability: { id: 'teaching.scheduling.initial_timetable_proposal' },
    prompt: { family_id: 'TPF-10' },
    output_schema: { id: 'd09.scheduling-advisory.v1' },
  }), null);
});

test('Teaching timetable proposal client timeout follows the long-running server envelope', () => {
  const source = read('public/kiwi-api-client.js');

  assert.match(source, /LONG_RUNNING_ANALYSIS_OPERATION_TIMEOUT_MS\s*=\s*10\s*\*\s*60\s*\*\s*1000/);
  assert.match(source, /timetable\\\/propose/);
  assert.match(source, /timeoutMs:\s*LONG_RUNNING_ANALYSIS_OPERATION_TIMEOUT_MS\s*\+\s*NETWORK_COMPLETION_GRACE_MS/);
  assert.match(source, /REQUEST_TIMEOUT_POLICIES\.find/);
});

test('Teaching typography disables synthetic stretched faces without global rescaling', () => {
  const source = read('public/teaching-typography-system.css');

  assert.match(source, /font-synthesis:\s*none/);
  assert.match(source, /font-stretch:\s*normal/);
  assert.match(source, /:is\(button, input, select, textarea, option\)/);
  assert.match(source, /:is\(h1, h2, h3, h4, h5, h6, \.teaching-title/);
  assert.doesNotMatch(source, /body\s+\*/);
  assert.doesNotMatch(source, /!important/);
});


test('Teaching startup does not block on redundant status or optional information hydration', () => {
  const source = read('public/teaching.js');
  const client = read('public/kiwi-api-client.js');

  assert.doesNotMatch(source, /await kiwiApiRequest\('\/teaching\/status'\)/);
  assert.match(source, /const informationRequest = kiwiApiRequest\('\/teaching\/information\/courses'\)/);
  assert.match(source, /void informationRequest\.then/);
  assert.match(client, /refreshAccessTokenInFlight/);
  assert.match(client, /performAccessTokenRefresh\(\)[\s\S]*\.finally/);
});

test('Timetable build actions preserve the current view while background work starts', () => {
  const modern = read('public/teaching-schedule-experience.js');
  const legacy = read('public/teaching-d09.js');

  assert.match(modern, /const monitor=async\(\)=>/);
  assert.match(legacy, /const monitor=async\(\)=>/);
  assert.match(modern, /if\(build\?\.active\)\{window\.setTimeout\(monitor,3000\)/);
  assert.match(legacy, /if\(build\?\.active\)\{window\.setTimeout\(monitor,3000\)/);
  assert.match(modern, /SEMESTER_CAPACITY_INFEASIBLE/);
  assert.match(legacy, /SEMESTER_CAPACITY_INFEASIBLE/);
  assert.doesNotMatch(modern, /window\.setTimeout\(\(\)=>\{void reload/);
  assert.doesNotMatch(legacy, /window\.setTimeout\(\(\)=>\{void reload/);
});


test('Infeasible Semester capacity is rejected before a proposal is saved', () => {
  const service = read('teaching/d09/service.js');
  assert.match(service, /result\.outcome==='INFEASIBLE'/);
  assert.match(service, /TEACHING_D09_SEMESTER_CAPACITY_INFEASIBLE/);
  assert.match(service, /does not have enough conflict-free time/);
});

test('active shared Semesters route availability edits through a formal Request', () => {
  const experience=read('public/teaching-schedule-experience.js');
  const repository=read('teaching/repositories/d09-scheduling.js');
  assert.match(experience,/semesterHasActivatedCourses===true\|\|postActivationState/);
  assert.match(experience,/governedAvailability\?'Request availability change':'Save availability'/);
  assert.match(repository,/TEACHING_D09_ACTIVE_SEMESTER_REQUEST_REQUIRED/);
});

test('timetable rematerialization retires every superseded unstarted Class and Calendar hides cancellations', () => {
  const repository=read('teaching/repositories/d09-scheduling.js');
  const materializer=repository.slice(repository.indexOf('async function materializeApprovedTimetableUsing'),repository.indexOf('return Object.freeze({',repository.indexOf('async function materializeApprovedTimetableUsing')));
  assert.match(materializer,/lifecycle_state='SCHEDULED'[\s\S]*source_timetable_version_id<>\$3/);
  assert.doesNotMatch(materializer,/scheduled_start_at>=/);
  assert.match(repository,/c\.lifecycle_state<>'CANCELLED'/);
});

test('Classroom attendance and Calendar select the current versioned obligation without nonexistent is_current column', () => {
  const classroom=read('teaching/repositories/d14-classroom.js');
  const calendar=read('teaching/repositories/d09-scheduling.js');
  for(const sql of [classroom,calendar]){
    assert.doesNotMatch(sql,/is_current\s*=\s*true/);
    assert.match(sql,/schedule_version=c\.schedule_version/);
    assert.match(sql,/order by version_no desc,recorded_at desc limit 1/);
  }
  const projection=read('teaching/d23/service.js');
  assert.match(projection,/attendanceOutcome:row\.attendanceOutcome\|\|row\.attendance_outcome/);
});

test('Calendar separates upcoming Classes and attendance-backed past history with automatic refresh',()=>{
  const source=read('public/teaching-d09.js');
  assert.match(source,/Upcoming & active/);
  assert.match(source,/Past Class history/);
  assert.match(source,/attendanc(eOutcome|e pending)/i);
  assert.match(source,/window\.setInterval/);
  assert.match(source,/document\.visibilityState==='visible'/);
  assert.match(source,/TEACHING_D09_ACTIVE_SEMESTER_REQUEST_REQUIRED/);
});

test('Unfingerprinted assets revalidate and Teaching detects deployments without interrupting active editing',()=>{
  const html=read('public/teaching.html');
  const server=read('index.js');
  const teaching=read('public/teaching.js');
  assert.match(server,/client-version/);
  assert.match(server,/max-age=0, must-revalidate/);
  assert.doesNotMatch(server,/max-age=31536000, immutable/);
  assert.match(teaching,/\.tc-active/);
  assert.match(teaching,/visibilitychange/);
  assert.match(html,/teaching-classroom\.js\?v=20261008-classroom-sheets-1/);
});

test('Vercel static frontend emits a deployment marker with no-store caching',()=>{
  const build=read('scripts/build-web.js');
  const vercel=JSON.parse(read('vercel.json'));
  const teaching=read('public/teaching.js');
  assert.match(build,/VERCEL_GIT_COMMIT_SHA/);
  assert.match(build,/builtAt/);
  assert.match(teaching,/kiwi-build\.json/);
  assert.ok(vercel.headers.some(entry=>entry.source==='/kiwi-build.json'&&entry.headers.some(h=>/no-store/.test(h.value))));
});
