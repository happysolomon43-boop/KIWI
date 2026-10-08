'use strict';

const scheduler = require('./scheduler');
const {spacingAllowed}=require('./class-spacing');
const { digest } = require('./contracts');

const PREFERRED_INTERCLASS_GAP_MINUTES = 180;
const PREFERRED_INTERCLASS_GAP_MAX_MINUTES = 480;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const CLASS_BLOCK_KINDS = new Set([
  'HARD_UNAVAILABLE',
  'BREAK',
  'HOLIDAY',
  'TRAVEL',
  'PROTECTED_REVISION',
  'PROTECTED_ASSESSMENT',
]);

function value(row, snake, camel) {
  return row?.[snake] ?? row?.[camel] ?? null;
}

function stableJitter(seed, range = 25) {
  const hex = digest(String(seed)).slice(0, 8);
  return Number.parseInt(hex, 16) % Math.max(1, range);
}

function dayDistance(a, b) {
  if (!a || !b) return null;
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

function hardDeadlineFor(context, courseId) {
  return (context.deadlines || [])
    .filter((row) => {
      const rowCourse = value(row, 'course_id', 'courseId');
      return (!rowCourse || String(rowCourse) === String(courseId))
        && String(value(row, 'deadline_kind', 'kind')).toUpperCase() === 'HARD';
    })
    .map((row) => value(row, 'deadline_at', 'deadlineAt'))
    .filter(Boolean)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0] || null;
}

function flexibleTargetFor(context, courseId) {
  return (context.deadlines || [])
    .filter((row) => {
      const rowCourse = value(row, 'course_id', 'courseId');
      return (!rowCourse || String(rowCourse) === String(courseId))
        && String(value(row, 'deadline_kind', 'kind')).toUpperCase() === 'FLEXIBLE';
    })
    .map((row) => value(row, 'deadline_at', 'deadlineAt'))
    .filter(Boolean)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0] || null;
}

function conflictsWithClassBlock(context, courseId, start, end) {
  return (context.blocks || []).some((block) => {
    const blockCourse = value(block, 'course_id', 'courseId');
    if (blockCourse && String(blockCourse) !== String(courseId)) return false;
    const kind = String(value(block, 'block_kind', 'kind') || '').toUpperCase();
    if (!CLASS_BLOCK_KINDS.has(kind)) return false;
    const blockStart = value(block, 'starts_at', 'startsAt');
    const blockEnd = value(block, 'ends_at', 'endsAt');
    if (!blockStart || !blockEnd) return false;
    return scheduler.overlap(start, end, blockStart, blockEnd);
  });
}

function sameDayGapMinutes(start, end, placed, timeZone) {
  const key = scheduler.dateKey(new Date(start), timeZone);
  let nearest = Infinity;
  for (const slot of placed) {
    if (slot.kind !== 'CLASS') continue;
    if (scheduler.dateKey(new Date(slot.startsAt), timeZone) !== key) continue;
    let gap = 0;
    if (Date.parse(end) <= Date.parse(slot.startsAt)) {
      gap = scheduler.minutesBetween(end, slot.startsAt);
    } else if (Date.parse(slot.endsAt) <= Date.parse(start)) {
      gap = scheduler.minutesBetween(slot.endsAt, start);
    }
    nearest = Math.min(nearest, gap);
  }
  return nearest;
}

function preferredStartsForPeriod(period, preferences, timeZone) {
  const values = preferences?.preferredStartTimes || preferences?.preferred_start_times || [];
  const starts = [];
  for (const time of values) {
    try {
      const instant = scheduler.zonedLocalToInstant(period.key, String(time).slice(0, 5), timeZone);
      if (Date.parse(instant) >= Date.parse(period.start) && Date.parse(instant) < Date.parse(period.end)) starts.push(instant);
    } catch (_) {
      // An unavailable preferred wall time is simply not a candidate.
    }
  }
  return starts;
}

function candidateStarts(piece, period, placed, preferences, timeZone, extraStarts = []) {
  const candidates = new Set([piece.start, ...preferredStartsForPeriod(period, preferences, timeZone), ...extraStarts.filter(Boolean)]);
  const key = period.key;
  for (const slot of placed) {
    if (slot.kind !== 'CLASS') continue;
    if (scheduler.dateKey(new Date(slot.startsAt), timeZone) !== key) continue;
    candidates.add(new Date(Date.parse(slot.endsAt) + PREFERRED_INTERCLASS_GAP_MINUTES * MINUTE_MS).toISOString());
  }
  return [...candidates]
    .filter((start) => Date.parse(start) >= Date.parse(piece.start) && Date.parse(start) < Date.parse(piece.end))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
}

