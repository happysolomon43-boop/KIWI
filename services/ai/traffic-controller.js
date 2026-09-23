'use strict';

const { AI_CLASSES } = require('./task-registry');
const { AIError, AI_ERROR_CODES } = require('./errors');

const CONGESTION_LEVELS = Object.freeze({
  NORMAL: 'NORMAL',
  ELEVATED: 'ELEVATED',
  HIGH: 'HIGH',
  SEVERE: 'SEVERE',
});

const CLASS_WEIGHTS = Object.freeze({
  [AI_CLASSES.VVIP]: 4,
  [AI_CLASSES.VIP]: 2,
  [AI_CLASSES.IP]: 1,
});

const CONGESTION_SIGNAL_WEIGHTS = Object.freeze({
  [AI_ERROR_CODES.PROVIDER_OVERLOADED]: 3,
  [AI_ERROR_CODES.TRANSIENT]: 2,
  [AI_ERROR_CODES.TIMEOUT]: 1,
  [AI_ERROR_CODES.NETWORK]: 1,
  [AI_ERROR_CODES.RATE_LIMIT_RPM]: 1,
  [AI_ERROR_CODES.RATE_LIMIT_TPM]: 1,
  [AI_ERROR_CODES.RATE_LIMIT_RPD]: 1,
  [AI_ERROR_CODES.RATE_LIMIT_UNKNOWN]: 1,
});

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function createAITrafficController({
  env = process.env,
  clock = () => Date.now(),
  timers = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  },
} = {}) {
  const baseConcurrency = Math.floor(
    boundedNumber(env.AI_GLOBAL_CONCURRENCY, 6, 1, 32)
  );
  const maxQueue = Math.floor(
    boundedNumber(env.AI_MAX_QUEUE_DEPTH, 96, 4, 1000)
  );
  const signalWindowMs = boundedNumber(
    env.AI_CONGESTION_SIGNAL_WINDOW_MS,
    30000,
    5000,
    300000
  );

  const queueTimeoutMsByClass = Object.freeze({
    [AI_CLASSES.VVIP]: boundedNumber(
      env.AI_VVIP_QUEUE_TIMEOUT_MS,
      60000,
      1000,
      180000
    ),
    [AI_CLASSES.VIP]: boundedNumber(
      env.AI_VIP_QUEUE_TIMEOUT_MS,
      45000,
      1000,
      180000
    ),
    [AI_CLASSES.IP]: boundedNumber(
      env.AI_IP_QUEUE_TIMEOUT_MS,
      30000,
      1000,
      180000
    ),
  });

  const queues = new Map(
    Object.values(AI_CLASSES).map((taskClass) => [taskClass, []])
  );
  const activeByClass = Object.fromEntries(
    Object.values(AI_CLASSES).map((taskClass) => [taskClass, 0])
  );
  const admittedByClass = Object.fromEntries(
    Object.values(AI_CLASSES).map((taskClass) => [taskClass, 0])
  );
  const timedOutByClass = Object.fromEntries(
    Object.values(AI_CLASSES).map((taskClass) => [taskClass, 0])
  );

  const weightedSchedule = [];
  for (const taskClass of [AI_CLASSES.VVIP, AI_CLASSES.VIP, AI_CLASSES.IP]) {
    for (let i = 0; i < CLASS_WEIGHTS[taskClass]; i++) {
      weightedSchedule.push(taskClass);
    }
  }

  let scheduleCursor = 0;
  let active = 0;
  let peakActive = 0;
  let sequence = 0;
  let congestionSignals = [];
  let admittedTotal = 0;
  let rejectedOverflowTotal = 0;
  let timedOutTotal = 0;
  let providerSignalsTotal = 0;

  function nowMs() {
    const value = clock();
    if (value instanceof Date) return value.getTime();
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : Date.now();
  }

  function pruneSignals(now = nowMs()) {
    congestionSignals = congestionSignals.filter(
      (signal) => now - signal.at <= signalWindowMs
    );
  }

  function congestionScore() {
    pruneSignals();
    return congestionSignals.reduce((sum, signal) => sum + signal.weight, 0);
  }

  function congestionLevelFromScore(score) {
    if (score >= 6) return CONGESTION_LEVELS.SEVERE;
    if (score >= 3) return CONGESTION_LEVELS.HIGH;
    if (score >= 1) return CONGESTION_LEVELS.ELEVATED;
    return CONGESTION_LEVELS.NORMAL;
  }

  function effectiveConcurrencyFromScore(score) {
    if (score >= 6) return 1;
    if (score >= 3) return Math.max(1, Math.min(baseConcurrency, 2));
    if (score >= 1) {
      return Math.max(1, Math.ceil(baseConcurrency * 0.66));
    }
    return baseConcurrency;
  }

  function congestionState() {
    const score = congestionScore();
    return {
      score,
      level: congestionLevelFromScore(score),
      effectiveConcurrency: effectiveConcurrencyFromScore(score),
    };
  }

  function queuedByClass() {
    return Object.fromEntries(
      Object.values(AI_CLASSES).map((taskClass) => [
        taskClass,
        queues.get(taskClass).length,
      ])
    );
  }

  function queueDepth() {
    let total = 0;
    for (const queue of queues.values()) total += queue.length;
    return total;
  }

  function nextQueuedItem() {
    if (queueDepth() === 0) return null;

    for (let step = 0; step < weightedSchedule.length; step++) {
      const index = (scheduleCursor + step) % weightedSchedule.length;
      const taskClass = weightedSchedule[index];
      const queue = queues.get(taskClass);
      if (!queue.length) continue;

      scheduleCursor = (index + 1) % weightedSchedule.length;
      return queue.shift();
    }

    return null;
  }

  function removeQueuedItem(item) {
    const queue = queues.get(item.taskClass);
    const index = queue.indexOf(item);
    if (index < 0) return false;
    queue.splice(index, 1);
    return true;
  }

  function drain() {
    let state = congestionState();

    while (active < state.effectiveConcurrency && queueDepth() > 0) {
      const item = nextQueuedItem();
      if (!item) break;

      if (item.timer) timers.clearTimeout?.(item.timer);

      const admittedAt = nowMs();
      active += 1;
      activeByClass[item.taskClass] += 1;
      admittedByClass[item.taskClass] += 1;
      admittedTotal += 1;
      peakActive = Math.max(peakActive, active);

      let released = false;
      const lease = Object.freeze({
        id: item.id,
        taskId: item.taskId,
        taskClass: item.taskClass,
        queueWaitMs: Math.max(0, admittedAt - item.enqueuedAt),
        admittedAt: new Date(admittedAt),
        admissionLimit: state.effectiveConcurrency,
        congestionLevel: state.level,
        congestionScore: state.score,
        release() {
          if (released) return false;
          released = true;
          active = Math.max(0, active - 1);
          activeByClass[item.taskClass] = Math.max(
            0,
            activeByClass[item.taskClass] - 1
          );
          drain();
          return true;
        },
      });

      item.resolve(lease);
      state = congestionState();
    }
  }

  function queueTimeoutFor(taskClass, requestedTimeoutMs) {
    const classTimeout = queueTimeoutMsByClass[taskClass];
    const requested = Number(requestedTimeoutMs);
    if (!Number.isFinite(requested) || requested <= 0) return classTimeout;
    return Math.max(1000, Math.min(classTimeout, requested));
  }

  function acquire({
    taskId = null,
    taskClass,
    timeoutMs = null,
  } = {}) {
    if (!queues.has(taskClass)) {
      return Promise.reject(new AIError(
        `Unknown AI traffic class: ${taskClass || 'missing'}`,
        {
          code: AI_ERROR_CODES.CONFIG,
          retryable: false,
          scope: 'ORCHESTRATOR',
        }
      ));
    }

    if (queueDepth() >= maxQueue) {
      rejectedOverflowTotal += 1;
      return Promise.reject(new AIError(
        'KIWI AI traffic queue is full',
        {
          code: AI_ERROR_CODES.ORCHESTRATOR_BUSY,
          status: 503,
          retryable: true,
          scope: 'ORCHESTRATOR',
          retryAfterMs: 1000,
          details: {
            maxQueue,
            queued: queueDepth(),
            taskClass,
          },
        }
      ));
    }

    return new Promise((resolve, reject) => {
      const enqueuedAt = nowMs();
      const item = {
        id: `ai-admission-${++sequence}`,
        taskId,
        taskClass,
        enqueuedAt,
        resolve,
        reject,
        timer: null,
      };

      const waitMs = queueTimeoutFor(taskClass, timeoutMs);
      item.timer = timers.setTimeout?.(() => {
        if (!removeQueuedItem(item)) return;
        timedOutTotal += 1;
        timedOutByClass[taskClass] += 1;

        reject(new AIError(
          'KIWI AI request waited too long for execution capacity',
          {
            code: AI_ERROR_CODES.QUEUE_TIMEOUT,
            status: 503,
            retryable: true,
            scope: 'ORCHESTRATOR',
            retryAfterMs: 1000,
            details: {
              taskId,
              taskClass,
              queueWaitMs: Math.max(0, nowMs() - enqueuedAt),
              congestion: congestionState(),
            },
          }
        ));
        drain();
      }, waitMs);
      item.timer?.unref?.();

      queues.get(taskClass).push(item);
      drain();
    });
  }

  function noteFailure(error) {
    const weight = Number(CONGESTION_SIGNAL_WEIGHTS[error?.code]) || 0;
    if (weight <= 0) return snapshot();

    congestionSignals.push({
      at: nowMs(),
      weight,
      code: error.code,
      status: error.status ?? null,
    });
    providerSignalsTotal += 1;
    pruneSignals();
    drain();
    return snapshot();
  }

  function noteSuccess() {
    // Recovery is deliberately time-based instead of instantly erasing outage
    // evidence. This prevents concurrency from flapping back to full speed
    // after one lucky success while the provider is still unstable.
    pruneSignals();
    drain();
    return snapshot();
  }

  function snapshot() {
    const congestion = congestionState();
    const signalCounts = {};
    for (const signal of congestionSignals) {
      signalCounts[signal.code] = (signalCounts[signal.code] || 0) + 1;
    }

    return Object.freeze({
      baseConcurrency,
      effectiveConcurrency: congestion.effectiveConcurrency,
      congestionLevel: congestion.level,
      congestionScore: congestion.score,
      signalWindowMs,
      active,
      peakActive,
      activeByClass: Object.freeze({ ...activeByClass }),
      queued: queueDepth(),
      queuedByClass: Object.freeze(queuedByClass()),
      maxQueue,
      queueTimeoutMsByClass,
      admittedTotal,
      admittedByClass: Object.freeze({ ...admittedByClass }),
      timedOutTotal,
      timedOutByClass: Object.freeze({ ...timedOutByClass }),
      rejectedOverflowTotal,
      providerSignalsTotal,
      recentSignals: Object.freeze(signalCounts),
    });
  }

  return Object.freeze({
    acquire,
    noteFailure,
    noteSuccess,
    snapshot,
  });
}

module.exports = {
  CONGESTION_LEVELS,
  CLASS_WEIGHTS,
  CONGESTION_SIGNAL_WEIGHTS,
  createAITrafficController,
};
