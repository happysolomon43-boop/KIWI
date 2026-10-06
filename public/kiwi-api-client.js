(function initKiwiApiClient(global) {
'use strict';

const config = global.KIWI_RUNTIME_CONFIG;

if (!config || !config.apiBaseUrl) {
  throw new Error('KIWI runtime configuration must load before the shared API client.');
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAIN_CBT_OPERATION_TIMEOUT_MS = 180_000;
const LONG_RUNNING_ANALYSIS_OPERATION_TIMEOUT_MS = 10 * 60 * 1000;
const NETWORK_COMPLETION_GRACE_MS = 30_000;
const REQUEST_TIMEOUT_POLICIES = Object.freeze([
  Object.freeze({
    pattern: /^\/teaching\/courses\/[^/]+\/course-plan$/,
    timeoutMs: MAIN_CBT_OPERATION_TIMEOUT_MS + NETWORK_COMPLETION_GRACE_MS,
  }),
  Object.freeze({
    pattern: /^\/teaching\/courses\/[^/]+\/timetable\/propose$/,
    timeoutMs: LONG_RUNNING_ANALYSIS_OPERATION_TIMEOUT_MS + NETWORK_COMPLETION_GRACE_MS,
  }),
]);
const PUBLIC_AUTH_401 = new Set([
  '/auth/login',
  '/auth/register',
  '/auth/guest',
  '/auth/forgot-password',
  '/auth/verify-reset-otp',
  '/auth/reset-password',
]);

function token(name) {
  return global.localStorage.getItem(name) || null;
}

function setToken(name, value) {
  if (value) global.localStorage.setItem(name, value);
  else global.localStorage.removeItem(name);
}

function normalizeTimeoutMs(value, fallback = DEFAULT_TIMEOUT_MS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1_000, Math.floor(parsed));
}

function requestTimeoutFor(endpoint, requestedTimeoutMs) {
  if (requestedTimeoutMs != null) return normalizeTimeoutMs(requestedTimeoutMs);
  const policy = REQUEST_TIMEOUT_POLICIES.find(({ pattern }) => pattern.test(endpoint));
  return policy ? normalizeTimeoutMs(policy.timeoutMs) : DEFAULT_TIMEOUT_MS;
}

function apiTimeoutError(timeoutMs) {
  const error = new Error('KIWI request timed out before the server completed. Please try again.');
  error.name = 'KiwiApiTimeoutError';
  error.code = 'KIWI_API_TIMEOUT';
  error.status = 408;
  error.timeoutMs = timeoutMs;
  return error;
}

function apiCancelledError() {
  const error = new Error('KIWI request was cancelled. Please try again.');
  error.name = 'KiwiApiCancelledError';
  error.code = 'KIWI_API_CANCELLED';
  return error;
}

function abortWithReason(controller, reason) {
  if (controller.signal.aborted) return;
  try {
    controller.abort(reason);
  } catch (_) {
    controller.abort();
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const effectiveTimeoutMs = normalizeTimeoutMs(timeoutMs);
  const controller = new AbortController();
  const externalSignal = options.signal;
  let abortSource = null;

  const forwardAbort = () => {
    abortSource = 'external';
    abortWithReason(controller, apiCancelledError());
  };
  if (externalSignal?.aborted) forwardAbort();
  else externalSignal?.addEventListener('abort', forwardAbort, { once: true });

  const timer = controller.signal.aborted
    ? null
    : global.setTimeout(() => {
        abortSource = 'timeout';
        abortWithReason(controller, apiTimeoutError(effectiveTimeoutMs));
      }, effectiveTimeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (abortSource === 'timeout') throw apiTimeoutError(effectiveTimeoutMs);
    if (abortSource === 'external' || (controller.signal.aborted && externalSignal?.aborted)) {
      throw apiCancelledError();
    }
    throw error;
  } finally {
    if (timer != null) global.clearTimeout(timer);
    externalSignal?.removeEventListener('abort', forwardAbort);
  }
}

async function refreshAccessToken() {
  const refreshToken = token('kiwi_refresh_token');
  if (!refreshToken) return false;

  try {
    const response = await fetchWithTimeout(
      `${config.apiBaseUrl}/auth/refresh`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ refreshToken }),
      },
      30_000
    );

    if (!response.ok) return false;

    const data = await response.json();
    if (!data.accessToken) return false;

    setToken('kiwi_auth_token', data.accessToken);
    if (data.refreshToken) setToken('kiwi_refresh_token', data.refreshToken);
    return true;
  } catch (_) {
    return false;
  }
}

async function parseResponse(response, endpoint) {
  const data = await response.json().catch(() => ({}));
  if (response.ok) return data;

  const error = new Error(data.error || data.message || `HTTP ${response.status}`);
  error.status = response.status;
  error.code = data.code || null;
  error.endpoint = endpoint;
  error.courseId = typeof data.courseId === 'string' ? data.courseId : null;
  throw error;
}

