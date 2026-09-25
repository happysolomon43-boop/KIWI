'use strict';

const { assertAcademicTimestamp } = require('../domain/time');

function toEpoch(value, field) {
  const normalized = assertAcademicTimestamp(value, field);
  const millis = Date.parse(normalized);
  if (!Number.isFinite(millis)) {
    throw new TypeError(`${field} must be a valid timezone-aware timestamp.`);
  }
  return { normalized, millis };
}

function createAuthoritativeTimeSnapshot(clock = () => new Date()) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError('Server clock returned an invalid time.');
  }

  return Object.freeze({
    authoritativeNow: date.toISOString(),
    authoritativeNowMs: date.getTime(),
    source: 'server',
  });
}

function projectAuthoritativeTimer({
  serverNow,
  startsAt = null,
  endsAt,
} = {}) {
  const now = toEpoch(serverNow, 'serverNow');
  const end = toEpoch(endsAt, 'endsAt');
  const start = startsAt == null ? null : toEpoch(startsAt, 'startsAt');

  if (start && end.millis < start.millis) {
    throw new TypeError('endsAt cannot be earlier than startsAt.');
  }

  const phase = end.millis <= now.millis
    ? 'EXPIRED'
    : start && start.millis > now.millis
      ? 'UPCOMING'
      : 'ACTIVE';

  return Object.freeze({
    phase,
    authoritativeNow: now.normalized,
    startsAt: start?.normalized || null,
    endsAt: end.normalized,
    remainingMs: Math.max(0, end.millis - now.millis),
    elapsedMs: start ? Math.max(0, Math.min(now.millis, end.millis) - start.millis) : null,
    authoritative: false,
    projectionOf: 'server_timestamp_state',
  });
}

module.exports = {
  createAuthoritativeTimeSnapshot,
  projectAuthoritativeTimer,
};
