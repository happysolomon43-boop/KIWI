'use strict';

/**
 * KIWI AI task registry.
 *
 * This is the production contract for every AI feature. Feature code supplies
 * content and feature-specific output constraints; class, reasoning intent,
 * model policy, quality floor, timeout and retry policy live here.
 */

const AI_CLASSES = Object.freeze({
  VVIP: 'VVIP',
  VIP: 'VIP',
  IP: 'IP',
});

const REASONING_LEVELS = Object.freeze({
  MINIMAL: 'MINIMAL',
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
});

const QUALITY_FLOORS = Object.freeze({
  FLASH: 'FLASH',
  FLASH_LITE: 'FLASH_LITE',
});

const MODEL_POLICIES = Object.freeze({
  TOP_STABLE_FLASH: 'TOP_STABLE_FLASH',
  VIP_STABLE_FLASH: 'VIP_STABLE_FLASH',
  TOP_STABLE_FLASH_LITE: 'TOP_STABLE_FLASH_LITE',
});

const RETRY_POLICIES = Object.freeze({
  VVIP_GENERATION: 'VVIP_GENERATION',
  VIP_ANALYSIS: 'VIP_ANALYSIS',
  IP_FAST: 'IP_FAST',
});

// Retry budgets distinguish project-slot quota failures from provider/model
// failures. A 429 is project+model scoped and should rotate keys. Provider 5xx
// failures require evidence from more than one independent project slot before
// a model circuit opens; this prevents one unlucky request from hiding a healthy
// model while still bounding provider-overload probes.
// This avoids request storms while still surviving exhausted or flaky routes.
const RETRY_POLICY_CONFIG = Object.freeze({
  [RETRY_POLICIES.VVIP_GENERATION]: Object.freeze({
    maxAttempts: 32,
    maxAttemptsPerModel: 2,
    maxQuotaAttemptsPerModel: 15,
    maxTransientAttemptsPerModel: 2,
  }),
  [RETRY_POLICIES.VIP_ANALYSIS]: Object.freeze({
    maxAttempts: 20,
    maxAttemptsPerModel: 2,
    maxQuotaAttemptsPerModel: 10,
    maxTransientAttemptsPerModel: 2,
  }),
  [RETRY_POLICIES.IP_FAST]: Object.freeze({
    maxAttempts: 8,
    maxAttemptsPerModel: 2,
    maxQuotaAttemptsPerModel: 4,
    maxTransientAttemptsPerModel: 2,
  }),
});

function task(config) {
  return Object.freeze({
    degradationAllowed: false,
    capabilities: Object.freeze([...(config.capabilities || [])]),
    ...config,
  });
}

