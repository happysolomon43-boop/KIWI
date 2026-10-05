'use strict';

const { createD14ClassroomRepository: createBaseD14ClassroomRepository } = require('./d14-classroom');

const CLASSROOM_EARLY_ENTRY_MINUTES = 60;
const MINUTE_MS = 60 * 1000;

function classroomEntryWindow({ scheduledStartAt, scheduledEndAt, serverNow, lifecycleState = null } = {}) {
  const start = Date.parse(scheduledStartAt);
  const end = Date.parse(scheduledEndAt);
  const now = Date.parse(serverNow);
  if (![start, end, now].every(Number.isFinite)) {
    const error = new Error('Classroom entry timing is unavailable.');
    error.code = 'TEACHING_D14_CLASSROOM_TIME_INVALID';
    error.status = 503;
    throw error;
  }
  const opensAt = start - CLASSROOM_EARLY_ENTRY_MINUTES * MINUTE_MS;
  const state = String(lifecycleState || '').toUpperCase();
  return Object.freeze({
    opensAt: new Date(opensAt).toISOString(),
    scheduledStartAt: new Date(start).toISOString(),
    scheduledEndAt: new Date(end).toISOString(),
    serverNow: new Date(now).toISOString(),
    cancelled: state === 'CANCELLED',
    canEnter: state !== 'CANCELLED' && now >= opensAt,
    waitingRoom: state !== 'CANCELLED' && now >= opensAt && now < start,
    classTimeReached: now >= start,
    classEnded: now >= end,
  });
}

function createD14ClassroomRepository(options = {}) {
  const { query } = options;
  const base = createBaseD14ClassroomRepository(options);
  if (typeof query !== 'function') return base;

  async function timingForClass(studentId, classId) {
    const { rows = [] } = await query(
      `select class_id,scheduled_start_at,scheduled_end_at,lifecycle_state,now() as server_now
         from public.teaching_classes
        where student_id=$1 and class_id=$2
        limit 1`,
      [studentId, classId]
    );
    const row = rows[0];
    if (!row) {
      const error = new Error('Teaching Class not found.');
      error.code = 'TEACHING_D14_CLASS_NOT_FOUND';
      error.status = 404;
      throw error;
    }
    return classroomEntryWindow({
      scheduledStartAt: row.scheduled_start_at,
      scheduledEndAt: row.scheduled_end_at,
      serverNow: row.server_now,
      lifecycleState: row.lifecycle_state,
    });
  }

  async function listClasses(studentId, courseId) {
    const [rows, serverClock] = await Promise.all([
      base.listClasses(studentId, courseId),
      query('select now() as server_now'),
    ]);
    const serverNow = serverClock.rows?.[0]?.server_now || new Date().toISOString();
    return rows.map((row) => {
      const entry = classroomEntryWindow({
        scheduledStartAt: row.scheduled_start_at,
        scheduledEndAt: row.scheduled_end_at,
        serverNow,
        lifecycleState: row.lifecycle_state,
      });
      return Object.freeze({
        ...row,
        server_now: entry.serverNow,
        entry_opens_at: entry.opensAt,
        entry_waiting_room: entry.waitingRoom,
      });
    });
  }

  async function recordInteraction(input = {}) {
    if (String(input.kind || '').toUpperCase() === 'JOIN') {
      const entry = await timingForClass(input.studentId, input.classId);
      if (entry.cancelled) {
        const error = new Error('This Class has been cancelled.');
        error.code = 'TEACHING_D14_CLASS_CANCELLED';
        error.status = 409;
        throw error;
      }
      if (!entry.canEnter) {
        const error = new Error('Classroom opens one hour before the scheduled Class time.');
        error.code = 'TEACHING_D14_CLASSROOM_NOT_OPEN';
        error.status = 425;
        error.details = Object.freeze({
          entryOpensAt: entry.opensAt,
          scheduledStartAt: entry.scheduledStartAt,
          serverNow: entry.serverNow,
        });
        throw error;
      }
    }
    return base.recordInteraction(input);
  }

  return Object.freeze({
    ...base,
    listClasses,
    recordInteraction,
    timingForClass,
  });
}

module.exports = {
  CLASSROOM_EARLY_ENTRY_MINUTES,
  classroomEntryWindow,
  createD14ClassroomRepository,
};
