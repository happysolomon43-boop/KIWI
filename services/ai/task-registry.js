'use strict';

const { AI_CAPABILITIES, AI_INPUT_MODALITIES } = require('./capabilities');
const { REASONING_LEVELS } = require('./reasoning');

const AI_CLASSES = Object.freeze({
  VVIP: 'VVIP',
  VIP: 'VIP',
  IP: 'IP',
});

const AI_EXECUTION_LANES = Object.freeze({
  CRITICAL: 'CRITICAL',
  INTERACTIVE: 'INTERACTIVE',
  BACKGROUND: 'BACKGROUND',
});

const RETRY_POLICIES = Object.freeze({
  VVIP_GENERATION: 'VVIP_GENERATION',
  VIP_ANALYSIS: 'VIP_ANALYSIS',
  IP_FAST: 'IP_FAST',
});

const RETRY_POLICY_CONFIG = Object.freeze({
  [RETRY_POLICIES.VVIP_GENERATION]: Object.freeze({
    maxAttempts: 20,
    maxAttemptsPerRoute: 2,
    maxDailyQuotaAttemptsPerRoute: 15,
    maxShortRateLimitAttemptsPerRoute: 3,
    maxTransientAttemptsPerRoute: 2,
  }),
  [RETRY_POLICIES.VIP_ANALYSIS]: Object.freeze({
    maxAttempts: 14,
    maxAttemptsPerRoute: 2,
    maxDailyQuotaAttemptsPerRoute: 10,
    maxShortRateLimitAttemptsPerRoute: 3,
    maxTransientAttemptsPerRoute: 2,
  }),
  [RETRY_POLICIES.IP_FAST]: Object.freeze({
    maxAttempts: 8,
    maxAttemptsPerRoute: 2,
    maxDailyQuotaAttemptsPerRoute: 4,
    maxShortRateLimitAttemptsPerRoute: 2,
    maxTransientAttemptsPerRoute: 2,
  }),
});

function task(config) {
  const defaultLane = config.class === AI_CLASSES.VVIP
    ? AI_EXECUTION_LANES.CRITICAL
    : AI_EXECUTION_LANES.INTERACTIVE;
  const capabilities = new Set([AI_CAPABILITIES.INFERENCE, AI_CAPABILITIES.REASONING]);
  if (config.structuredOutput) capabilities.add(AI_CAPABILITIES.STRUCTURED_OUTPUT);
  if (config.longOutput) capabilities.add(AI_CAPABILITIES.LONG_OUTPUT);
  return Object.freeze({
    class: config.class,
    reasoning: config.reasoning,
    executionLane: config.executionLane || defaultLane,
    capabilities: Object.freeze([...capabilities]),
    inputModalities: Object.freeze([...(config.inputModalities || [AI_INPUT_MODALITIES.TEXT])]),
    timeoutMs: config.timeoutMs,
    attemptTimeoutMs: config.attemptTimeoutMs || null,
    retryPolicy: config.retryPolicy,
    affinityGroup: config.affinityGroup || null,
    degradationAllowed: Boolean(config.degradationAllowed),
    emergencyFallback: config.emergencyFallback || null,
    generationDefaults: Object.freeze({ ...(config.generationDefaults || {}) }),
  });
}