const AI_TASKS = Object.freeze({
  MAIN_CBT: task({
    class: AI_CLASSES.VVIP,
    reasoning: REASONING_LEVELS.HIGH,
    modelPolicy: MODEL_POLICIES.TOP_STABLE_FLASH,
    qualityFloor: QUALITY_FLOORS.FLASH,
    capabilities: ['generateContent', 'thinking', 'longOutput'],
    timeoutMs: 180000,
    retryPolicy: RETRY_POLICIES.VVIP_GENERATION,
    affinityGroup: 'ASSESSMENT_GENERATION',
  }),

  RECKONING_CBT: task({
    class: AI_CLASSES.VVIP,
    reasoning: REASONING_LEVELS.HIGH,
    modelPolicy: MODEL_POLICIES.TOP_STABLE_FLASH,
    qualityFloor: QUALITY_FLOORS.FLASH,
    capabilities: ['generateContent', 'thinking', 'longOutput'],
    timeoutMs: 180000,
    retryPolicy: RETRY_POLICIES.VVIP_GENERATION,
    affinityGroup: 'ASSESSMENT_GENERATION',
    emergencyFallback: 'DETERMINISTIC_RECKONING_EXAM',
  }),

  CBT_COMPLETION: task({
    class: AI_CLASSES.VVIP,
    reasoning: REASONING_LEVELS.HIGH,
    modelPolicy: MODEL_POLICIES.TOP_STABLE_FLASH,
    qualityFloor: QUALITY_FLOORS.FLASH,
    capabilities: ['generateContent', 'thinking', 'longOutput'],
    timeoutMs: 180000,
    retryPolicy: RETRY_POLICIES.VVIP_GENERATION,
    affinityGroup: 'ASSESSMENT_GENERATION',
  }),

  CBT_QUESTION_AUDIT: task({
    class: AI_CLASSES.VVIP,
    reasoning: REASONING_LEVELS.HIGH,
    modelPolicy: MODEL_POLICIES.TOP_STABLE_FLASH,
    qualityFloor: QUALITY_FLOORS.FLASH,
    capabilities: ['generateContent', 'thinking', 'structuredOutput'],
    timeoutMs: 35000,
    retryPolicy: RETRY_POLICIES.VVIP_GENERATION,
    affinityGroup: 'ASSESSMENT_INTEGRITY',
  }),

  FLASHCARD_GENERATION: task({
    class: AI_CLASSES.VVIP,
    reasoning: REASONING_LEVELS.HIGH,
    modelPolicy: MODEL_POLICIES.TOP_STABLE_FLASH,
    qualityFloor: QUALITY_FLOORS.FLASH,
    capabilities: ['generateContent', 'thinking', 'longOutput'],
    timeoutMs: 120000,
    retryPolicy: RETRY_POLICIES.VVIP_GENERATION,
    affinityGroup: 'KNOWLEDGE_CREATION',
  }),

  IMPORT_IMAGE_EXTRACTION: task({
    class: AI_CLASSES.VVIP,
    reasoning: REASONING_LEVELS.MEDIUM,
    modelPolicy: MODEL_POLICIES.TOP_STABLE_FLASH,
    qualityFloor: QUALITY_FLOORS.FLASH,
    capabilities: ['generateContent', 'vision', 'structuredOutput'],
    timeoutMs: 60000,
    retryPolicy: RETRY_POLICIES.VVIP_GENERATION,
    affinityGroup: 'KNOWLEDGE_CREATION',
  }),

  QUICK_QUESTIONS: task({
    class: AI_CLASSES.VIP,
    reasoning: REASONING_LEVELS.MEDIUM,
    modelPolicy: MODEL_POLICIES.VIP_STABLE_FLASH,
    qualityFloor: QUALITY_FLOORS.FLASH,
    capabilities: ['generateContent', 'thinking'],
    timeoutMs: 60000,
    retryPolicy: RETRY_POLICIES.VIP_ANALYSIS,
  }),

  STUDY_TASK_GENERATION: task({
    class: AI_CLASSES.VIP,
    reasoning: REASONING_LEVELS.MEDIUM,
    modelPolicy: MODEL_POLICIES.VIP_STABLE_FLASH,
    qualityFloor: QUALITY_FLOORS.FLASH_LITE,
    capabilities: ['generateContent', 'structuredOutput'],
    timeoutMs: 60000,
    retryPolicy: RETRY_POLICIES.VIP_ANALYSIS,
    degradationAllowed: true,
  }),

  CONCEPT_CLUSTERING: task({
    class: AI_CLASSES.VIP,
    reasoning: REASONING_LEVELS.MEDIUM,
    modelPolicy: MODEL_POLICIES.VIP_STABLE_FLASH,
    qualityFloor: QUALITY_FLOORS.FLASH,
    capabilities: ['generateContent', 'structuredOutput'],
    timeoutMs: 60000,
    retryPolicy: RETRY_POLICIES.VIP_ANALYSIS,
  }),

  WEEKLY_CHRONICLE: task({
    class: AI_CLASSES.VIP,
    reasoning: REASONING_LEVELS.MEDIUM,
    modelPolicy: MODEL_POLICIES.VIP_STABLE_FLASH,
    qualityFloor: QUALITY_FLOORS.FLASH,
    capabilities: ['generateContent', 'thinking'],
    timeoutMs: 60000,
    retryPolicy: RETRY_POLICIES.VIP_ANALYSIS,
  }),

  WEEKLY_ANCHOR: task({
    class: AI_CLASSES.VIP,
    reasoning: REASONING_LEVELS.MEDIUM,
    modelPolicy: MODEL_POLICIES.VIP_STABLE_FLASH,
    qualityFloor: QUALITY_FLOORS.FLASH_LITE,
    capabilities: ['generateContent'],
    timeoutMs: 45000,
    retryPolicy: RETRY_POLICIES.VIP_ANALYSIS,
    degradationAllowed: true,
  }),

  MORNING_BRIEF: task({
    class: AI_CLASSES.VIP,
    reasoning: REASONING_LEVELS.LOW,
    modelPolicy: MODEL_POLICIES.VIP_STABLE_FLASH,
    qualityFloor: QUALITY_FLOORS.FLASH_LITE,
    capabilities: ['generateContent'],
    timeoutMs: 45000,
    retryPolicy: RETRY_POLICIES.VIP_ANALYSIS,
    degradationAllowed: true,
  }),

  DAILY_INVITATIONS: task({
    class: AI_CLASSES.VIP,
    reasoning: REASONING_LEVELS.MEDIUM,
    modelPolicy: MODEL_POLICIES.VIP_STABLE_FLASH,
    qualityFloor: QUALITY_FLOORS.FLASH_LITE,
    capabilities: ['generateContent', 'structuredOutput'],
    timeoutMs: 60000,
    retryPolicy: RETRY_POLICIES.VIP_ANALYSIS,
    degradationAllowed: true,
  }),

  BUBBLE_ADVISORY: task({
    class: AI_CLASSES.VIP,
    reasoning: REASONING_LEVELS.MEDIUM,
    modelPolicy: MODEL_POLICIES.VIP_STABLE_FLASH,
    qualityFloor: QUALITY_FLOORS.FLASH,
    capabilities: ['generateContent'],
    timeoutMs: 60000,
    retryPolicy: RETRY_POLICIES.VIP_ANALYSIS,
  }),

  PRESSURE_EXPLANATION: task({
    class: AI_CLASSES.VIP,
    reasoning: REASONING_LEVELS.MEDIUM,
    modelPolicy: MODEL_POLICIES.VIP_STABLE_FLASH,
    qualityFloor: QUALITY_FLOORS.FLASH_LITE,
    capabilities: ['generateContent'],
    timeoutMs: 60000,
    retryPolicy: RETRY_POLICIES.VIP_ANALYSIS,
    degradationAllowed: true,
  }),

  DEEP_AUDIT: task({
    class: AI_CLASSES.VIP,
    reasoning: REASONING_LEVELS.HIGH,
    modelPolicy: MODEL_POLICIES.VIP_STABLE_FLASH,
    qualityFloor: QUALITY_FLOORS.FLASH,
    capabilities: ['generateContent', 'thinking'],
    timeoutMs: 90000,
    retryPolicy: RETRY_POLICIES.VIP_ANALYSIS,
  }),

  EXAM_DEBRIEF: task({
    class: AI_CLASSES.VIP,
    reasoning: REASONING_LEVELS.MEDIUM,
    modelPolicy: MODEL_POLICIES.VIP_STABLE_FLASH,
    qualityFloor: QUALITY_FLOORS.FLASH_LITE,
    capabilities: ['generateContent'],
    timeoutMs: 60000,
    retryPolicy: RETRY_POLICIES.VIP_ANALYSIS,
    degradationAllowed: true,
  }),

  RECKONING_DEBRIEF: task({
    class: AI_CLASSES.VIP,
    reasoning: REASONING_LEVELS.MEDIUM,
    modelPolicy: MODEL_POLICIES.VIP_STABLE_FLASH,
    qualityFloor: QUALITY_FLOORS.FLASH_LITE,
    capabilities: ['generateContent'],
    timeoutMs: 60000,
    retryPolicy: RETRY_POLICIES.VIP_ANALYSIS,
    degradationAllowed: true,
  }),

  LIVING_PERSONA: task({
    class: AI_CLASSES.VIP,
    reasoning: REASONING_LEVELS.MEDIUM,
    modelPolicy: MODEL_POLICIES.VIP_STABLE_FLASH,
    qualityFloor: QUALITY_FLOORS.FLASH,
    capabilities: ['generateContent', 'structuredOutput'],
    timeoutMs: 60000,
    retryPolicy: RETRY_POLICIES.VIP_ANALYSIS,
  }),

  WEEKLY_PERSONA: task({
    class: AI_CLASSES.VIP,
    reasoning: REASONING_LEVELS.LOW,
    modelPolicy: MODEL_POLICIES.VIP_STABLE_FLASH,
    qualityFloor: QUALITY_FLOORS.FLASH_LITE,
    capabilities: ['generateContent'],
    timeoutMs: 45000,
    retryPolicy: RETRY_POLICIES.VIP_ANALYSIS,
    degradationAllowed: true,
  }),

  LIVING_ACHIEVEMENTS: task({
    class: AI_CLASSES.VIP,
    reasoning: REASONING_LEVELS.MEDIUM,
    modelPolicy: MODEL_POLICIES.VIP_STABLE_FLASH,
    qualityFloor: QUALITY_FLOORS.FLASH,
    capabilities: ['generateContent', 'structuredOutput'],
    timeoutMs: 60000,
    retryPolicy: RETRY_POLICIES.VIP_ANALYSIS,
  }),

  CARD_EXPLANATION: task({
    class: AI_CLASSES.IP,
    reasoning: REASONING_LEVELS.MINIMAL,
    modelPolicy: MODEL_POLICIES.TOP_STABLE_FLASH_LITE,
    qualityFloor: QUALITY_FLOORS.FLASH_LITE,
    capabilities: ['generateContent'],
    timeoutMs: 25000,
    retryPolicy: RETRY_POLICIES.IP_FAST,
    degradationAllowed: true,
  }),

  RECLASSIFICATION_ALERT: task({
    class: AI_CLASSES.IP,
    reasoning: REASONING_LEVELS.MINIMAL,
    modelPolicy: MODEL_POLICIES.TOP_STABLE_FLASH_LITE,
    qualityFloor: QUALITY_FLOORS.FLASH_LITE,
    capabilities: ['generateContent'],
    timeoutMs: 30000,
    retryPolicy: RETRY_POLICIES.IP_FAST,
    degradationAllowed: true,
  }),

  MASTERY_MOMENT: task({
    class: AI_CLASSES.IP,
    reasoning: REASONING_LEVELS.MINIMAL,
    modelPolicy: MODEL_POLICIES.TOP_STABLE_FLASH_LITE,
    qualityFloor: QUALITY_FLOORS.FLASH_LITE,
    capabilities: ['generateContent'],
    timeoutMs: 30000,
    retryPolicy: RETRY_POLICIES.IP_FAST,
    degradationAllowed: true,
  }),

  ZONE_DESCRIPTION: task({
    class: AI_CLASSES.IP,
    reasoning: REASONING_LEVELS.LOW,
    modelPolicy: MODEL_POLICIES.TOP_STABLE_FLASH_LITE,
    qualityFloor: QUALITY_FLOORS.FLASH_LITE,
    capabilities: ['generateContent'],
    timeoutMs: 30000,
    retryPolicy: RETRY_POLICIES.IP_FAST,
    degradationAllowed: true,
  }),

  HIDDEN_DISCOVERY: task({
    class: AI_CLASSES.IP,
    reasoning: REASONING_LEVELS.LOW,
    modelPolicy: MODEL_POLICIES.TOP_STABLE_FLASH_LITE,
    qualityFloor: QUALITY_FLOORS.FLASH_LITE,
    capabilities: ['generateContent', 'structuredOutput'],
    timeoutMs: 30000,
    retryPolicy: RETRY_POLICIES.IP_FAST,
    degradationAllowed: true,
  }),

  RETURN_GREETING: task({
    class: AI_CLASSES.IP,
    reasoning: REASONING_LEVELS.MINIMAL,
    modelPolicy: MODEL_POLICIES.TOP_STABLE_FLASH_LITE,
    qualityFloor: QUALITY_FLOORS.FLASH_LITE,
    capabilities: ['generateContent'],
    timeoutMs: 30000,
    retryPolicy: RETRY_POLICIES.IP_FAST,
    degradationAllowed: true,
  }),

  CHRONICLE_ARTIFACT: task({
    class: AI_CLASSES.IP,
    reasoning: REASONING_LEVELS.MINIMAL,
    modelPolicy: MODEL_POLICIES.TOP_STABLE_FLASH_LITE,
    qualityFloor: QUALITY_FLOORS.FLASH_LITE,
    capabilities: ['generateContent'],
    timeoutMs: 30000,
    retryPolicy: RETRY_POLICIES.IP_FAST,
    degradationAllowed: true,
  }),
});