function scoreCandidate({
  start,
  end,
  localDate,
  courseId,
  placed,
  lastCourseSlot,
  idealGapDays,
  firstUsableDate,
  targetSpanDays,
  preferences,
  timeZone,
  flexibleTarget,
  priorSlot = null,
  seed,
}) {
  let score = stableJitter(seed);
  const daysFromStart = Math.max(0, dayDistance(firstUsableDate, localDate) || 0);
  score -= daysFromStart * 2.5;
  if (daysFromStart >= targetSpanDays) score -= (daysFromStart - targetSpanDays + 1) * 40;

  const sameDay = placed.filter((slot) => slot.kind === 'CLASS' && scheduler.dateKey(new Date(slot.startsAt), timeZone) === localDate);
  if (sameDay.length >= 2) return -Infinity;
  if (sameDay.length === 1) score -= 15;

  const gap = sameDayGapMinutes(start, end, placed, timeZone);
  if (Number.isFinite(gap)) {
    if (gap < 60) score -= 360;
    else if (gap < PREFERRED_INTERCLASS_GAP_MINUTES) score -= 180;
    else if (gap <= PREFERRED_INTERCLASS_GAP_MAX_MINUTES) score += 18;
  }

  if (lastCourseSlot) {
    const priorDate = scheduler.dateKey(new Date(lastCourseSlot.startsAt), timeZone);
    const diff = dayDistance(priorDate, localDate);
    if (diff < 0) return -Infinity;
    if (diff === 0) score -= 460;
    else if (diff < idealGapDays) score -= 95 * (idealGapDays - diff);
    else if (diff === idealGapDays) score += 70;
    else if (diff === idealGapDays + 1) score += 38;
    else score += Math.max(-20, 16 - (diff - idealGapDays) * 5);
  }

  const preferredDays = preferences?.preferredDays || preferences?.preferred_days || [];
  const dow = scheduler.weekdayOfKey(localDate);
  if (preferredDays.map(Number).includes(dow)) score += 12;

  const parts = scheduler.dateParts(new Date(start), timeZone);
  const preferredTimes = preferences?.preferredStartTimes || preferences?.preferred_start_times || [];
  if (preferredTimes.includes(`${parts.hour}:${parts.minute}`)) score += 24;

  if (flexibleTarget && Date.parse(end) > Date.parse(flexibleTarget)) score -= 120;
  if (sameDay.some((slot) => String(slot.courseId) === String(courseId))) score -= 100;

  if (priorSlot) {
    const priorStart = value(priorSlot, 'starts_at', 'startsAt');
    if (priorStart) {
      const deltaMinutes = Math.abs(Date.parse(start) - Date.parse(priorStart)) / MINUTE_MS;
      const priorDate = scheduler.dateKey(new Date(priorStart), timeZone);
      const dayShift = Math.abs(dayDistance(priorDate, localDate) || 0);
      if (deltaMinutes <= 15) score += 82;
      else if (deltaMinutes <= 60) score += 62;
      else if (deltaMinutes <= 180) score += 38;
      else if (dayShift === 0) score += 18;
      else score -= Math.min(48, dayShift * 8);
    }
  }

  return score;
}

function priorClassQueues(context, lowerBoundMs) {
  const byCourse = new Map();
  for (const slot of [...(context.priorSlots || [])].sort((a, b) => Date.parse(value(a, 'starts_at', 'startsAt')) - Date.parse(value(b, 'starts_at', 'startsAt')))) {
    if (String(value(slot, 'slot_kind', 'kind') || 'CLASS') !== 'CLASS') continue;
    const start = value(slot, 'starts_at', 'startsAt');
    const end = value(slot, 'ends_at', 'endsAt');
    const courseId = String(value(slot, 'course_id', 'courseId') || '');
    if (!courseId || !start || !end || Date.parse(end) <= lowerBoundMs) continue;
    if (!byCourse.has(courseId)) byCourse.set(courseId, []);
    byCourse.get(courseId).push(slot);
  }
  return byCourse;
}

