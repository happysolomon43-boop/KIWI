const BOOTSTRAP_KEY = '__KIWI_TEACHING_FEATURE_BOOTSTRAP__';

async function waitForEstablishedTeachingShell() {
  const deadline = Date.now() + 30000;

  while (Date.now() < deadline) {
    const navigationReady = typeof window.KIWITeachingNavigation?.register === 'function';
    const coursesReady = typeof window.KIWITeachingCourses?.registerSection === 'function';
    const visibleShellReady = Boolean(document.querySelector('#teachingApp .teaching-view'));
    const sessionFailed = Boolean(document.getElementById('teachingSessionBack'));

    if (navigationReady && coursesReady && visibleShellReady) return true;
    if (sessionFailed) return false;

    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }

  throw new Error('Established Teaching shell did not become ready in time.');
}

async function bootstrapTeachingFeatures() {
  const state = window[BOOTSTRAP_KEY];
  if (state === 'loading' || state === 'ready') return;

  window[BOOTSTRAP_KEY] = 'loading';

  try {
    const shellReady = await waitForEstablishedTeachingShell();
    if (!shellReady) {
      window[BOOTSTRAP_KEY] = 'session-unavailable';
      return;
    }

    // The original Teaching shell is the only presentation owner. Results and
    // the D23 information surfaces extend its existing registries only after
    // that shell is visibly ready.
    await import('/teaching-d15.js');
    await import('/teaching-original-bridge.js');

    window[BOOTSTRAP_KEY] = 'ready';
    window.dispatchEvent(new CustomEvent('kiwi:teaching-features-ready'));
  } catch (error) {
    window[BOOTSTRAP_KEY] = 'failed';
    console.error('[KIWI Teaching] Original-shell feature bootstrap failed.', error);
  }
}

bootstrapTeachingFeatures();
