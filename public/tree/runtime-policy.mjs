export const PIXI_RUNTIME_POLICY_VERSION = 1;
export const PIXI_VERSION = '8.21.0';

export const PIXI_LAYER_ORDER = Object.freeze([
  'backdrop',
  'rearFoliage',
  'trellisRear',
  'woodyVine',
  'foliage',
  'flowers',
  'fruit',
  'foregroundFoliage',
  'ambient',
]);

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function classifyViewport(width) {
  const value = finite(width, 1280);
  if (value <= 768) return 'mobile';
  if (value <= 1024) return 'tablet';
  return 'desktop';
}

export function derivePixiRuntimePolicy(input = {}) {
  const width = finite(input.viewportWidth, 1280);
  const devicePixelRatio = Math.max(1, finite(input.devicePixelRatio, 1));
  const deviceMemory = finite(input.deviceMemory, 8);
  const hardwareConcurrency = finite(input.hardwareConcurrency, 8);
  const saveData = input.saveData === true;
  const reducedMotion = input.reducedMotion === true;
  const profile = classifyViewport(width);

  const constrainedDevice =
    saveData ||
    deviceMemory <= 4 ||
    hardwareConcurrency <= 4;

  let resolutionCap;
  if (saveData) resolutionCap = 1;
  else if (profile === 'mobile') resolutionCap = constrainedDevice ? 1.25 : 1.5;
  else if (profile === 'tablet') resolutionCap = constrainedDevice ? 1.5 : 1.75;
  else resolutionCap = constrainedDevice ? 1.5 : 2;

  let maxFPS;
  if (saveData) maxFPS = 30;
  else if (profile === 'mobile') maxFPS = constrainedDevice ? 30 : 45;
  else maxFPS = constrainedDevice ? 45 : 60;

  return Object.freeze({
    version: PIXI_RUNTIME_POLICY_VERSION,
    pixiVersion: PIXI_VERSION,
    profile,
    constrainedDevice,
    saveData,
    reducedMotion,
    motionScale: reducedMotion ? 0 : 1,
    resolution: clamp(devicePixelRatio, 1, resolutionCap),
    resolutionCap,
    maxFPS,
    antialias: profile === 'desktop' && !constrainedDevice,
    powerPreference: profile === 'desktop' && !saveData
      ? 'high-performance'
      : 'low-power',
    autoDensity: true,
    backgroundAlpha: 0,
    textureGCActive: true,
  });
}

export function readBrowserRuntimeSignals(win = globalThis.window) {
  if (!win) {
    return {
      viewportWidth: 1280,
      devicePixelRatio: 1,
      deviceMemory: 8,
      hardwareConcurrency: 8,
      saveData: false,
      reducedMotion: false,
    };
  }

  const nav = win.navigator || {};
  const connection = nav.connection || nav.mozConnection || nav.webkitConnection;

  return {
    viewportWidth: finite(win.innerWidth, 1280),
    devicePixelRatio: Math.max(1, finite(win.devicePixelRatio, 1)),
    deviceMemory: finite(nav.deviceMemory, 8),
    hardwareConcurrency: finite(nav.hardwareConcurrency, 8),
    saveData: connection?.saveData === true,
    reducedMotion:
      typeof win.matchMedia === 'function'
        ? win.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false,
  };
}

export function shouldRunTicker(input = {}) {
  if (input.destroyed) return false;
  if (input.documentHidden) return false;
  if (input.intersectionKnown && !input.intersecting) return false;
  return true;
}
