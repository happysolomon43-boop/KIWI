'use strict';

const { RECKONING_ENGINE } = require('./constants');

const RISK_MODEL_VERSION = 1;
const PLANNER_VERSION = 1;
const BLUEPRINT_VERSION = 1;
const VALIDATOR_VERSION = 1;

const RISK_BASE_BY_STATE = Object.freeze({
  DANGEROUS: 85,
  STUCK: 80,
  GHOST: 78,
  AVOIDED: 68,
  FRAGILE: 62,
  SLIPPING: 55,
  SEEDLING: 42,
  GROWING: 36,
  STABLE: 25,
  VERIFIED: 18,
});

const RISK_MODIFIERS = Object.freeze({
  bubbleCritical: 8,
  learningDebt: 8,
  unverified: 3,
  retrievabilityLow: 10,
  retrievabilityMedium: 5,
  stabilityVeryLow: 8,
  stabilityLow: 4,
  overdueSevere: 10,
  overdueModerate: 5,
  examProximityImmediate: 8,
  examProximityNear: 5,
  recentExamMissEach: 4,
  recentExamMissCap: 12,
  recentAgainHardEach: 2,
  recentAgainHardCap: 8,
});

const DELIVERY_B_RECKONING_CONFIG = Object.freeze({
  engineVersion: RECKONING_ENGINE.ENGINE_VERSION,
  architectureVersion: RECKONING_ENGINE.ARCHITECTURE_VERSION,
  enabled: false,
  behaviorAuthority: 'legacy',
  riskModelVersion: RISK_MODEL_VERSION,
  plannerVersion: PLANNER_VERSION,
  blueprintVersion: BLUEPRINT_VERSION,
  validatorVersion: VALIDATOR_VERSION,
  risk: Object.freeze({
    baseByState: RISK_BASE_BY_STATE,
    modifiers: RISK_MODIFIERS,
    criticalThreshold: 78,
    highThreshold: 55,
  }),
  planner: Object.freeze({
    controlSampleRatio: 0.15,
    minControls: 1,
    maxControls: 4,
    minEvidenceUnits: 5,
    maxSupportingUnits: 6,
    minQuestionBudget: 5,
    softQuestionCap: 24,
    hardQuestionCap: 30,
  }),
  validation: Object.freeze({
    maxStemSimilarity: 0.82,
    minStemLength: 12,
    placeholderPatterns: Object.freeze([
      /^option\s*[a-d]$/i,
      /^choice\s*\d+$/i,
      /^not applicable$/i,
      /^n\/a$/i,
      /^none$/i,
      /^placeholder$/i,
    ]),
  }),
});

const PHASE1_RECKONING_CONFIG = DELIVERY_B_RECKONING_CONFIG;

function createReckoningConfig(overrides = {}) {
  return Object.freeze({
    ...DELIVERY_B_RECKONING_CONFIG,
    ...overrides,
    risk: Object.freeze({
      ...DELIVERY_B_RECKONING_CONFIG.risk,
      ...(overrides.risk || {}),
      baseByState: Object.freeze({
        ...DELIVERY_B_RECKONING_CONFIG.risk.baseByState,
        ...(overrides.risk?.baseByState || {}),
      }),
      modifiers: Object.freeze({
        ...DELIVERY_B_RECKONING_CONFIG.risk.modifiers,
        ...(overrides.risk?.modifiers || {}),
      }),
    }),
    planner: Object.freeze({
      ...DELIVERY_B_RECKONING_CONFIG.planner,
      ...(overrides.planner || {}),
    }),
    validation: Object.freeze({
      ...DELIVERY_B_RECKONING_CONFIG.validation,
      ...(overrides.validation || {}),
    }),
    // Delivery B is shadow-only. It cannot become assessment authority.
    enabled: false,
    behaviorAuthority: 'legacy',
  });
}

module.exports = {
  RISK_MODEL_VERSION,
  PLANNER_VERSION,
  BLUEPRINT_VERSION,
  VALIDATOR_VERSION,
  RISK_BASE_BY_STATE,
  RISK_MODIFIERS,
  DELIVERY_B_RECKONING_CONFIG,
  PHASE1_RECKONING_CONFIG,
  createReckoningConfig,
};
