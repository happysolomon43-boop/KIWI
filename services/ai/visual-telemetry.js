'use strict';

const MAX_VISUAL_TELEMETRY_EVENTS = 200;

function createVisualTelemetry({ logger = console, maxEvents = MAX_VISUAL_TELEMETRY_EVENTS, clock = () => Date.now() } = {}) {
  const events = [];
  const limit = Math.max(20, Math.min(1000, Number(maxEvents) || MAX_VISUAL_TELEMETRY_EVENTS));

  function record(event = {}) {
    const safe = Object.freeze({
      at: new Date(Number(clock()) || Date.now()).toISOString(),
      capability: event.capability || null,
      outcome: event.outcome || null,
      provider: event.provider || null,
      modelId: event.modelId || null,
      rendererId: event.rendererId || null,
      credentialSlot: event.credentialSlot || null,
      latencyMs: Number.isFinite(Number(event.latencyMs)) ? Number(event.latencyMs) : null,
      errorCode: event.errorCode || null,
      cacheHit: Boolean(event.cacheHit),
      mimeType: event.mimeType || null,
      byteLength: Number(event.byteLength) || 0,
      width: Number(event.width) || 0,
      height: Number(event.height) || 0,
      diagramType: event.diagramType || null,
      degraded: Boolean(event.degraded),
    });
    events.push(safe);
    while (events.length > limit) events.shift();
    if (safe.outcome === 'FAILED' && typeof logger?.warn === 'function') {
      logger.warn('[KIWI AI] visual capability failure', safe);
    }
    return safe;
  }

  function snapshot() {
    return Object.freeze(events.map((event) => Object.freeze({ ...event })));
  }

  return Object.freeze({ record, snapshot });
}

module.exports = { MAX_VISUAL_TELEMETRY_EVENTS, createVisualTelemetry };
