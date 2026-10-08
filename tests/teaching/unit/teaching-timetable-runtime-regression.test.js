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
