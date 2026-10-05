'use strict';
const contracts = require('./contracts');
const { createD25ReliabilityService: createBaseD25ReliabilityService } = require('./service');
const { mountD25Routes } = require('./routes');
function createD25ReliabilityService(options = {}) {
  const base = createBaseD25ReliabilityService(options);
  const d09 = options.foundation?.d09?.service || null;
  async function recoverInvalidCourseTimetable(user, courseId) {
    if (!d09 || typeof d09.recoverSystemInvalidTimetable !== 'function') {
      const error = new Error('Scheduler system-failure recovery is unavailable.');
      error.code = 'TEACHING_D25_TIMETABLE_RECOVERY_UNAVAILABLE';
      error.status = 503;
      throw error;
    }
    return d09.recoverSystemInvalidTimetable(user, courseId);
  }
  return Object.freeze({ ...base, recoverInvalidCourseTimetable });
}
module.exports = { ...contracts, createD25ReliabilityService, mountD25Routes };
