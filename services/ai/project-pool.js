'use strict';

function buildProjectSlots(env = process.env, maxKeys = 15) {
  const slots = [];

  for (let index = 1; index <= maxKeys; index++) {
    const envName = index === 1 ? 'GEMINI_API_KEY' : `GEMINI_API_KEY_${index}`;
    const raw = env?.[envName];
    if (!raw || !String(raw).trim()) continue;

    slots.push({
      id: `gemini-project-${String(index).padStart(2, '0')}`,
      index,
      envName,
      apiKey: String(raw).trim(),
      enabled: true,
      disabledReason: null,
    });
  }

  return slots;
}

function createProjectPool({
  env = process.env,
  maxKeys = 15,
  slots: suppliedSlots = null,
} = {}) {
  const slots = (suppliedSlots || buildProjectSlots(env, maxKeys)).map((slot) => ({
    ...slot,
    enabled: slot.enabled !== false,
    disabledReason: slot.disabledReason || null,
  }));

  const cursors = new Map();

  function enabledSlots(excludeSlotIds = []) {
    const excluded = new Set(excludeSlotIds);
    return slots.filter((slot) => slot.enabled && !excluded.has(slot.id));
  }

  function orderForModel(modelId, { excludeSlotIds = [], advance = false } = {}) {
    const available = enabledSlots(excludeSlotIds);
    if (available.length === 0) return [];

    const cursorKey = String(modelId || '__default__');
    const start = cursors.get(cursorKey) || 0;
    const normalizedStart = start % available.length;
    const ordered = [];

    for (let offset = 0; offset < available.length; offset++) {
      ordered.push(available[(normalizedStart + offset) % available.length]);
    }

    if (advance) {
      // Round-robin state is model-specific. Changing from 3.8 to 3.7 therefore
      // starts from 3.7's own cursor rather than inheriting 3.8's position.
      cursors.set(cursorKey, (normalizedStart + 1) % available.length);
    }

    return ordered;
  }

  function orderedSlots(modelId, options = {}) {
    return orderForModel(modelId, { ...options, advance: true });
  }

  function peekOrderedSlots(modelId, options = {}) {
    return orderForModel(modelId, { ...options, advance: false });
  }

  function disable(slotId, reason = 'disabled') {
    const slot = slots.find((item) => item.id === slotId);
    if (!slot) return false;
    slot.enabled = false;
    slot.disabledReason = reason;
    return true;
  }

  function enable(slotId) {
    const slot = slots.find((item) => item.id === slotId);
    if (!slot) return false;
    slot.enabled = true;
    slot.disabledReason = null;
    return true;
  }

  function get(slotId) {
    return slots.find((item) => item.id === slotId) || null;
  }

  function snapshot() {
    return slots.map((slot) => ({
      id: slot.id,
      index: slot.index,
      envName: slot.envName,
      enabled: slot.enabled,
      disabledReason: slot.disabledReason,
    }));
  }

  return Object.freeze({
    count: () => slots.length,
    enabledCount: () => slots.filter((slot) => slot.enabled).length,
    orderedSlots,
    peekOrderedSlots,
    disable,
    enable,
    get,
    snapshot,
  });
}

module.exports = {
  buildProjectSlots,
  createProjectPool,
};
