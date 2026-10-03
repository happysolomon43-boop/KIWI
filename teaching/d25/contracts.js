'use strict';

const CONNECTIVITY = Object.freeze({
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  REVALIDATING: 'REVALIDATING',
});

const SYNC_STATE = Object.freeze({
  SERVER_ACKNOWLEDGED: 'SERVER_ACKNOWLEDGED',
  LOCAL_RECOVERY_ONLY: 'LOCAL_RECOVERY_ONLY',
  SYNCING: 'SYNCING',
  CONFLICT: 'CONFLICT',
  READ_ONLY: 'READ_ONLY',
});

const SYSTEM_FAILURE_KIND = Object.freeze({
  NETWORK: 'NETWORK',
  AI_TIMEOUT: 'AI_TIMEOUT',
  AI_PROVIDER_OUTAGE: 'AI_PROVIDER_OUTAGE',
  RESOURCE_GENERATION: 'RESOURCE_GENERATION',
  AUTOSAVE: 'AUTOSAVE',
  PACKAGE_VALIDATION: 'PACKAGE_VALIDATION',
  SERVICE: 'SERVICE',
});

const TRANSIENT_CODES = new Set([
  'ETIMEDOUT','ECONNRESET','ECONNREFUSED','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT',
  'TEACHING_AI_TIMEOUT','TEACHING_AI_PROVIDER_UNAVAILABLE','TEACHING_AI_EXECUTION_FAILED',
  'TEACHING_D25_TRANSIENT_SERVICE_FAILURE',
]);

function fail(message, code, status = 409, details = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  return error;
}

function requireIdempotencyKey(value, prefix = 'd25') {
  const key = String(value || '').trim();
  if (!key || key.length > 180) {
    throw fail(
      'A stable idempotency key is required for this recovery-sensitive operation.',
      'TEACHING_D25_IDEMPOTENCY_REQUIRED',
      400,
      { prefix }
    );
  }
  return key;
}

function packageStartReadiness(packageRow, items = []) {
  const reasons = [];
  if (!packageRow) reasons.push('PACKAGE_NOT_FOUND');
  if (packageRow && packageRow.package_state !== 'LOCKED') reasons.push('PACKAGE_NOT_LOCKED');
  if (packageRow && !packageRow.locked_at) reasons.push('LOCK_TIMESTAMP_MISSING');
  if (packageRow && !String(packageRow.package_hash || '').trim()) reasons.push('PACKAGE_HASH_MISSING');
  if (packageRow && !String(packageRow.locked_by || '').trim()) reasons.push('LOCK_OWNER_MISSING');
  if (packageRow && !(Number(packageRow.duration_minutes) > 0)) reasons.push('DURATION_INVALID');

  const validation = packageRow?.validation_summary || {};
  if (!validation.whole_package_validation) reasons.push('WHOLE_PACKAGE_VALIDATION_MISSING');
  const itemValidations = Array.isArray(validation.item_validations) ? validation.item_validations : [];
  if (!items.length) reasons.push('PACKAGE_ITEMS_MISSING');
  if (items.length && itemValidations.length < items.length) reasons.push('ITEM_VALIDATION_COVERAGE_INCOMPLETE');

  const validationByCandidate = new Map(
    itemValidations.map((entry) => [String(entry.candidate_version_id || ''), String(entry.outcome || '').toUpperCase()])
  );
  for (const item of items) {
    if (String(item.item_state || 'ACTIVE') !== 'ACTIVE') reasons.push(`ITEM_NOT_ACTIVE:${item.package_item_id}`);
    if (item.answer_exposed === true) reasons.push(`ITEM_ANSWER_EXPOSED:${item.package_item_id}`);
    const candidate = String(item.candidate_version_id || '');
    if (!candidate || validationByCandidate.get(candidate) !== 'PASS') {
      reasons.push(`ITEM_VALIDATION_NOT_PASS:${item.package_item_id}`);
    }
  }

  return Object.freeze({
    ready: reasons.length === 0,
    reasons: Object.freeze([...new Set(reasons)]),
  });
}

