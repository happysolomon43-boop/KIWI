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

  // D15 is a read-only projection inside the Teaching Course Results/global
  // Record surfaces. Load it only for the Teaching document and only after
  // the deferred Teaching shell modules have established their registries.
  if (global.document?.documentElement?.dataset?.app === 'kiwi-teaching') {
    global.addEventListener('DOMContentLoaded', () => {
      import('/teaching-d15.js').catch((error) => {
        console.error('[KIWI Teaching D15] Record projection failed to load.', error);
      });
    }, { once: true });
  }
})(window);