async function requestWithSession(endpoint, requestOptions, timeoutMs) {
  const effectiveTimeoutMs = requestTimeoutFor(endpoint, timeoutMs);
  let response = await fetchWithTimeout(
    `${config.apiBaseUrl}${endpoint}`,
    requestOptions,
    effectiveTimeoutMs
  );

  if (response.status === 401 && !PUBLIC_AUTH_401.has(endpoint)) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      requestOptions.headers.Authorization = `Bearer ${token('kiwi_auth_token')}`;
      response = await fetchWithTimeout(
        `${config.apiBaseUrl}${endpoint}`,
        requestOptions,
        effectiveTimeoutMs
      );
    }
  }

  return parseResponse(response, endpoint);
}

async function kiwiApiRequest(endpoint, options = {}) {
  if (typeof endpoint !== 'string' || !endpoint.startsWith('/')) {
    throw new TypeError('KIWI API endpoint must start with /.');
  }

  const accessToken = token('kiwi_auth_token');
  const requestOptions = {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(options.headers || {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  };

  return requestWithSession(endpoint, requestOptions, options.timeoutMs);
}

// Raw authenticated requests are intentionally separate from kiwiApiRequest so
// binary uploads never pass through JSON/base64 or inherit application/json.
// Callers must provide an explicit safe Content-Type for binary bodies.
async function kiwiApiRawRequest(endpoint, options = {}) {
  if (typeof endpoint !== 'string' || !endpoint.startsWith('/')) {
    throw new TypeError('KIWI API endpoint must start with /.');
  }

  const accessToken = token('kiwi_auth_token');
  const requestOptions = {
    method: options.method || 'POST',
    headers: {
      Accept: 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(options.headers || {}),
    },
    ...(options.body !== undefined ? { body: options.body } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  };

  return requestWithSession(endpoint, requestOptions, options.timeoutMs);
}

function hasKiwiSession() {
  return Boolean(token('kiwi_auth_token') || token('kiwi_refresh_token'));
}

function loadTeachingUnifiedUpload() {
  if (!global.document?.getElementById('teachingApp')) return;

  if (!global.document.querySelector('link[data-teaching-unified-upload]')) {
    const stylesheet = global.document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = '/teaching-unified-upload.css?v=20261005-upload-2';
    stylesheet.dataset.teachingUnifiedUpload = 'true';
    global.document.head.append(stylesheet);
  }

  if (!global.document.querySelector('script[data-teaching-unified-upload]')) {
    const script = global.document.createElement('script');
    script.src = '/teaching-unified-upload.js?v=20261005-upload-2';
    script.dataset.teachingUnifiedUpload = 'true';
    script.defer = true;
    global.document.body.append(script);
  }
}

function loadStudyUnifiedUpload() {
  if (global.document?.getElementById('teachingApp')) return;
  if (!global.document?.getElementById('mainContent')) return;

  if (!global.document.querySelector('link[data-study-unified-upload]')) {
    const stylesheet = global.document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = '/study-unified-upload.css?v=20261004-upload-1';
    stylesheet.dataset.studyUnifiedUpload = 'true';
    global.document.head.append(stylesheet);
  }

  const loadUnifiedLayer = () => {
    if (global.document.querySelector('script[data-study-unified-upload]')) return;
    const script = global.document.createElement('script');
    script.src = '/study-unified-upload.js?v=20261004-upload-1';
    script.dataset.studyUnifiedUpload = 'true';
    script.defer = true;
    global.document.body.append(script);
  };

  if (typeof global.KIWIStudySourceImport === 'function') {
    loadUnifiedLayer();
    return;
  }

  const existingAdapter = global.document.querySelector('script[data-study-source-import]');
  if (existingAdapter) {
    existingAdapter.addEventListener('load', loadUnifiedLayer, { once: true });
    return;
  }

  const adapter = global.document.createElement('script');
  adapter.src = '/study-source-import.js?v=20261005-import-1';
  adapter.dataset.studySourceImport = 'true';
  adapter.addEventListener('load', loadUnifiedLayer, { once: true });
  adapter.addEventListener('error', () => {
    console.error('[KIWI] Study source import adapter failed to load.');
  }, { once: true });
  global.document.body.append(adapter);
}

function loadUnifiedUploadAssets() {
  loadTeachingUnifiedUpload();
  loadStudyUnifiedUpload();
  if (global.document && !global.document.querySelector('script[data-kiwi-math-renderer]')) {
    const script = global.document.createElement('script');
    script.src = '/kiwi-math-renderer.js?v=20261004-1';
    script.dataset.kiwiMathRenderer = 'true';
    script.defer = true;
    global.document.body.append(script);
  }
}

global.KIWI_API_CLIENT = Object.freeze({
  kiwiApiRequest,
  kiwiApiRawRequest,
  hasKiwiSession,
});

if (global.document?.readyState === 'loading') {
  global.document.addEventListener('DOMContentLoaded', loadUnifiedUploadAssets, { once: true });
} else {
  loadUnifiedUploadAssets();
}
})(window);
