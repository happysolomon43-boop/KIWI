'use strict';

const { RECKONING_ENGINE } = require('./constants');

const RISK_MODEL_VERSION = 1;
const PLANNER_VERSION = 1;
const BLUEPRINT_VERSION = 1;
const VALIDATOR_VERSION = 1;
const EVIDENCE_MODEL_VERSION = 1;
const SCHEDULER_VERSION = 1;
const SCORING_VERSION = 1;
const LEARNING_EFFECTS_VERSION = 1;

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

const DELIVERY_D_RECKONING_CONFIG = Object.freeze({
  engineVersion: RECKONING_ENGINE.ENGINE_VERSION,
  architectureVersion: RECKONING_ENGINE.ARCHITECTURE_VERSION,
  enabled: false,
  behaviorAuthority: 'legacy',
  riskModelVersion: RISK_MODEL_VERSION,
  plannerVersion: PLANNER_VERSION,
  blueprintVersion: BLUEPRINT_VERSION,
  validatorVersion: VALIDATOR_VERSION,
  evidenceModelVersion: EVIDENCE_MODEL_VERSION,
  schedulerVersion: SCHEDULER_VERSION,
  scoringVersion: SCORING_VERSION,
  learningEffectsVersion: LEARNING_EFFECTS_VERSION,
  configVersion: 3,
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
    maxEvidenceUnits: 10,
    minQuestionBudget: 5,
    softQuestionCap: 24,
    hardQuestionCap: 30,
  }),
  execution: Object.freeze({
    blockSize: 5,
    unrelatedSpacingQuestions: 2,
    safetyWindowMinutes: 45,
    controlCadence: 5,
  }),
  scoring: Object.freeze({
    recoveryThreshold: 75,
    rawAccuracyThreshold: 65,
    minEvidenceUnits: 5,
    recoveredCleanValue: 1.0,
    recoveredRemediatedValue: 0.8,
    provisionalValue: 0.5,
  }),
  learningEffects: Object.freeze({
    remediatedReviewDays: 3,
    unresolvedReviewDays: 1,
    minimumStage: 1,
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

const DELIVERY_C_RECKONING_CONFIG = DELIVERY_D_RECKONING_CONFIG;
const DELIVERY_B_RECKONING_CONFIG = DELIVERY_D_RECKONING_CONFIG;
const PHASE1_RECKONING_CONFIG = DELIVERY_D_RECKONING_CONFIG;

function createReckoningConfig(overrides = {}) {
  return Object.freeze({
    ...DELIVERY_D_RECKONING_CONFIG,
    ...overrides,
    risk: Object.freeze({
      ...DELIVERY_D_RECKONING_CONFIG.risk,
      ...(overrides.risk || {}),
      baseByState: Object.freeze({
        ...DELIVERY_D_RECKONING_CONFIG.risk.baseByState,
        ...(overrides.risk?.baseByState || {}),
      }),
      modifiers: Object.freeze({
        ...DELIVERY_D_RECKONING_CONFIG.risk.modifiers,
        ...(overrides.risk?.modifiers || {}),
      }),
    }),
    planner: Object.freeze({
      ...DELIVERY_D_RECKONING_CONFIG.planner,
      ...(overrides.planner || {}),
    }),
    execution: Object.freeze({
      ...DELIVERY_D_RECKONING_CONFIG.execution,
      ...(overrides.execution || {}),
    }),
    scoring: Object.freeze({
      ...DELIVERY_D_RECKONING_CONFIG.scoring,
      ...(overrides.scoring || {}),
    }),
    learningEffects: Object.freeze({
      ...DELIVERY_D_RECKONING_CONFIG.learningEffects,
      ...(overrides.learningEffects || {}),
    }),
    validation: Object.freeze({
      ...DELIVERY_D_RECKONING_CONFIG.validation,
      ...(overrides.validation || {}),
    }),
    // Delivery D completes backend consequences but does not activate V2 for legacy users.
    enabled: false,
    behaviorAuthority: 'legacy',
  });
}

const DELIVERY_E_RECKONING_CONFIG = Object.freeze({
  ...DELIVERY_D_RECKONING_CONFIG,
  enabled: true,
  behaviorAuthority: 'v2',
  configVersion: 4,
  planner: Object.freeze({
    ...DELIVERY_D_RECKONING_CONFIG.planner,
    maxEvidenceUnits: 10,
  }),
});

function createLiveReckoningConfig(overrides = {}) {
  return Object.freeze({
    ...createReckoningConfig(overrides),
    ...DELIVERY_E_RECKONING_CONFIG,
    ...overrides,
    risk: Object.freeze({
      ...DELIVERY_E_RECKONING_CONFIG.risk,
      ...(overrides.risk || {}),
      baseByState: Object.freeze({
        ...DELIVERY_E_RECKONING_CONFIG.risk.baseByState,
        ...(overrides.risk?.baseByState || {}),
      }),
      modifiers: Object.freeze({
        ...DELIVERY_E_RECKONING_CONFIG.risk.modifiers,
        ...(overrides.risk?.modifiers || {}),
      }),
    }),
    planner: Object.freeze({
      ...DELIVERY_E_RECKONING_CONFIG.planner,
      ...(overrides.planner || {}),
    }),
    execution: Object.freeze({
      ...DELIVERY_E_RECKONING_CONFIG.execution,
      ...(overrides.execution || {}),
    }),
    scoring: Object.freeze({
      ...DELIVERY_E_RECKONING_CONFIG.scoring,
      ...(overrides.scoring || {}),
    }),
    learningEffects: Object.freeze({
      ...DELIVERY_E_RECKONING_CONFIG.learningEffects,
      ...(overrides.learningEffects || {}),
    }),
    validation: Object.freeze({
      ...DELIVERY_E_RECKONING_CONFIG.validation,
      ...(overrides.validation || {}),
    }),
    enabled: true,
    behaviorAuthority: 'v2',
  });
}

module.exports = {
  RISK_MODEL_VERSION,
  PLANNER_VERSION,
  BLUEPRINT_VERSION,
  VALIDATOR_VERSION,
  EVIDENCE_MODEL_VERSION,
  SCHEDULER_VERSION,
  SCORING_VERSION,
  LEARNING_EFFECTS_VERSION,
  RISK_BASE_BY_STATE,
  RISK_MODIFIERS,
  DELIVERY_D_RECKONING_CONFIG,
  DELIVERY_E_RECKONING_CONFIG,
  DELIVERY_C_RECKONING_CONFIG,
  DELIVERY_B_RECKONING_CONFIG,
  PHASE1_RECKONING_CONFIG,
  createReckoningConfig,
  createLiveReckoningConfig,
};