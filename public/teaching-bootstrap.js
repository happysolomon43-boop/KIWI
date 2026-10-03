const BOOTSTRAP_KEY = '__KIWI_TEACHING_FEATURE_BOOTSTRAP__';
const BOOTSTRAP_VERSION = '20261003-visible-features-1';

async function waitForEstablishedTeachingRegistries() {
  const deadline = Date.now() + 15000;

  while (Date.now() < deadline) {
    const apiReady = typeof window.KIWI_API_CLIENT?.kiwiApiRequest === 'function';
    const navigationReady = typeof window.KIWITeachingNavigation?.register === 'function';
    const coursesReady = typeof window.KIWITeachingCourses?.registerSection === 'function';

    if (apiReady && navigationReady && coursesReady) return true;
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }

  throw new Error('Established Teaching registries did not become ready in time.');
}

async function bootstrapTeachingFeatures() {
  const state = window[BOOTSTRAP_KEY];
  if (state === 'loading' || state === 'ready' || state === 'degraded') return;

  window[BOOTSTRAP_KEY] = 'loading';
  document.documentElement.dataset.teachingFeatures = 'loading';

  try {
    await waitForEstablishedTeachingRegistries();

    // Results is useful, but it must never be allowed to hide every other
    // accepted Teaching information surface if its module has a local defect.
    let resultsReady = true;
    try {
      await import(`/teaching-d15.js?v=${BOOTSTRAP_VERSION}`);
    } catch (error) {
      resultsReady = false;
      console.error('[KIWI Teaching] Results module failed to load; continuing with the remaining Teaching surfaces.', error);
    }

    // This bridge only extends the established original-shell registries. It
    // does not own or replace the Teaching shell.
    await import(`/teaching-original-bridge.js?v=${BOOTSTRAP_VERSION}`);

    window[BOOTSTRAP_KEY] = resultsReady ? 'ready' : 'degraded';
    document.documentElement.dataset.teachingFeatures = window[BOOTSTRAP_KEY];
    window.dispatchEvent(new CustomEvent('kiwi:teaching-features-ready', {
      detail: { resultsReady },
    }));
  } catch (error) {
    window[BOOTSTRAP_KEY] = 'failed';
    document.documentElement.dataset.teachingFeatures = 'failed';
    console.error('[KIWI Teaching] Original-shell feature bootstrap failed.', error);
  }
}

bootstrapTeachingFeatures();
