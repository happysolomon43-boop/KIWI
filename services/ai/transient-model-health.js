'use strict';

function toMs(clock) {
  const value = typeof clock === 'function' ? clock() : Date.now();
  if (value instanceof Date) return value.getTime();
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Date.now();
}

function boundedDuration(value, fallback, min, max) {
  const numeric = Number(value);
  const duration = Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
  return Math.max(min, Math.min(duration, max));
}

/**
 * Tracks short-lived provider/model instability separately from persistent
 * project+model quota state.
 *
 * A model circuit opens only after the same model fails across multiple
 * independent project slots inside a short evidence window. One 503 from one
 * key is therefore never enough to declare the whole model unavailable.
 */
function createTransientModelHealth({
  clock = () => Date.now(),
  failureThreshold = 2,
  failureWindowMs = 30000,
  defaultCooldownMs = 20000,
  minCooldownMs = 5000,
  maxCooldownMs = 120000,
} = {}) {
  const threshold = Math.max(2, Number(failureThreshold) || 2);
  const windowMs = Math.max(5000, Number(failureWindowMs) || 30000);
  const cooldowns = new Map();
  const failures = new Map();

  function nowMs() {
    return toMs(clock);
  }

  function prune(modelId, now = nowMs()) {
    const bySlot = failures.get(modelId);
    if (!bySlot) return new Map();

    for (const [slotId, entry] of bySlot.entries()) {
      if (!entry || now - Number(entry.at || 0) > windowMs) {
        bySlot.delete(slotId);
      }
    }

    if (bySlot.size === 0) failures.delete(modelId);
    return bySlot;
  }

  function cooldownUntil(modelId) {
    const until = Number(cooldowns.get(modelId)) || 0;
    if (!until) return null;

    if (until <= nowMs()) {
      cooldowns.delete(modelId);
      failures.delete(modelId);
      return null;
    }

    return until;
  }

  function isAvailable(modelId) {
    return cooldownUntil(modelId) == null;
  }

  function recordFailure(modelId, slotId, error = null) {
    if (!modelId) {
      return Object.freeze({
        opened: false,
        distinctFailureSlots: 0,
        cooldownUntil: null,
      });
    }

    const now = nowMs();
    const bySlot = prune(modelId, now);
    const evidenceKey = slotId ? String(slotId) : '__unknown_slot__';

    bySlot.set(evidenceKey, {
      at: now,
      code: error?.code || null,
      status: error?.status ?? null,
    });
    failures.set(modelId, bySlot);

    let opened = false;
    let until = cooldownUntil(modelId);

    if (bySlot.size >= threshold) {
      const cooldownMs = boundedDuration(
        error?.retryAfterMs,
        defaultCooldownMs,
        minCooldownMs,
        maxCooldownMs
      );
      until = now + cooldownMs;
      cooldowns.set(modelId, until);
      opened = true;
    }

    return Object.freeze({
      opened,
      distinctFailureSlots: bySlot.size,
      cooldownUntil: until,
    });
  }

  function recordSuccess(modelId) {
    if (!modelId) return;
    failures.delete(modelId);
    cooldowns.delete(modelId);
  }

  function snapshot() {
    const now = nowMs();
    const modelIds = new Set([...failures.keys(), ...cooldowns.keys()]);
    return [...modelIds].map((modelId) => {
      const bySlot = prune(modelId, now);
      const until = cooldownUntil(modelId);
      return Object.freeze({
        modelId,
        distinctFailureSlots: bySlot.size,
        circuitOpen: Boolean(until),
        cooldownUntil: until ? new Date(until).toISOString() : null,
      });
    });
  }

  return Object.freeze({
    isAvailable,
    cooldownUntil,
    recordFailure,
    recordSuccess,
    snapshot,
    cooldowns,
    failures,
  });
}

module.exports = {
  createTransientModelHealth,
};
