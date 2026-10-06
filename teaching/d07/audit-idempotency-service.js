'use strict';

const { digest } = require('./contracts');
const { TPF02_FAMILY_VERSION, TPF02_OUTPUT_SCHEMA_VERSION } = require('./tpf02-direct');

function sourceInventoryDigest(sources = []) {
  return digest((sources || []).map((source) => [source.source_ref, source.content_hash]));
}

function currentValidatedAudit(setup) {
  const course = setup?.course;
  const audit = setup?.curriculumAudit;
  const sources = Array.isArray(setup?.sources) ? setup.sources : [];
  if (!course || !audit || !sources.length) return null;

  const stateVersion = String(course.state_version ?? '').trim();
  const courseId = String(course.course_id ?? '').trim();
  if (!stateVersion || !courseId) return null;

  const expectedStateRef = `teaching_course:${courseId}:state:${stateVersion}`;
  const expectedDigest = sourceInventoryDigest(sources);
  const metadata = audit.validation_metadata && typeof audit.validation_metadata === 'object'
    ? audit.validation_metadata
    : {};

  if (String(audit.prompt_family_version || '') !== TPF02_FAMILY_VERSION) return null;
  if (String(audit.output_schema_version || '') !== TPF02_OUTPUT_SCHEMA_VERSION) return null;
  if (metadata.lineage_reconciled !== true) return null;
  if (String(audit.status || '').toUpperCase() !== 'VALIDATED_CANDIDATE') return null;
  if (String(audit.input_state_reference || '') !== expectedStateRef) return null;
  if (String(audit.source_inventory_digest || '') !== expectedDigest) return null;
  if (String(metadata.state_version ?? '') !== stateVersion) return null;
  if (Number(metadata.source_census) !== sources.length) return null;
  if (metadata.domain_validated !== true) return null;
  return audit;
}

function decorateAuditIdempotency(service) {
  if (!service || typeof service.getSetup !== 'function' || typeof service.runAudit !== 'function') {
    throw new TypeError('D07 audit idempotency requires a D07 service.');
  }
  const baseRunAudit = service.runAudit.bind(service);

  return Object.freeze({
    ...service,
    async runAudit(user, courseId) {
      const setup = await service.getSetup(user, courseId);
      const existing = currentValidatedAudit(setup);
      if (existing) return existing;
      return baseRunAudit(user, courseId);
    },
  });
}

module.exports = {
  sourceInventoryDigest,
  currentValidatedAudit,
  decorateAuditIdempotency,
};
