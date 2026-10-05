'use strict';

const ACADEMIC_LIMITATIONS = Object.freeze([
  Object.freeze({
    id: 'UNOBSERVED_PHYSICAL_SKILLS',
    title: 'Physical and practical skills are not directly observed',
    summary: 'KIWI cannot directly verify real-world technique, laboratory handling, handwriting process, spoken delivery, performance quality, or other physical execution unless a separate supported evidence source captures it.',
  }),
  Object.freeze({
    id: 'EXTERNAL_RESOURCE_VISIBILITY',
    title: 'Off-platform resources are only partially visible',
    summary: 'KIWI can reason over information available inside KIWI and supported materials you provide, but it cannot guarantee what books, websites, devices, people, or other external tools were or were not used outside the platform.',
  }),
  Object.freeze({
    id: 'AI_OWNER_OVERRIDE_NOT_EMPIRICAL_QUALIFICATION',
    title: 'AI assistance is owner-authorized while route qualification remains incomplete',
    summary: 'Teaching AI features are released under an explicit Product Owner authorization exception. Missing D30 route evidence is not treated as a qualification pass, and AI output remains assistive rather than an authoritative academic record.',
  }),
  Object.freeze({
    id: 'AUTHORITATIVE_RECORD_BOUNDARIES',
    title: 'Authoritative academic records remain owner-controlled',
    summary: 'AI suggestions cannot directly rewrite marks, gradebook truth, attendance, progression, locked assessment state, scheduling truth, or other frozen owner domains. Those records follow their deterministic validation and authorization paths.',
  }),
]);

function assertAcademicLimitationsComplete() {
  const ids = new Set(ACADEMIC_LIMITATIONS.map((item) => item.id));
  for (const required of ['UNOBSERVED_PHYSICAL_SKILLS','EXTERNAL_RESOURCE_VISIBILITY','AI_OWNER_OVERRIDE_NOT_EMPIRICAL_QUALIFICATION','AUTHORITATIVE_RECORD_BOUNDARIES']) {
    if (!ids.has(required)) throw new Error(`D31 academic limitation missing: ${required}`);
  }
  for (const item of ACADEMIC_LIMITATIONS) {
    if (!item.title || !item.summary) throw new Error(`D31 academic limitation is incomplete: ${item.id}`);
  }
  return true;
}

assertAcademicLimitationsComplete();

module.exports = Object.freeze({ ACADEMIC_LIMITATIONS, assertAcademicLimitationsComplete });
