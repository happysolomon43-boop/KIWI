'use strict';

const LEGACY_TRUNCATION_CODE = 'TEACHING_AI_OUTPUT_TRUNCATED';
const RECOVERY_REASON = 'LEGACY_TPF02_OUTPUT_TRUNCATED';

function decorateTruncationRecovery(service, { outboxStore = null, logger = console } = {}) {
  if (!service || typeof service.getSetup !== 'function' || typeof service.queueAudit !== 'function') {
    throw new TypeError('TPF-02 truncation recovery requires a D07 service.');
  }
  if (!outboxStore || typeof outboxStore.getById !== 'function') return service;

  const baseGetSetup = service.getSetup.bind(service);

  return Object.freeze({
    ...service,
    async getSetup(user, courseId) {
      const setup = await baseGetSetup(user, courseId);
      const background = setup?.backgroundAnalysis;
      if (setup?.curriculumAudit || !background?.event_id) return setup;
      if (String(background.status || '').toUpperCase() !== 'CANCELLED') return setup;

      let eventRow = null;
      try {
        eventRow = await outboxStore.getById(background.event_id);
      } catch (error) {
        logger?.warn?.('[KIWI Teaching D07] Could not inspect cancelled Curriculum Audit for truncation recovery.', {
          courseId: String(courseId),
          eventId: String(background.event_id),
          code: error?.code || null,
        });
        return setup;
      }

      if (!eventRow) return setup;
      if (String(eventRow.status || '').toUpperCase() !== 'CANCELLED') return setup;
      if (String(eventRow.last_error_code || '') !== LEGACY_TRUNCATION_CODE) return setup;

      // Only migrate the original failed one-shot audit. A replacement event is
      // causally linked to this event; if the staged strategy ever fails too,
      // that failure remains terminal and cannot create an automatic retry loop.
      if (eventRow.causation_id != null && String(eventRow.causation_id).trim()) return setup;

      try {
        const recovery = await service.queueAudit(user, courseId, {
          supersedeEventId: String(eventRow.event_id),
          causationId: String(eventRow.event_id),
        });
        return Object.freeze({
          ...setup,
          backgroundAnalysis: Object.freeze({
            ...background,
            event_id: recovery.jobId,
            status: recovery.status,
            last_error_code: null,
            recovered_from_event_id: String(eventRow.event_id),
            recovery_reason: RECOVERY_REASON,
          }),
        });
      } catch (error) {
        logger?.warn?.('[KIWI Teaching D07] Legacy truncated Curriculum Audit could not be requeued yet.', {
          courseId: String(courseId),
          eventId: String(eventRow.event_id),
          code: error?.code || null,
          message: String(error?.message || error).slice(0, 300),
        });
        return setup;
      }
    },
  });
}

module.exports = {
  LEGACY_TRUNCATION_CODE,
  RECOVERY_REASON,
  decorateTruncationRecovery,
};
