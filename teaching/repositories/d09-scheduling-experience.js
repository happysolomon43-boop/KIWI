'use strict';

const { createD09SchedulingRepository: createBaseD09SchedulingRepository } = require('./d09-load-estimation');
const { naturalizeScheduleResult } = require('../d09/schedule-naturalizer');
const { normalizeReservePlacement } = require('../d09/reserve-placement');

function createD09SchedulingRepository(options = {}) {
  const base = createBaseD09SchedulingRepository(options);
  if (!base || typeof base.saveProposalUsing !== 'function') return base;

  async function saveProposalUsing(tx, args = {}) {
    const context = args.planningContext || args.context || {};
    const naturalized = args.source==='SYSTEM_SPACING_REPAIR'?args.result:naturalizeScheduleResult(context, args.result, { source: args.source || 'AUTOMATIC' });
    const result = args.source==='SYSTEM_SPACING_REPAIR'?naturalized:normalizeReservePlacement(context, naturalized, { source: args.source || 'AUTOMATIC' });
    return base.saveProposalUsing(tx, { ...args, result });
  }

  return Object.freeze({
    ...base,
    saveProposalUsing,
  });
}

module.exports = { createD09SchedulingRepository };
