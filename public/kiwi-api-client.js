const config = window.KIWI_RUNTIME_CONFIG;

if (!config || !config.apiBaseUrl) {
  throw new Error('KIWI runtime configuration must load before the shared API client.');
}

const DEFAULT_TIMEOUT_MS = 30_000;
const PUBLIC_AUTH_401 = new Set([
  '/auth/login',
  '/auth/register',
  '/auth/guest',
  '/auth/forgot-password',
  '/auth/verify-reset-otp',
  '/auth/reset-password',
]);

function token(name) {
  return window.localStorage.getItem(name) || null;
}

function setToken(name, value) {
  if (value) window.localStorage.setItem(name, value);
  else window.localStorage.removeItem(name);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const externalSignal = options.signal;

  const forwardAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', forwardAbort, { once: true });

  const timer = window.setTimeout(() => controller.abort(), Math.max(1_000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
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
  throw error;
}

export async function kiwiApiRequest(endpoint, options = {}) {
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
  };

  let response = await fetchWithTimeout(
    `${config.apiBaseUrl}${endpoint}`,
    requestOptions,
    options.timeoutMs
  );

  if (response.status === 401 && !PUBLIC_AUTH_401.has(endpoint)) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      requestOptions.headers.Authorization = `Bearer ${token('kiwi_auth_token')}`;
      response = await fetchWithTimeout(
        `${config.apiBaseUrl}${endpoint}`,
        requestOptions,
        options.timeoutMs
      );
    }
  }

  return parseResponse(response, endpoint);
}

export function hasKiwiSession() {
  return Boolean(token('kiwi_auth_token') || token('kiwi_refresh_token'));
}
