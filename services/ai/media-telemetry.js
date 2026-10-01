'use strict';

const MAX_MEDIA_TELEMETRY_EVENTS = 200;

function createMediaTelemetry({
  logger = console,
  maxEvents = MAX_MEDIA_TELEMETRY_EVENTS,
  clock = () => Date.now(),
} = {}) {
  const events = [];
  const limit = Math.max(20, Math.min(1000, Number(maxEvents) || MAX_MEDIA_TELEMETRY_EVENTS));

  function record(event = {}) {
    const safe = Object.freeze({
      at: new Date(Number(clock()) || Date.now()).toISOString(),
      capability: event.capability || null,
      outcome: event.outcome || null,
      provider: event.provider || null,
      modelId: event.modelId || null,
      credentialSlot: event.credentialSlot || null,
      fallbackDepth: Number(event.fallbackDepth) || 0,
      latencyMs: Number.isFinite(Number(event.latencyMs)) ? Number(event.latencyMs) : null,
      errorCode: event.errorCode || null,
      imageCount: Number(event.imageCount) || 0,
      totalImageBytes: Number(event.totalImageBytes) || 0,
      imageMimeTypes: Object.freeze([...(event.imageMimeTypes || [])].map(String).slice(0, 8)),
      voiceId: event.voiceId || null,
      speechChunkCount: Number(event.speechChunkCount) || 0,
      audioBytes: Number(event.audioBytes) || 0,
      degraded: Boolean(event.degraded),
    });

    events.push(safe);
    while (events.length > limit) events.shift();

    if (event.outcome === 'FAILED' && typeof logger?.warn === 'function') {
      logger.warn('[KIWI AI] media capability failure', safe);
    }
    return safe;
  }

  function snapshot() {
    return Object.freeze(events.map((event) => Object.freeze({ ...event })));
  }

  return Object.freeze({ record, snapshot });
}

module.exports = {
  MAX_MEDIA_TELEMETRY_EVENTS,
  createMediaTelemetry,
};