const CANONICAL_AI_TASK_IDS = Object.freeze(Object.keys(AI_TASKS));

function validateTaskRegistry(registry = AI_TASKS) {
  const errors = [];
  const classValues = new Set(Object.values(AI_CLASSES));
  const reasoningValues = new Set(Object.values(REASONING_LEVELS));
  const floorValues = new Set(Object.values(QUALITY_FLOORS));
  const policyValues = new Set(Object.values(MODEL_POLICIES));
  const retryValues = new Set(Object.values(RETRY_POLICIES));

  for (const [taskId, config] of Object.entries(registry)) {
    if (!/^[A-Z0-9_]+$/.test(taskId)) errors.push(`${taskId}: task ID must be UPPER_SNAKE_CASE`);
    if (!classValues.has(config.class)) errors.push(`${taskId}: invalid class`);
    if (!reasoningValues.has(config.reasoning)) errors.push(`${taskId}: invalid reasoning level`);
    if (!floorValues.has(config.qualityFloor)) errors.push(`${taskId}: invalid quality floor`);
    if (!policyValues.has(config.modelPolicy)) errors.push(`${taskId}: invalid model policy`);
    if (!retryValues.has(config.retryPolicy)) errors.push(`${taskId}: invalid retry policy`);
    if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1000) {
      errors.push(`${taskId}: timeoutMs must be an integer >= 1000`);
    }
    if (!Array.isArray(config.capabilities) || config.capabilities.length === 0) {
      errors.push(`${taskId}: at least one capability is required`);
    }
    if (config.class === AI_CLASSES.VVIP && config.qualityFloor !== QUALITY_FLOORS.FLASH) {
      errors.push(`${taskId}: VVIP tasks must retain a FLASH quality floor`);
    }
    if (config.class === AI_CLASSES.VVIP && config.degradationAllowed) {
      errors.push(`${taskId}: VVIP tasks cannot silently degrade below their quality floor`);
    }
  }

  return errors;
}

module.exports = {
  AI_CLASSES,
  REASONING_LEVELS,
  QUALITY_FLOORS,
  MODEL_POLICIES,
  RETRY_POLICIES,
  RETRY_POLICY_CONFIG,
  AI_TASKS,
  CANONICAL_AI_TASK_IDS,
  validateTaskRegistry,
};
