(function initKiwiRuntimeConfig(global) {
  'use strict';

  const override = global.__KIWI_RUNTIME_CONFIG__ && typeof global.__KIWI_RUNTIME_CONFIG__ === 'object'
    ? global.__KIWI_RUNTIME_CONFIG__
    : {};

  const localHost =
    global.location.hostname === 'localhost' ||
    global.location.hostname === '127.0.0.1';

  const backendOrigin = String(
    override.backendOrigin ||
    (localHost ? 'http://localhost:8080' : 'https://kiwi-741i.onrender.com')
  ).replace(/\/$/, '');

  let webSocketBaseUrl = String(override.webSocketBaseUrl || '').replace(/\/$/, '');
  if (!webSocketBaseUrl) {
    const parsed = new URL(backendOrigin, global.location.href);
    parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    webSocketBaseUrl = parsed.origin;
  }

  global.KIWI_RUNTIME_CONFIG = Object.freeze({
    backendOrigin,
    apiBaseUrl: `${backendOrigin}/api`,
    webSocketBaseUrl,
  });
})(window);
