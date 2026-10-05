'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { computeSchedule, overlap, dateKey } = require('../../../teaching/d09/scheduler');
const {
  naturalizeScheduleResult,
  PREFERRED_INTERCLASS_GAP_MINUTES,
  conflictsWithClassBlock,
} = require('../../../teaching/d09/schedule-naturalizer');
const {
  rewriteD11LearningUnitOrdering,
  CANONICAL_LEARNING_UNIT_ORDER,
} = require('../../../teaching/repositories/d11-schema-adapter');
const {
  classroomEntryWindow,
  CLASSROOM_EARLY_ENTRY_MINUTES,
} = require('../../../teaching/repositories/d14-entry-guard');
const { decorateD10RequestExperience } = require('../../../teaching/d10/request-experience-service');

function semester() {
  return {
    semester_id: 'sem-natural',
    state_version: 1,
    starts_at: '2026-10-01T00:00:00Z',
    ends_at: '2026-10-31T23:59:59Z',
    timezone: 'UTC',
  };
}
function availability(days = [1,2,3,4,5], start = '09:00', end = '18:00') {
  return days.map((day) => ({ day_of_week: day, local_start: start, local_end: end, kind: 'AVAILABLE', preference_weight: 0 }));
}
function bundle(id = 'c1', unitCount = 6, minutes = 60) {
  return {
    course: { course_id: id, title: id, state_version: 1, subject_snapshot_ref: 'snap', lifecycle_state: 'DRAFT' },
    plan: { course_plan_id: `${id}-plan`, version_no: 1, plan_state: 'REVIEW_READY', source_snapshot_ref: 'snap' },
    units: Array.from({ length: unitCount }, (_, index) => ({
      learning_unit_id: `${id}-u${index+1}`,
      title: `Unit ${index+1}`,
      instructional_load_min_minutes: minutes,
      instructional_load_max_minutes: minutes,
      metadata: { instructional_treatment: 'FULL_INSTRUCTION' },
    })),
    dependencies: [],
    coverage: [],
    scopeChanges: [],
    semesterTimezone: 'UTC',
  };
}
function scheduleContext({ courses = [bundle()], blocks = [], availabilityRows = availability() } = {}) {
  return {
    semester: semester(),
    profile: {
      profile_id: 'profile-natural',
      version_no: 1,
      semester_state_version: 1,
      preferences: { avoidConsecutiveSameCourseDays: true, preferredStartTimes: ['09:00','14:00'] },
      settings: { horizon: { imminentDays: 7, concreteDays: 28 } },
    },
    availability: availabilityRows,
    blocks,
    deadlines: [],
    reserves: [],
    courses,
    unresolvedCourses: [],
  };
}

test('D11 schema adapter removes nonexistent learning-unit sequence_no and orders by canonical graph ordinals', () => {
  const legacy = 'select * from public.teaching_learning_units where student_id=$1 and course_plan_id=$2 order by sequence_no,learning_unit_id';
  const rewritten = rewriteD11LearningUnitOrdering(legacy);
  assert.equal(rewritten, CANONICAL_LEARNING_UNIT_ORDER);
  assert.equal(rewritten.includes('sequence_no'), false);
  assert.match(rewritten, /teaching_topics t/);
  assert.match(rewritten, /t\.ordinal/);
  assert.match(rewritten, /s\.ordinal nulls first/);
});

test('D14 Classroom entry window is locked before T-60 and becomes a waiting room without starting Class', () => {
  assert.equal(CLASSROOM_EARLY_ENTRY_MINUTES, 60);
  const scheduledStartAt = '2026-10-06T09:00:00.000Z';
  const scheduledEndAt = '2026-10-06T10:00:00.000Z';
  const early = classroomEntryWindow({ scheduledStartAt, scheduledEndAt, serverNow: '2026-10-06T07:59:59.000Z', lifecycleState: 'SCHEDULED' });
  assert.equal(early.canEnter, false);
  assert.equal(early.waitingRoom, false);
  const waiting = classroomEntryWindow({ scheduledStartAt, scheduledEndAt, serverNow: '2026-10-06T08:00:00.000Z', lifecycleState: 'SCHEDULED' });
  assert.equal(waiting.canEnter, true);
  assert.equal(waiting.waitingRoom, true);
  assert.equal(waiting.classTimeReached, false);
  const live = classroomEntryWindow({ scheduledStartAt, scheduledEndAt, serverNow: scheduledStartAt, lifecycleState: 'SCHEDULED' });
  assert.equal(live.canEnter, true);
  assert.equal(live.waitingRoom, false);
  assert.equal(live.classTimeReached, true);
});