const AI_TASKS = Object.freeze({
  MAIN_CBT: task({
    class: AI_CLASSES.VVIP,
    reasoning: REASONING_LEVELS.HIGH,
    longOutput: true,
    timeoutMs: 180000,
    attemptTimeoutMs: 75000,
    generationDefaults: { maxOutputTokens: 16384 },
    retryPolicy: RETRY_POLICIES.VVIP_GENERATION,
    affinityGroup: 'ASSESSMENT_GENERATION',
  }),
  RECKONING_CBT: task({
    class: AI_CLASSES.VVIP,
    reasoning: REASONING_LEVELS.HIGH,
    longOutput: true,
    timeoutMs: 180000,
    retryPolicy: RETRY_POLICIES.VVIP_GENERATION,
    affinityGroup: 'ASSESSMENT_GENERATION',
    emergencyFallback: 'DETERMINISTIC_RECKONING_EXAM',
  }),
  CBT_COMPLETION: task({
    class: AI_CLASSES.VVIP,
    reasoning: REASONING_LEVELS.HIGH,
    longOutput: true,
    timeoutMs: 180000,
    retryPolicy: RETRY_POLICIES.VVIP_GENERATION,
    affinityGroup: 'ASSESSMENT_GENERATION',
  }),
  CBT_QUESTION_AUDIT: task({
    class: AI_CLASSES.VVIP,
    reasoning: REASONING_LEVELS.HIGH,
    structuredOutput: true,
    timeoutMs: 35000,
    retryPolicy: RETRY_POLICIES.VVIP_GENERATION,
    affinityGroup: 'ASSESSMENT_INTEGRITY',
  }),
  FLASHCARD_GENERATION: task({
    class: AI_CLASSES.VVIP,
    reasoning: REASONING_LEVELS.HIGH,
    longOutput: true,
    timeoutMs: 120000,
    retryPolicy: RETRY_POLICIES.VVIP_GENERATION,
    affinityGroup: 'KNOWLEDGE_CREATION',
  }),
  IMPORT_IMAGE_EXTRACTION: task({
    class: AI_CLASSES.VVIP,
    reasoning: REASONING_LEVELS.MEDIUM,
    structuredOutput: true,
    inputModalities: [AI_INPUT_MODALITIES.TEXT, AI_INPUT_MODALITIES.IMAGE],
    timeoutMs: 60000,
    retryPolicy: RETRY_POLICIES.VVIP_GENERATION,
    affinityGroup: 'KNOWLEDGE_CREATION',
  }),
  QUICK_QUESTIONS: task({
    class: AI_CLASSES.VIP,
    reasoning: REASONING_LEVELS.MEDIUM,
    timeoutMs: 60000,
    retryPolicy: RETRY_POLICIES.VIP_ANALYSIS,
  }),
  STUDY_TASK_GENERATION: task({
    class: AI_CLASSES.VIP,
    executionLane: AI_EXECUTION_LANES.BACKGROUND,
    reasoning: REASONING_LEVELS.MEDIUM,
    structuredOutput: true,
    timeoutMs: 60000,
    retryPolicy: RETRY_POLICIES.VIP_ANALYSIS,
    degradationAllowed: true,
  }),
  CONCEPT_CLUSTERING: task({
    class: AI_CLASSES.VIP,
    reasoning: REASONING_LEVELS.MEDIUM,
    structuredOutput: true,
    timeoutMs: 60000,
    retryPolicy: RETRY_POLICIES.VIP_ANALYSIS,
  }),
  WEEKLY_CHRONICLE: task({
    class: AI_CLASSES.VIP,
    reasoning: REASONING_LEVELS.MEDIUM,
    timeoutMs: 60000,
    retryPolicy: RETRY_POLICIES.VIP_ANALYSIS,
  }),
  WEEKLY_ANCHOR: task({
    class: AI_CLASSES.VIP,
    reasoning: REASONING_LEVELS.MEDIUM,
    timeoutMs: 45000,
    retryPolicy: RETRY_POLICIES.VIP_ANALYSIS,
    degradationAllowed: true,
  }),
  MORNING_BRIEF: task({
    class: AI_CLASSES.VIP,
    executionLane: AI_EXECUTION_LANES.BACKGROUND,
    reasoning: REASONING_LEVELS.LOW,
    timeoutMs: 45000,
    retryPolicy: RETRY_POLICIES.VIP_ANALYSIS,
    degradationAllowed: true,
  }),
  DAILY_INVITATIONS: task({
    class: AI_CLASSES.VIP,
    reasoning: REASONING_LEVELS.MEDIUM,
    structuredOutput: true,
    timeoutMs: 60000,
    retryPolicy: RETRY_POLICIES.VIP_ANALYSIS,
    degradationAllowed: true,
  }),
  BUBBLE_ADVISORY: task({
    class: AI_CLASSES.VIP,
    reasoning: REASONING_LEVELS.MEDIUM,
    timeoutMs: 60000,
    retryPolicy: RETRY_POLICIES.VIP_ANALYSIS,
  }),
  PRESSURE_EXPLANATION: task({
    class: AI_CLASSES.VIP,
    reasoning: REASONING_LEVELS.MEDIUM,
    timeoutMs: 60000,
    retryPolicy: RETRY_POLICIES.VIP_ANALYSIS,
    degradationAllowed: true,
  }),
  DEEP_AUDIT: task({
    class: AI_CLASSES.VIP,
    reasoning: REASONING_LEVELS.HIGH,
    timeoutMs: 90000,
    retryPolicy: RETRY_POLICIES.VIP_ANALYSIS,
  }),
  EXAM_DEBRIEF: task({
    class: AI_CLASSES.VIP,
    reasoning: REASONING_LEVELS.MEDIUM,
    timeoutMs: 60000,
    retryPolicy: RETRY_POLICIES.VIP_ANALYSIS,
    degradationAllowed: true,
  }),
  RECKONING_DEBRIEF: task({
    class: AI_CLASSES.VIP,
    reasoning: REASONING_LEVELS.MEDIUM,
    timeoutMs: 60000,
    retryPolicy: RETRY_POLICIES.VIP_ANALYSIS,
    degradationAllowed: true,
  }),
  LIVING_PERSONA: task({
    class: AI_CLASSES.VIP,
    reasoning: REASONING_LEVELS.MEDIUM,
    structuredOutput: true,
    timeoutMs: 60000,
    retryPolicy: RETRY_POLICIES.VIP_ANALYSIS,
  }),
  WEEKLY_PERSONA: task({
    class: AI_CLASSES.VIP,
    reasoning: REASONING_LEVELS.LOW,
    timeoutMs: 45000,
    retryPolicy: RETRY_POLICIES.VIP_ANALYSIS,
    degradationAllowed: true,
  }),
  LIVING_ACHIEVEMENTS: task({
    class: AI_CLASSES.VIP,
    reasoning: REASONING_LEVELS.MEDIUM,
    structuredOutput: true,
    timeoutMs: 60000,
    retryPolicy: RETRY_POLICIES.VIP_ANALYSIS,
  }),
  CARD_EXPLANATION: task({
    class: AI_CLASSES.IP,
    reasoning: REASONING_LEVELS.MINIMAL,
    timeoutMs: 25000,
    retryPolicy: RETRY_POLICIES.IP_FAST,
    degradationAllowed: true,
  }),
  RECLASSIFICATION_ALERT: task({
    class: AI_CLASSES.IP,
    reasoning: REASONING_LEVELS.MINIMAL,
    timeoutMs: 30000,
    retryPolicy: RETRY_POLICIES.IP_FAST,
    degradationAllowed: true,
  }),
  MASTERY_MOMENT: task({
    class: AI_CLASSES.IP,
    reasoning: REASONING_LEVELS.MINIMAL,
    timeoutMs: 30000,
    retryPolicy: RETRY_POLICIES.IP_FAST,
    degradationAllowed: true,
  }),
  ZONE_DESCRIPTION: task({
    class: AI_CLASSES.IP,
    reasoning: REASONING_LEVELS.LOW,
    timeoutMs: 30000,
    retryPolicy: RETRY_POLICIES.IP_FAST,
    degradationAllowed: true,
  }),
  HIDDEN_DISCOVERY: task({
    class: AI_CLASSES.IP,
    reasoning: REASONING_LEVELS.LOW,
    structuredOutput: true,
    timeoutMs: 30000,
    retryPolicy: RETRY_POLICIES.IP_FAST,
    degradationAllowed: true,
  }),
  RETURN_GREETING: task({
    class: AI_CLASSES.IP,
    reasoning: REASONING_LEVELS.MINIMAL,
    timeoutMs: 30000,
    retryPolicy: RETRY_POLICIES.IP_FAST,
    degradationAllowed: true,
  }),
  CHRONICLE_ARTIFACT: task({
    class: AI_CLASSES.IP,
    reasoning: REASONING_LEVELS.MINIMAL,
    timeoutMs: 30000,
    retryPolicy: RETRY_POLICIES.IP_FAST,
    degradationAllowed: true,
  }),
});

