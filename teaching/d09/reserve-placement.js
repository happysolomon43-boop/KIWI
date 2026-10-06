'use strict';

const scheduler = require('./scheduler');
const { digest } = require('./contracts');

const RESERVE_KINDS = new Set(['ASSESSMENT_RESERVE', 'REVISION_RESERVE']);
const HARD_BLOCK_KINDS = new Set(['HARD_UNAVAILABLE', 'BREAK', 'HOLIDAY', 'TRAVEL']);
const MINUTE_MS = 60 * 1000;

function value(row, snake, camel) {
  return row?.[snake] ?? row?.[camel] ?? null;
}

function compatibleProtectedKind(slotKind) {
  if (slotKind === 'ASSESSMENT_RESERVE') return 'PROTECTED_ASSESSMENT';
  if (slotKind === 'REVISION_RESERVE') return 'PROTECTED_REVISION';
  return null;
}

function reserveConflictsWithBlock(context, slot, start, end) {
  const expectedProtected = compatibleProtectedKind(slot.kind);
  return (context.blocks || []).some((block) => {
    const courseId = value(block, 'course_id', 'courseId');
    if (courseId && String(courseId) !== String(slot.courseId)) return false;
    const blockStart = value(block, 'starts_at', 'startsAt');
    const blockEnd = value(block, 'ends_at', 'endsAt');
    if (!blockStart || !blockEnd || !scheduler.overlap(start, end, blockStart, blockEnd)) return false;
    const kind = String(value(block, 'block_kind', 'kind') || '').toUpperCase();
    if (HARD_BLOCK_KINDS.has(kind)) return true;
    if (kind === 'PROTECTED_ASSESSMENT' || kind === 'PROTECTED_REVISION') return kind !== expectedProtected;
    return false;
  });
}

function protectedPreference(context, slot, start, end) {
  const expected = compatibleProtectedKind(slot.kind);
  if (!expected) return false;
  return (context.blocks || []).some((block) => {
    const courseId = value(block, 'course_id', 'courseId');
    if (courseId && String(courseId) !== String(slot.courseId)) return false;
    if (String(value(block, 'block_kind', 'kind') || '').toUpperCase() !== expected) return false;
    return scheduler.overlap(start, end, value(block, 'starts_at', 'startsAt'), value(block, 'ends_at', 'endsAt'));
  });
}

function hardDeadlineFor(context, courseId) {
  return (context.deadlines || [])
    .filter((row) => {
      const rowCourse = value(row, 'course_id', 'courseId');
      return (!rowCourse || String(rowCourse) === String(courseId))
        && String(value(row, 'deadline_kind', 'kind') || '').toUpperCase() === 'HARD';
    })
    .map((row) => value(row, 'deadline_at', 'deadlineAt'))
    .filter(Boolean)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0] || null;
}

function overlapsPlaced(placed, start, end) {
  return placed.some((slot) => scheduler.overlap(start, end, slot.startsAt, slot.endsAt));
}

function availablePeriodContains(periods, start, end) {
  return periods.some((period) => Date.parse(period.start) <= Date.parse(start) && Date.parse(end) <= Date.parse(period.end));
}

function candidateForReserve(context, slot, placed, periods, notBefore) {
  const duration = Math.max(1, Number(slot.plannedMinutes) || scheduler.minutesBetween(slot.startsAt, slot.endsAt));
  const hardDeadline = hardDeadlineFor(context, slot.courseId);
  let best = null;

  for (const period of periods) {
    if (Date.parse(period.end) <= notBefore) continue;
    const pieces = scheduler.subtractIntervals(
      period.start,
      period.end,
      placed.map((item) => ({ startsAt: item.startsAt, endsAt: item.endsAt }))
    );
    for (const piece of pieces) {
      const startMs = Math.max(Date.parse(piece.start), notBefore);
      const start = new Date(startMs).toISOString();
      const end = new Date(startMs + duration * MINUTE_MS).toISOString();
      if (Date.parse(end) > Date.parse(piece.end)) continue;
      if (hardDeadline && Date.parse(end) > Date.parse(hardDeadline)) continue;
      if (reserveConflictsWithBlock(context, slot, start, end)) continue;
      const protectedMatch = protectedPreference(context, slot, start, end);
      const candidate = { start, end, protectedMatch };
      if (!best
        || (candidate.protectedMatch && !best.protectedMatch)
        || (candidate.protectedMatch === best.protectedMatch && Date.parse(candidate.start) < Date.parse(best.start))) {
        best = candidate;
      }
    }
  }
  return best;
}

