'use strict';

const { createD09SchedulingRepository: createBaseD09SchedulingRepository } = require('./d09-load-estimation');
const { naturalizeScheduleResult } = require('../d09/schedule-naturalizer');

function createD09SchedulingRepository(options = {}) {
  const base = createBaseD09SchedulingRepository(options);
  if (!base || typeof base.saveProposalUsing !== 'function') return base;

  async function saveProposalUsing(tx, args = {}) {
    const result = naturalizeScheduleResult(args.context || {}, args.result, { source: args.source || 'AUTOMATIC' });
    return base.saveProposalUsing(tx, { ...args, result });
  }

  return Object.freeze({
    ...base,
    saveProposalUsing,
  });
}

module.exports = { createD09SchedulingRepository };