function cadenceSettings(context, schedule) {
  const courseCounts = new Map();
  for (const slot of schedule) {
    if (slot.kind !== 'CLASS') continue;
    courseCounts.set(String(slot.courseId), (courseCounts.get(String(slot.courseId)) || 0) + 1);
  }
  const courseCount = Math.max(1, (context.courses || []).length);
  const byCourse = new Map();
  for (const [courseId, count] of courseCounts) {
    const idealGapDays = courseCount >= 3 || count > 10 ? 1 : 2;
    const targetSpanDays = Math.min(21, Math.max(7, ((count - 1) * idealGapDays) + 2));
    byCourse.set(courseId, Object.freeze({ count, idealGapDays, targetSpanDays }));
  }
  return byCourse;
}

function naturalizeScheduleResult(context, result, { source = 'AUTOMATIC' } = {}) {
  if(result?.policy?.activeAuthorityPreserved||['PREACTIVATION_EDIT','FORMAL_REQUEST_APPLIED'].includes(source))return result;
  if (!result || result.outcome === 'INFEASIBLE' || !Array.isArray(result.schedule)) return result;
  if (!Number.isFinite(Number(result.metrics?.stableSlotsRetained))) return result;
  const classSlots = result.schedule.filter((slot) => slot.kind === 'CLASS');
  if (classSlots.length < 2) return result;

  const timeZone = context.semester?.timezone;
  if (!timeZone) return result;
  const periods = scheduler.buildPeriods(context).filter((period) => period.kind === 'AVAILABLE');
  if (!periods.length) return result;

  const automaticClasses = [...classSlots].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const fixed = result.schedule
    .filter((slot) => slot.kind !== 'CLASS')
    .map((slot) => ({ ...slot }));
  const placed = [...fixed];
  const settings = cadenceSettings(context, automaticClasses);
  const firstUsableDate = periods[0]?.key || scheduler.dateKey(new Date(automaticClasses[0].startsAt), timeZone);
  const preferences = context.profile?.preferences || context.preferences || {};
  const lastByCourse = new Map();
  const originalFirstStart = Math.min(...automaticClasses.map((slot) => Date.parse(slot.startsAt)));
  const priorByCourse = priorClassQueues(context, originalFirstStart);
  const priorCursorByCourse = new Map();
  let existingClassesConsidered = 0;
  let rebalancedExistingClasses = 0;

  for (const [index, slot] of automaticClasses.entries()) {
    const courseId = String(slot.courseId);
    const duration = Math.max(1, Number(slot.plannedMinutes) || scheduler.minutesBetween(slot.startsAt, slot.endsAt));
    const config = settings.get(courseId) || { idealGapDays: 1, targetSpanDays: 14 };
    const hardDeadline = hardDeadlineFor(context, courseId);
    const flexibleTarget = flexibleTargetFor(context, courseId);
    const lastCourseSlot = lastByCourse.get(courseId) || null;
    const priorCursor = priorCursorByCourse.get(courseId) || 0;
    const priorSlot = priorByCourse.get(courseId)?.[priorCursor] || null;
    if (priorSlot) existingClassesConsidered += 1;
    let best = null;

    for (const period of periods) {
      if (Date.parse(period.end) <= originalFirstStart) continue;
      const freePieces = scheduler.subtractIntervals(
        period.start,
        period.end,
        placed.map((item) => ({ startsAt: item.startsAt, endsAt: item.endsAt }))
      );
      for (const piece of freePieces) {
        const priorStart = priorSlot ? value(priorSlot, 'starts_at', 'startsAt') : null;
        for (const startCandidate of candidateStarts(piece, period, placed, preferences, timeZone, [priorStart])) {
          const startMs = Math.max(Date.parse(startCandidate), originalFirstStart);
          if (lastCourseSlot && startMs < Date.parse(lastCourseSlot.endsAt)) continue;
          const start = new Date(startMs).toISOString();
          const end = new Date(startMs + duration * MINUTE_MS).toISOString();
          if (Date.parse(end) > Date.parse(piece.end)) continue;
          if (hardDeadline && Date.parse(end) > Date.parse(hardDeadline)) continue;
          if (conflictsWithClassBlock(context, courseId, start, end)) continue;
          if(!spacingAllowed(start,end,placed,timeZone))continue;
          const localDate = scheduler.dateKey(new Date(start), timeZone);
          const score = scoreCandidate({
            start,
            end,
            localDate,
            courseId,
            placed,
            lastCourseSlot,
            idealGapDays: config.idealGapDays,
            firstUsableDate,
            targetSpanDays: config.targetSpanDays,
            preferences,
            timeZone,
            flexibleTarget,
            priorSlot,
            seed: `${courseId}:${slot.learningUnitIds?.join(',') || index}:${localDate}:${start}`,
          });
          if (!Number.isFinite(score)) continue;
          if (!best || score > best.score || (score === best.score && Date.parse(start) < Date.parse(best.start))) {
            best = { start, end, localDate, score };
          }
        }
      }
    }

    if (!best) return result;

    const previous = lastCourseSlot;
    const diff = previous
      ? dayDistance(scheduler.dateKey(new Date(previous.startsAt), timeZone), best.localDate)
      : null;
    const gap = sameDayGapMinutes(best.start, best.end, placed, timeZone);
    const exceptionCodes = [];
    if (diff === 0) exceptionCodes.push('SAME_DAY_SAME_COURSE_CAPACITY_COMPRESSION');
    else if (diff === 1 && config.idealGapDays > 1) exceptionCodes.push('CONSECUTIVE_SAME_COURSE_DAY_PLACEMENT_REQUIRED_BY_FEASIBLE_CAPACITY');
    if (Number.isFinite(gap) && gap < PREFERRED_INTERCLASS_GAP_MINUTES) {
      exceptionCodes.push('COMPRESSED_INTERCLASS_GAP_REQUIRED_BY_FEASIBLE_CAPACITY');
    }

    const naturalized = {
      ...slot,
      startsAt: best.start,
      endsAt: best.end,
      localDate: best.localDate,
      exceptionCodes: Object.freeze(exceptionCodes),
      rationale: 'Deterministic cadence placement balancing instructional load, spacing, availability, deadlines and recovery headroom.',
    };
    placed.push(naturalized);
    lastByCourse.set(courseId, naturalized);
    if (priorSlot) {
      const priorStart = value(priorSlot, 'starts_at', 'startsAt');
      if (priorStart && Math.abs(Date.parse(best.start) - Date.parse(priorStart)) > 5 * MINUTE_MS) rebalancedExistingClasses += 1;
      priorCursorByCourse.set(courseId, priorCursor + 1);
    }
  }

  const schedule = placed.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const totalMinutes = schedule.reduce((sum, slot) => sum + scheduler.minutesBetween(slot.startsAt, slot.endsAt), 0);
  if (totalMinutes !== Number(result.metrics.scheduledMinutes)) return result;

  const byDay = new Map();
  for (const slot of schedule.filter((item) => item.kind === 'CLASS')) {
    const key = scheduler.dateKey(new Date(slot.startsAt), timeZone);
    byDay.set(key, (byDay.get(key) || 0) + 1);
  }
  if ([...byDay.values()].some((count) => count > 2)) return result;

  const stateDigest = digest({
    source,
    previousStateDigest: result.stateDigest,
    schedule: schedule.map((slot) => [slot.courseId, slot.kind, slot.startsAt, slot.endsAt, slot.plannedMinutes]),
    cadence: { preferredInterClassGapMinutes: PREFERRED_INTERCLASS_GAP_MINUTES, deterministic: true },
  });

  return Object.freeze({
    ...result,
    schedule: Object.freeze(schedule.map((slot) => Object.freeze({ ...slot }))),
    metrics: Object.freeze({
      ...result.metrics,
      naturalizedCadence: true,
      preferredInterClassGapMinutes: PREFERRED_INTERCLASS_GAP_MINUTES,
      deterministicCadence: true,
      existingClassesConsidered,
      rebalancedExistingClasses,
      softStabilityRebalance: true,
    }),
    policy: Object.freeze({
      ...result.policy,
      deterministicCadenceNaturalization: true,
      preferredInterClassGapMinutes: PREFERRED_INTERCLASS_GAP_MINUTES,
      preferredInterClassGapMaximumMinutes: PREFERRED_INTERCLASS_GAP_MAX_MINUTES,
      trueRandomnessUsed: false,
      existingFutureClassesMayShiftForIntegratedSemesterCadence: true,
      elapsedClassesRemainFixed: true,
    }),
    stateDigest,
  });
}

module.exports = {
  PREFERRED_INTERCLASS_GAP_MINUTES,
  PREFERRED_INTERCLASS_GAP_MAX_MINUTES,
  stableJitter,
  dayDistance,
  conflictsWithClassBlock,
  naturalizeScheduleResult,
};