function normalizeReservePlacement(context, result, { source = 'AUTOMATIC' } = {}) {
  if (!result || result.outcome === 'INFEASIBLE' || !Array.isArray(result.schedule)) return result;
  const reserveSlots = result.schedule.filter((slot) => RESERVE_KINDS.has(String(slot.kind)));
  const classSlots = result.schedule.filter((slot) => slot.kind === 'CLASS');
  if (!reserveSlots.length || !classSlots.length || !context.semester?.timezone) return result;

  const periods = scheduler.buildPeriods(context).filter((period) => period.kind === 'AVAILABLE');
  if (!periods.length) return result;

  // D09 reserve rows are planned capacity, not proof that an Assessment or
  // revision session already exists. They must not precede all instruction,
  // but they may legitimately sit mid-Course or near a final assessment window.
  // Downstream Assessment/Revision owners decide when that capacity becomes a
  // real academic event; Scheduler only protects the time here.
  const placed = result.schedule
    .filter((slot) => !RESERVE_KINDS.has(String(slot.kind)))
    .map((slot) => ({ ...slot }));
  let repositioned = 0;

  for (const slot of [...reserveSlots].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))) {
    const courseClasses = placed.filter((item) => item.kind === 'CLASS' && String(item.courseId) === String(slot.courseId));
    if (!courseClasses.length) {
      placed.push({ ...slot });
      continue;
    }
    const notBefore = Math.min(...courseClasses.map((item) => Date.parse(item.endsAt)));
    const hardDeadline = hardDeadlineFor(context, slot.courseId);
    const originalValid = Date.parse(slot.startsAt) >= notBefore
      && (!hardDeadline || Date.parse(slot.endsAt) <= Date.parse(hardDeadline))
      && availablePeriodContains(periods, slot.startsAt, slot.endsAt)
      && !overlapsPlaced(placed, slot.startsAt, slot.endsAt)
      && !reserveConflictsWithBlock(context, slot, slot.startsAt, slot.endsAt);

    if (originalValid) {
      placed.push({ ...slot });
      continue;
    }

    const candidate = candidateForReserve(context, slot, placed, periods, notBefore);
    if (!candidate) {
      // The pre-naturalized deterministic Scheduler result remains the safe
      // fallback. Never invent or drop protected capacity just to preserve a
      // presentation/cadence preference.
      return result;
    }
    repositioned += 1;
    placed.push({
      ...slot,
      startsAt: candidate.start,
      endsAt: candidate.end,
      localDate: scheduler.dateKey(new Date(candidate.start), context.semester.timezone),
      exceptionCodes: Object.freeze([...(slot.exceptionCodes || []), 'RESERVE_CAPACITY_PLACED_AFTER_INSTRUCTION']),
      rationale: `${slot.kind === 'ASSESSMENT_RESERVE' ? 'Assessment' : 'Revision'} capacity reserved after initial scheduled instruction; this is capacity, not an invented academic event.`,
    });
  }

  const schedule = placed.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const totalMinutes = schedule.reduce((sum, slot) => sum + scheduler.minutesBetween(slot.startsAt, slot.endsAt), 0);
  if (totalMinutes !== Number(result.metrics?.scheduledMinutes)) return result;
  for (let i = 0; i < schedule.length; i += 1) {
    for (let j = i + 1; j < schedule.length; j += 1) {
      if (scheduler.overlap(schedule[i].startsAt, schedule[i].endsAt, schedule[j].startsAt, schedule[j].endsAt)) return result;
    }
  }

  const invalidReserve = schedule.some((slot) => {
    if (!RESERVE_KINDS.has(String(slot.kind))) return false;
    const firstClassEnd = Math.min(...schedule
      .filter((item) => item.kind === 'CLASS' && String(item.courseId) === String(slot.courseId))
      .map((item) => Date.parse(item.endsAt)));
    return Number.isFinite(firstClassEnd) && Date.parse(slot.startsAt) < firstClassEnd;
  });
  if (invalidReserve) return result;

  return Object.freeze({
    ...result,
    schedule: Object.freeze(schedule.map((slot) => Object.freeze({ ...slot }))),
    metrics: Object.freeze({
      ...(result.metrics || {}),
      reservePlacementNormalized: true,
      reserveSlotsRepositioned: repositioned,
    }),
    policy: Object.freeze({
      ...(result.policy || {}),
      genericReserveCapacityAfterInitialInstruction: true,
      reserveCapacityDoesNotInventAssessmentOrRevisionEvent: true,
    }),
    stateDigest: digest({
      source,
      previousStateDigest: result.stateDigest,
      reservePlacementPolicy: 'after-initial-instruction.v2',
      schedule: schedule.map((slot) => [slot.courseId, slot.kind, slot.startsAt, slot.endsAt, slot.plannedMinutes]),
    }),
  });
}

module.exports = {
  RESERVE_KINDS,
  reserveConflictsWithBlock,
  normalizeReservePlacement,
};
