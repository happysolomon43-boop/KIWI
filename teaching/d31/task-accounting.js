'use strict';

const { D31_TASK_IDS } = require('./contracts');

const TASK_ACCOUNTING = Object.freeze({
  'TCH-0680': Object.freeze({
    area: 'privacy_security_release_review',
    anchors: Object.freeze([
      'teaching/d31/security-privacy-review.md',
      'teaching/d31/owner-release-override.js',
      'teaching/d28',
      'scripts/verify-teaching-d28-operational-hardening.js',
    ]),
  }),
  'TCH-0681': Object.freeze({
    area: 'visual_accessibility_release_review',
    anchors: Object.freeze([
      'teaching/d31/visual-accessibility-review.md',
      'public/teaching.html',
      'public/teaching-d24.css',
      'scripts/verify-teaching-d24-responsive-accessibility.js',
    ]),
  }),
  'TCH-0682': Object.freeze({
    area: 'canonical_traceability_reconciliation',
    anchors: Object.freeze([
      'teaching/d31/contracts.js',
      'teaching/d31/traceability-reconciliation.md',
      'scripts/verify-teaching-d31-release-readiness.js',
    ]),
  }),
  'TCH-0683': Object.freeze({
    area: 'in_product_academic_limitations',
    anchors: Object.freeze([
      'teaching/d31/academic-limitations.js',
      'public/teaching.html',
      'tests/ai/teaching-d31-limitations.test.js',
    ]),
  }),
});

function assertD31TaskAccountingComplete() {
  const expected = [...D31_TASK_IDS].sort();
  const actual = Object.keys(TASK_ACCOUNTING).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    const missing = expected.filter((id) => !actual.includes(id));
    const extra = actual.filter((id) => !expected.includes(id));
    throw new Error(`D31 task accounting drift. Missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}`);
  }
  for (const [id, entry] of Object.entries(TASK_ACCOUNTING)) {
    if (!entry.area || !Array.isArray(entry.anchors) || entry.anchors.length === 0) {
      throw new Error(`D31 task accounting incomplete for ${id}.`);
    }
  }
  return true;
}

assertD31TaskAccountingComplete();

module.exports = Object.freeze({ TASK_ACCOUNTING, assertD31TaskAccountingComplete });
