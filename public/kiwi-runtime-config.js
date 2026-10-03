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

  // The first D23 visible-shell experiment packaged the original Teaching shell
  // and the replacement D23 shell together. A browser that restores that stale
  // document can therefore run two UI owners against the same Teaching state.
  // Detect that retired document before either UI module can take ownership and
  // force one cache-busting navigation back to the established Teaching shell.
  const legacyVisibleShell = Boolean(
    global.document.querySelector('.d23-shell') ||
    global.document.querySelector('link[href*="teaching-d23-live.css"]') ||
    global.document.querySelector('script[src*="teaching-d23-live.js"]')
  );

  if (legacyVisibleShell) {
    const current = new URL(global.location.href);
    if (current.searchParams.get('teaching-ui') !== 'original-20261003') {
      const clean = new URL('/teaching.html', global.location.origin);
      clean.searchParams.set('teaching-ui', 'original-20261003');
      global.location.replace(clean.href);
      return;
    }
  }

  const waitForEstablishedTeachingShell = async () => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const navigationReady = typeof global.KIWITeachingNavigation?.register === 'function';
      const coursesReady = typeof global.KIWITeachingCourses?.registerSection === 'function';
      const visibleShellReady = Boolean(global.document.querySelector('#teachingApp .teaching-view'));
      const sessionFailed = Boolean(global.document.getElementById('teachingSessionBack'));

      if (navigationReady && coursesReady && visibleShellReady) return true;
      if (sessionFailed) return false;
      await new Promise((resolve) => global.setTimeout(resolve, 50));
    }
    throw new Error('Established Teaching shell did not become ready in time.');
  };

  const bootstrapTeachingFeatures = async () => {
    const state = global.__KIWI_TEACHING_FEATURE_BOOTSTRAP__;
    if (state === 'loading' || state === 'ready') return;

    global.__KIWI_TEACHING_FEATURE_BOOTSTRAP__ = 'loading';
    try {
      const shellReady = await waitForEstablishedTeachingShell();
      if (!shellReady) {
        global.__KIWI_TEACHING_FEATURE_BOOTSTRAP__ = 'session-unavailable';
        return;
      }

      // Results/Record registers first. The information bridge then extends the
      // same original Course/global registries with Teacher, Archived Courses,
      // Study Packs and contextual Materials. No replacement shell is mounted.
      await import('/teaching-d15.js');
      await import('/teaching-original-bridge.js');

      global.__KIWI_TEACHING_FEATURE_BOOTSTRAP__ = 'ready';
      global.dispatchEvent(new CustomEvent('kiwi:teaching-features-ready'));
    } catch (error) {
      global.__KIWI_TEACHING_FEATURE_BOOTSTRAP__ = 'failed';
      console.error('[KIWI Teaching] Original-shell feature bootstrap failed.', error);
    }
  };

  const scheduleBootstrap = () => {
    global.setTimeout(() => {
      bootstrapTeachingFeatures();
    }, 0);
  };

  if (global.document.readyState === 'loading') {
    global.addEventListener('DOMContentLoaded', scheduleBootstrap, { once: true });
  } else {
    scheduleBootstrap();
  }
})(window);