function timerProjection({ expiresAt, serverNow = new Date(), connected = true } = {}) {
  const expiry = new Date(expiresAt);
  const now = new Date(serverNow);
  if (!Number.isFinite(expiry.getTime()) || !Number.isFinite(now.getTime())) {
    throw fail('Assessment timer projection requires authoritative timestamps.', 'TEACHING_D25_TIMER_TIMESTAMP_INVALID', 422);
  }
  const remainingMs = Math.max(0, expiry.getTime() - now.getTime());
  return Object.freeze({
    expiresAt: expiry.toISOString(),
    serverNow: now.toISOString(),
    remainingMs,
    expired: remainingMs === 0,
    timerAuthority: 'SERVER',
    pausesOffline: false,
    connectivity: connected ? CONNECTIVITY.ONLINE : CONNECTIVITY.OFFLINE,
    studentMessage: connected
      ? 'Assessment time is controlled by the server.'
      : 'You are offline. The authoritative assessment timer continues unless the assessment owner later grants a governed recovery.',
  });
}

function protectedFailureMessage(kind = SYSTEM_FAILURE_KIND.SERVICE) {
  const base = 'KIWI had a technical interruption. Your academic record is protected: this system failure will not be treated as a student action, absence, late submission, wrong answer, or mark.';
  const detail = {
    [SYSTEM_FAILURE_KIND.NETWORK]: 'Reconnect when possible; KIWI will re-read authoritative server state before syncing recoverable local work.',
    [SYSTEM_FAILURE_KIND.AI_TIMEOUT]: 'The teacher response did not complete safely. KIWI will retry only through the central AI Orchestrator or use a bounded fallback.',
    [SYSTEM_FAILURE_KIND.AI_PROVIDER_OUTAGE]: 'The model route is unavailable. Deterministic academic state remains intact.',
    [SYSTEM_FAILURE_KIND.RESOURCE_GENERATION]: 'A complex teaching resource could not be generated safely. KIWI may use a simpler valid representation or protect the Class as interrupted.',
    [SYSTEM_FAILURE_KIND.AUTOSAVE]: 'Some local work is not yet acknowledged by the server. It is not official submission truth until the server confirms it.',
    [SYSTEM_FAILURE_KIND.PACKAGE_VALIDATION]: 'The assessment did not pass the start gate, so it will not begin from a broken package.',
    [SYSTEM_FAILURE_KIND.SERVICE]: 'KIWI will recover from the authoritative record rather than fabricate missing academic facts.',
  }[kind] || '';
  return `${base} ${detail}`.trim();
}

function isTransientFailure(error) {
  if (!error) return false;
  if (TRANSIENT_CODES.has(String(error.code || ''))) return true;
  const status = Number(error.status || error.statusCode || 0);
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryDelayMs(attempt, { baseMs = 150, capMs = 1500 } = {}) {
  return Math.min(capMs, baseMs * (2 ** Math.max(0, Number(attempt) - 1)));
}

function syncProjection({ connected, localDraft, serverAcknowledgedVersion = 0, readOnly = false, conflict = false } = {}) {
  if (readOnly) return Object.freeze({ state: SYNC_STATE.READ_ONLY, official: true, serverAcknowledgedVersion: Number(serverAcknowledgedVersion || 0) });
  if (conflict) return Object.freeze({ state: SYNC_STATE.CONFLICT, official: false, serverAcknowledgedVersion: Number(serverAcknowledgedVersion || 0) });
  if (localDraft && !connected) return Object.freeze({ state: SYNC_STATE.LOCAL_RECOVERY_ONLY, official: false, serverAcknowledgedVersion: Number(serverAcknowledgedVersion || 0) });
  if (localDraft) return Object.freeze({ state: SYNC_STATE.SYNCING, official: false, serverAcknowledgedVersion: Number(serverAcknowledgedVersion || 0) });
  return Object.freeze({ state: SYNC_STATE.SERVER_ACKNOWLEDGED, official: true, serverAcknowledgedVersion: Number(serverAcknowledgedVersion || 0) });
}

module.exports = {
  CONNECTIVITY,
  SYNC_STATE,
  SYSTEM_FAILURE_KIND,
  fail,
  requireIdempotencyKey,
  packageStartReadiness,
  timerProjection,
  protectedFailureMessage,
  isTransientFailure,
  retryDelayMs,
  syncProjection,
};
