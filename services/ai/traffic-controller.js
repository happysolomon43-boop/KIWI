'use strict';

const { AI_CLASSES, AI_EXECUTION_LANES } = require('./task-registry');
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

const LANE_PRIORITY = Object.freeze([
  AI_EXECUTION_LANES.CRITICAL,
  AI_EXECUTION_LANES.INTERACTIVE,
  AI_EXECUTION_LANES.BACKGROUND,
]);

const CONGESTION_SIGNAL_WEIGHTS = Object.freeze({
  // Project/model quota failures are deliberately excluded. Delivery A keeps
  // 429 health route-scoped; global backpressure reacts only to provider or
  // transport instability that can affect concurrent work across the pool.
  [AI_ERROR_CODES.PROVIDER_OVERLOADED]: 2,
  [AI_ERROR_CODES.TRANSIENT]: 1,
  [AI_ERROR_CODES.TIMEOUT]: 1,
  [AI_ERROR_CODES.NETWORK]: 1,
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
  logger = console,
} = {}) {
  const baseConcurrency = Math.floor(
    boundedNumber(env.AI_GLOBAL_CONCURRENCY, 6, 1, 32)
  );
  const maxQueue = Math.floor(
    boundedNumber(env.AI_MAX_QUEUE_DEPTH, 96, 4, 1000)
  );
  const backgroundConcurrency = Math.floor(
    boundedNumber(
      env.AI_BACKGROUND_CONCURRENCY,
      Math.max(1, Math.min(2, baseConcurrency - 1 || 1)),
      1,
      Math.max(1, baseConcurrency)
    )
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
  const activeByLane = Object.fromEntries(
    Object.values(AI_EXECUTION_LANES).map((lane) => [lane, 0])
  );
  const admittedByLane = Object.fromEntries(
    Object.values(AI_EXECUTION_LANES).map((lane) => [lane, 0])
  );
  const timedOutByLane = Object.fromEntries(
    Object.values(AI_EXECUTION_LANES).map((lane) => [lane, 0])
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
  let totalQueueWaitMs = 0;
  let maxQueueWaitMs = 0;
  let maxObservedQueue = 0;
  let lastCongestionChangeAt = null;

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
    if (score >= 8) return CONGESTION_LEVELS.SEVERE;
    if (score >= 4) return CONGESTION_LEVELS.HIGH;
    if (score >= 2) return CONGESTION_LEVELS.ELEVATED;
    return CONGESTION_LEVELS.NORMAL;
  }

  function effectiveConcurrencyFromScore(score) {
    if (score >= 8) return 1;
    if (score >= 4) return Math.max(1, Math.min(baseConcurrency, 2));
    if (score >= 2) {
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

  function queuedByLane() {
    const counts = Object.fromEntries(
      Object.values(AI_EXECUTION_LANES).map((lane) => [lane, 0])
    );
    for (const queue of queues.values()) {
      for (const item of queue) counts[item.executionLane] += 1;
    }
    return counts;
  }

  function queueDepth() {
    let total = 0;
    for (const queue of queues.values()) total += queue.length;
    return total;
  }

  function nextQueuedItem() {
    if (queueDepth() === 0) return null;

    for (const lane of LANE_PRIORITY) {
      if (
        lane === AI_EXECUTION_LANES.BACKGROUND &&
        activeByLane[AI_EXECUTION_LANES.BACKGROUND] >= backgroundConcurrency
      ) {
        continue;
      }

      for (let step = 0; step < weightedSchedule.length; step++) {
        const index = (scheduleCursor + step) % weightedSchedule.length;
        const taskClass = weightedSchedule[index];
        const queue = queues.get(taskClass);
        const itemIndex = queue.findIndex((item) => item.executionLane === lane);
        if (itemIndex < 0) continue;

        scheduleCursor = (index + 1) % weightedSchedule.length;
        return queue.splice(itemIndex, 1)[0];
      }
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
      activeByLane[item.executionLane] += 1;
      admittedByClass[item.taskClass] += 1;
      admittedByLane[item.executionLane] += 1;
      admittedTotal += 1;
      peakActive = Math.max(peakActive, active);

      const queueWaitMs = Math.max(0, admittedAt - item.enqueuedAt);
      totalQueueWaitMs += queueWaitMs;
      maxQueueWaitMs = Math.max(maxQueueWaitMs, queueWaitMs);

      let released = false;
      const lease = Object.freeze({
        id: item.id,
        taskId: item.taskId,
        taskClass: item.taskClass,
        executionLane: item.executionLane,
        queueWaitMs,
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
          activeByLane[item.executionLane] = Math.max(
            0,
            activeByLane[item.executionLane] - 1
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
    executionLane = null,
    timeoutMs = null,
  } = {}) {
    const resolvedLane = executionLane || (
      taskClass === AI_CLASSES.VVIP
        ? AI_EXECUTION_LANES.CRITICAL
        : AI_EXECUTION_LANES.INTERACTIVE
    );
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

    if (!Object.values(AI_EXECUTION_LANES).includes(resolvedLane)) {
      return Promise.reject(new AIError(
        `Unknown AI execution lane: ${resolvedLane || 'missing'}`,
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
            executionLane: resolvedLane,
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
        executionLane: resolvedLane,
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
        timedOutByLane[resolvedLane] += 1;

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
              executionLane: resolvedLane,
              queueWaitMs: Math.max(0, nowMs() - enqueuedAt),
              congestion: congestionState(),
            },
          }
        ));
        drain();
      }, waitMs);
      item.timer?.unref?.();

      queues.get(taskClass).push(item);
      maxObservedQueue = Math.max(maxObservedQueue, queueDepth());
      drain();
    });
  }

  function noteFailure(error, context = {}) {
    const weight = Number(CONGESTION_SIGNAL_WEIGHTS[error?.code]) || 0;
    if (weight <= 0) return snapshot();

    const before = congestionState();
    congestionSignals.push({
      at: nowMs(),
      weight,
      code: error.code,
      status: error.status ?? null,
      modelId: context.modelId || null,
      projectSlot: context.projectSlot || null,
    });
    providerSignalsTotal += 1;
    pruneSignals();
    const after = congestionState();

    if (after.effectiveConcurrency !== before.effectiveConcurrency) {
      lastCongestionChangeAt = new Date(nowMs());
      if (typeof logger?.warn === 'function') {
        logger.warn('[KIWI AI] adaptive backpressure changed concurrency', {
          from: before.effectiveConcurrency,
          to: after.effectiveConcurrency,
          level: after.level,
          score: after.score,
          code: error.code,
        });
      }
    }

    drain();
    return snapshot();
  }

  function noteSuccess() {
    // Recovery is deliberately time-based instead of instantly erasing outage
    // evidence. This prevents concurrency from flapping back to full speed
    // after one lucky success while the provider is still unstable.
    const before = congestionState();
    pruneSignals();
    const after = congestionState();
    if (after.effectiveConcurrency !== before.effectiveConcurrency) {
      lastCongestionChangeAt = new Date(nowMs());
    }
    drain();
    return snapshot();
  }

  function snapshot() {
    const congestion = congestionState();
    const signalCounts = {};
    for (const signal of congestionSignals) {
      signalCounts[signal.code] = (signalCounts[signal.code] || 0) + 1;
    }

    const now = nowMs();
    const oldestQueuedAt = [...queues.values()]
      .flat()
      .reduce((oldest, item) => (
        oldest == null || item.enqueuedAt < oldest ? item.enqueuedAt : oldest
      ), null);

    return Object.freeze({
      baseConcurrency,
      backgroundConcurrency,
      effectiveConcurrency: congestion.effectiveConcurrency,
      degraded: congestion.effectiveConcurrency < baseConcurrency,
      congestionLevel: congestion.level,
      congestionScore: congestion.score,
      signalWindowMs,
      active,
      peakActive,
      activeByClass: Object.freeze({ ...activeByClass }),
      activeByLane: Object.freeze({ ...activeByLane }),
      queued: queueDepth(),
      queuedByClass: Object.freeze(queuedByClass()),
      queuedByLane: Object.freeze(queuedByLane()),
      maxQueue,
      queueTimeoutMsByClass,
      admittedTotal,
      admittedByClass: Object.freeze({ ...admittedByClass }),
      admittedByLane: Object.freeze({ ...admittedByLane }),
      timedOutTotal,
      timedOutByClass: Object.freeze({ ...timedOutByClass }),
      timedOutByLane: Object.freeze({ ...timedOutByLane }),
      rejectedOverflowTotal,
      providerSignalsTotal,
      recentSignals: Object.freeze(signalCounts),
      lastCongestionChangeAt,
      oldestQueueAgeMs: oldestQueuedAt == null ? 0 : Math.max(0, now - oldestQueuedAt),
      totalQueueWaitMs,
      maxQueueWaitMs,
      averageQueueWaitMs: admittedTotal > 0
        ? Math.round(totalQueueWaitMs / admittedTotal)
        : 0,
      maxObservedQueue,
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
  LANE_PRIORITY,
  CONGESTION_SIGNAL_WEIGHTS,
  createAITrafficController,
};