test('D09 cadence naturalizer is deterministic, preserves workload and spreads a normal short Course', () => {
  const context = scheduleContext();
  const raw = computeSchedule(context, { now: '2026-09-29T04:00:00Z' });
  const first = naturalizeScheduleResult(context, raw, { source: 'TEST' });
  const second = naturalizeScheduleResult(context, raw, { source: 'TEST' });
  assert.deepEqual(first.schedule, second.schedule);
  assert.equal(first.metrics.scheduledMinutes, raw.metrics.scheduledMinutes);
  assert.equal(first.metrics.naturalizedCadence, true);
  assert.equal(first.policy.trueRandomnessUsed, false);
  const classes = first.schedule.filter((slot) => slot.kind === 'CLASS');
  const days = new Set(classes.map((slot) => slot.localDate));
  assert.ok(days.size > 1, 'normal short Course should not be greedily packed into one day');
  const firstDay = Math.min(...classes.map((slot) => Date.parse(`${slot.localDate}T00:00:00Z`)));
  const lastDay = Math.max(...classes.map((slot) => Date.parse(`${slot.localDate}T00:00:00Z`)));
  assert.ok((lastDay-firstDay)/86400000 <= 21, 'normal short Course should not be stretched across the entire month');
  const byDay = new Map();
  for (const slot of classes) {
    const list = byDay.get(slot.localDate) || [];
    list.push(slot);byDay.set(slot.localDate,list);
  }
  assert.ok([...byDay.values()].every((list)=>list.length<=2));
  for (const list of byDay.values()) {
    const ordered=[...list].sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt));
    if(ordered.length===2){
      const gap=(Date.parse(ordered[1].startsAt)-Date.parse(ordered[0].endsAt))/60000;
      assert.ok(gap>=PREFERRED_INTERCLASS_GAP_MINUTES || ordered.some((slot)=>slot.exceptionCodes?.includes('COMPRESSED_INTERCLASS_GAP_REQUIRED_BY_FEASIBLE_CAPACITY')));
    }
  }
});

test('D09 cadence naturalizer refuses course-specific protected and break blocks', () => {
  const block = {
    course_id: 'c1',
    block_kind: 'PROTECTED_REVISION',
    starts_at: '2026-10-05T09:00:00.000Z',
    ends_at: '2026-10-05T18:00:00.000Z',
  };
  const context = scheduleContext({ blocks: [block] });
  assert.equal(conflictsWithClassBlock(context, 'c1', '2026-10-05T10:00:00.000Z', '2026-10-05T11:00:00.000Z'), true);
  const raw = computeSchedule(context, { now: '2026-09-29T04:00:00Z' });
  const result = naturalizeScheduleResult(context, raw, { source: 'TEST_BLOCK' });
  assert.ok(result.schedule.filter((slot)=>slot.kind==='CLASS').every((slot)=>!overlap(slot.startsAt,slot.endsAt,block.starts_at,block.ends_at)));
});

test('D09 deterministic cadence remains compatible with multiple availability windows on the same weekday', () => {
  const context = scheduleContext({
    courses: [bundle('c1',4,60)],
    availabilityRows: [
      ...availability([1,2,3,4,5],'09:00','12:00'),
      ...availability([1,2,3,4,5],'14:00','18:00'),
    ],
  });
  const raw = computeSchedule(context,{now:'2026-09-29T04:00:00Z'});
  const result = naturalizeScheduleResult(context,raw,{source:'MULTI_WINDOW'});
  assert.equal(result.metrics.unscheduledMinutes,0);
  assert.ok(result.schedule.filter((slot)=>slot.kind==='CLASS').every((slot)=>{
    const hour=Number(new Intl.DateTimeFormat('en-CA',{timeZone:'UTC',hour:'2-digit',hourCycle:'h23'}).format(new Date(slot.startsAt)));
    return (hour>=9&&hour<12)||(hour>=14&&hour<18);
  }));
});

test('D10 request experience runs authoritative deterministic review in the submission call', async () => {
  const calls=[];
  const service={
    marker:'preserved',
    async submitRequest(_user,requestId){calls.push(['submit',requestId]);return{requestId,state:'REVIEWING'};},
    async reviewRequest(_user,requestId){calls.push(['review',requestId]);return{requestId,state:'APPLIED'};},
  };
  const decorated=decorateD10RequestExperience(service);
  const result=await decorated.submitRequest({id:'student-1'},'request-1');
  assert.equal(result.state,'APPLIED');
  assert.equal(decorated.marker,'preserved');
  assert.deepEqual(calls,[['submit','request-1'],['review','request-1']]);
});

test('Teaching client experience includes global tabs, skeletons, multi-window availability, request owner and waiting-room states', () => {
  const css=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-ui-system.css'),'utf8');
  const ui=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-ui-system.js'),'utf8');
  const schedule=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-schedule-experience.js'),'utf8');
  const classroom=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-classroom.js'),'utf8');
  assert.match(css,/\.teaching-course-nav__item\[data-active="true"\]/);
  assert.match(css,/teaching-shell-skeleton/);
  assert.match(ui,/Reviewed by/);
  assert.match(ui,/Enter waiting room/);
  assert.match(ui,/one hour before Class/i);
  assert.match(schedule,/Add time window/);
  assert.match(schedule,/Window \$\{index\+1\}/);
  assert.match(schedule,/3–8 hour same-day gaps/);
  assert.match(classroom,/Leave the Classroom\?/);
  assert.match(classroom,/The Class continues according to its scheduled time/);
});

test('D09 day grouping remains timezone-aware after cadence placement', () => {
  const context=scheduleContext();
  const raw=computeSchedule(context,{now:'2026-09-29T04:00:00Z'});
  const result=naturalizeScheduleResult(context,raw,{source:'DAY_KEY'});
  for(const slot of result.schedule.filter((item)=>item.kind==='CLASS'))assert.equal(slot.localDate,dateKey(new Date(slot.startsAt),'UTC'));
});
