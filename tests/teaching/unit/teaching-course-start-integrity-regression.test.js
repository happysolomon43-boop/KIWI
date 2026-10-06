'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { normalizeReservePlacement } = require('../../../teaching/d09/reserve-placement');
const { activationIntegrityBlockers } = require('../../../teaching/repositories/d10-activation-integrity');
const { decorateD10Service } = require('../../../teaching/d10/flow-integrity-service');

function reserveContext() {
  return {
    semester: {
      semester_id: 'sem-1',
      state_version: 1,
      starts_at: '2026-10-06T00:00:00.000Z',
      ends_at: '2026-11-06T23:59:59.000Z',
      timezone: 'UTC',
    },
    profile: { preferences: {} },
    availability: [1,2,3,4,5].map((day) => ({
      day_of_week: day,
      local_start: '09:00',
      local_end: '18:00',
      kind: 'AVAILABLE',
      preference_weight: 0,
    })),
    blocks: [],
    deadlines: [],
  };
}

function screenshotShapedSchedule() {
  return {
    outcome: 'FEASIBLE',
    schedule: [
      { courseId: 'c1', kind: 'ASSESSMENT_RESERVE', startsAt: '2026-10-07T16:50:00.000Z', endsAt: '2026-10-07T17:20:00.000Z', timezone: 'UTC', localDate: '2026-10-07', learningUnitIds: [], plannedMinutes: 30, exceptionCodes: [], rationale: 'legacy reserve' },
      { courseId: 'c1', kind: 'REVISION_RESERVE', startsAt: '2026-10-07T17:20:00.000Z', endsAt: '2026-10-07T17:50:00.000Z', timezone: 'UTC', localDate: '2026-10-07', learningUnitIds: [], plannedMinutes: 30, exceptionCodes: [], rationale: 'legacy reserve' },
      { courseId: 'c1', kind: 'CLASS', startsAt: '2026-10-09T12:00:00.000Z', endsAt: '2026-10-09T14:30:00.000Z', timezone: 'UTC', localDate: '2026-10-09', learningUnitIds: ['u1'], plannedMinutes: 150, exceptionCodes: [], rationale: 'instruction' },
      { courseId: 'c1', kind: 'CLASS', startsAt: '2026-10-12T14:00:00.000Z', endsAt: '2026-10-12T17:20:00.000Z', timezone: 'UTC', localDate: '2026-10-12', learningUnitIds: ['u2'], plannedMinutes: 200, exceptionCodes: [], rationale: 'instruction' },
    ],
    metrics: { scheduledMinutes: 410, stableSlotsRetained: 0 },
    policy: {},
    stateDigest: 'before',
  };
}

test('D09 generic assessment/revision capacity cannot remain before instructional Classes', () => {
  const normalized = normalizeReservePlacement(reserveContext(), screenshotShapedSchedule(), { source: 'REGRESSION' });
  const classes = normalized.schedule.filter((slot) => slot.kind === 'CLASS');
  const reserves = normalized.schedule.filter((slot) => slot.kind.endsWith('_RESERVE'));
  const lastClassEnd = Math.max(...classes.map((slot) => Date.parse(slot.endsAt)));

  assert.equal(reserves.length, 2);
  assert.ok(reserves.every((slot) => Date.parse(slot.startsAt) >= lastClassEnd));
  assert.equal(normalized.metrics.scheduledMinutes, 410);
  assert.equal(normalized.metrics.reservePlacementNormalized, true);
  assert.equal(normalized.metrics.reserveSlotsRepositioned, 2);
  assert.equal(normalized.policy.reserveCapacityDoesNotInventAssessmentOrRevisionEvent, true);
  assert.ok(reserves.every((slot) => slot.exceptionCodes.includes('RESERVE_CAPACITY_PLACED_AFTER_INSTRUCTION')));
});

test('D10 blocks legacy timetables that put generic reserve capacity before the first Class', () => {
  const blockers = activationIntegrityBlockers({
    instructionalUnitCount: 2,
    estimatedInstructionalMinutes: 350,
    classSlotCount: 2,
    futureClassSlotCount: 2,
    elapsedSlotCount: 0,
    reserveBeforeFirstClassCount: 2,
  });
  assert.ok(blockers.includes('TIMETABLE_RESERVE_BEFORE_FIRST_CLASS'));
});

test('D10 service splits schedule approval from post-parent Class materialization', async () => {
  const order = [];
  let reviewCalls = 0;
  const base = {
    async getActivationReview() {
      reviewCalls += 1;
      return {
        canActivate: true,
        blockingReasons: [],
        coursePlan: { coursePlanId: 'plan-1' },
        timetable: { timetableVersionId: 'tt-1' },
      };
    },
    async activateCourse() { throw new Error('legacy activation path must not be used'); },
  };
  const repository = {
    async getActivationFacts() { return { timetableIntegrity: null }; },
    async activateCourseUsing(tx, input) {
      const schedule = await input.prepareScheduleUsing(tx, {
        timetable: { timetable_version_id: 'tt-1' },
        semester: { semester_id: 'sem-1' },
      });
      order.push('activation-parent');
      const activationId = 'activation-1';
      const classes = await input.materializeScheduleUsing(tx, {
        semester: { semester_id: 'sem-1' },
      }, activationId, schedule);
      return {
        course: { state_version: 3 },
        activationId,
        activatedAt: '2026-10-06T15:00:00.000Z',
        schedule: { ...schedule, classes },
        facts: { plan: { course_plan_id: 'plan-1' } },
      };
    },
  };
  const d09Repository = {
    async approveTimetableUsing() { order.push('approve'); return { timetable_version_id: 'tt-1', version_no: 1 }; },
    async latestTimetable() { order.push('latest'); return { slots: [{ slot: 1 }] }; },
    async materializeApprovedTimetableUsing(_tx, input) {
      assert.equal(input.activationId, 'activation-1');
      order.push('materialize');
      return [{ class_id: 'class-1' }];
    },
  };
  let id = 0;
  const service = decorateD10Service(base, {
    repository,
    d09Repository,
    randomUUID: () => `id-${++id}`,
    clock: () => new Date('2026-10-06T15:00:00.000Z'),
    transactionalMutation: {
      async mutateAndPublish({ mutate, buildEvent }) {
        const result = await mutate({ query() {} });
        buildEvent(result);
        order.push('event');
        return { mutationResult: result };
      },
    },
  });

  await service.activateCourse({ id: 'student-1' }, 'course-1');
  assert.deepEqual(order, ['approve', 'latest', 'activation-parent', 'materialize', 'event']);
  assert.equal(reviewCalls, 2);
});

test('D10 repository materializes Classes after the base activation insert boundary', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../../teaching/repositories/d10-activation-integrity.js'),
    'utf8'
  );
  const parentBoundary = source.indexOf('const activated = await base.activateCourseUsing');
  const classBoundary = source.indexOf('const classes = await materializeScheduleUsing');
  assert.ok(parentBoundary >= 0);
  assert.ok(classBoundary > parentBoundary);
  assert.match(source, /immediate and\s*\n\s*\/\/ non-deferrable/);
});
