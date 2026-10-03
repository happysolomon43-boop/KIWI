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

  if (global.document?.documentElement?.dataset?.app !== 'kiwi-teaching') return;

  // One-time escape hatch for browser tabs that restore the rejected D23
  // replacement document from memory/cache. That document packaged two UI
  // owners against the same Teaching DOM. Redirect it before either can mount.
  const staleReplacementDocument = Boolean(
    global.document.querySelector('.d23-shell') ||
    global.document.querySelector('link[href*="teaching-d23-live.css"]') ||
    global.document.querySelector('script[src*="teaching-d23-live.js"]')
  );

  if (staleReplacementDocument) {
    const current = new URL(global.location.href);
    if (current.searchParams.get('teaching-ui') !== 'original-20261003') {
      const clean = new URL('/teaching.html', global.location.origin);
      clean.searchParams.set('teaching-ui', 'original-20261003');
      global.location.replace(clean.href);
      return;
    }
  }

  // Teaching-specific feature startup lives in its own module. The shared
  // runtime config does not own Teaching presentation or feature registration.
  import('/teaching-bootstrap.js').catch((error) => {
    console.error('[KIWI Teaching] Feature bootstrap module failed to load.', error);
  });
})(window);