const CANONICAL_AI_TASK_IDS = Object.freeze(Object.keys(AI_TASKS));

function validateTaskRegistry(registry = AI_TASKS) {
  const errors = [];
  const classValues = new Set(Object.values(AI_CLASSES));
  const laneValues = new Set(Object.values(AI_EXECUTION_LANES));
  const reasoningValues = new Set(Object.values(REASONING_LEVELS));
  const retryValues = new Set(Object.values(RETRY_POLICIES));

  for (const [taskId, config] of Object.entries(registry)) {
    if (!/^[A-Z0-9_]+$/.test(taskId)) errors.push(`${taskId}: task ID must be UPPER_SNAKE_CASE`);
    if (!classValues.has(config.class)) errors.push(`${taskId}: invalid class`);
    if (!laneValues.has(config.executionLane)) errors.push(`${taskId}: invalid execution lane`);
    if (!reasoningValues.has(config.reasoning)) errors.push(`${taskId}: invalid reasoning level`);
    if (!retryValues.has(config.retryPolicy)) errors.push(`${taskId}: invalid retry policy`);
    if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1000) errors.push(`${taskId}: timeoutMs must be an integer >= 1000`);
    if (config.attemptTimeoutMs != null && (!Number.isInteger(config.attemptTimeoutMs) || config.attemptTimeoutMs < 1000 || config.attemptTimeoutMs > config.timeoutMs)) {
      errors.push(`${taskId}: attemptTimeoutMs must be null or an integer between 1000 and timeoutMs`);
    }
    if (!Array.isArray(config.capabilities) || !config.capabilities.includes(AI_CAPABILITIES.INFERENCE)) errors.push(`${taskId}: INFERENCE capability is required`);
    if (!Array.isArray(config.inputModalities) || !config.inputModalities.includes(AI_INPUT_MODALITIES.TEXT)) errors.push(`${taskId}: TEXT input modality is required`);
    if (config.class === AI_CLASSES.VVIP && config.degradationAllowed) errors.push(`${taskId}: VVIP tasks cannot silently degrade`);
  }
  return errors;
}

module.exports = {
  AI_CLASSES,
  AI_EXECUTION_LANES,
  REASONING_LEVELS,
  RETRY_POLICIES,
  RETRY_POLICY_CONFIG,
  AI_TASKS,
  CANONICAL_AI_TASK_IDS,
  validateTaskRegistry,
};
