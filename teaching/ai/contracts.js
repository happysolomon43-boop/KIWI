'use strict';

const INTELLIGENCE_CLASSES = Object.freeze({
  DETERMINISTIC: 'DETERMINISTIC',
  DIRECT_AI: 'DIRECT-AI',
  HYBRID: 'HYBRID',
  EVENT_AI_HOOK: 'EVENT-AI-HOOK',
  BACKGROUND: 'BACKGROUND',
});

const AUTHORITY_LEVELS = Object.freeze({
  T0: 'T0',
  T1: 'T1',
  T2: 'T2',
  T3: 'T3',
  T4: 'T4',
});

const AUTHORITY_ORDER = Object.freeze(['T0', 'T1', 'T2', 'T3', 'T4']);

function assertIntelligenceClass(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!Object.values(INTELLIGENCE_CLASSES).includes(normalized)) {
    throw new TypeError(`Unsupported Teaching intelligence class: ${value}`);
  }
  return normalized;
}

function assertAuthorityLevel(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!AUTHORITY_ORDER.includes(normalized)) {
    throw new TypeError(`Unsupported Teaching authority level: ${value}`);
  }
  return normalized;
}

function authorityAtLeast(value, floor) {
  return AUTHORITY_ORDER.indexOf(assertAuthorityLevel(value)) >=
    AUTHORITY_ORDER.indexOf(assertAuthorityLevel(floor));
}

module.exports = {
  INTELLIGENCE_CLASSES,
  AUTHORITY_LEVELS,
  AUTHORITY_ORDER,
  assertIntelligenceClass,
  assertAuthorityLevel,
  authorityAtLeast,
};
