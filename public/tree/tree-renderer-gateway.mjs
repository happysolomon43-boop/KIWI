const VALID_MODES = new Set(['legacy', 'pixi']);

export function normalizeTreeRendererMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return VALID_MODES.has(mode) ? mode : 'legacy';
}

function defaultLegacyFactory(container, options) {
  const LegacyTree = globalThis.KiwiTree;
  if (typeof LegacyTree !== 'function') {
    throw new Error('Legacy KiwiTree renderer is unavailable.');
  }
  return new LegacyTree(container, options);
}

function clearContainer(container) {
  if (!container) return;
  while (container.firstChild) container.removeChild(container.firstChild);
}

export async function mountKiwiTreeRenderer(options = {}) {
  const container = options.container;
  if (!container) throw new Error('Tree renderer requires a container.');

  const mode = normalizeTreeRendererMode(options.mode);
  const legacyFactory =
    typeof options.legacyFactory === 'function'
      ? options.legacyFactory
      : defaultLegacyFactory;

  const legacyOptions = {
    width: options.width,
    height: options.height,
    state: options.state,
    interactive: options.interactive !== false,
  };

  const mountLegacy = (reason = null) => {
    clearContainer(container);
    const instance = legacyFactory(container, legacyOptions);
    return {
      mode: 'legacy',
      instance,
      fallbackReason: reason,
      destroy() {
        clearContainer(container);
      },
    };
  };

  if (mode !== 'pixi') {
    return mountLegacy(null);
  }

  try {
    clearContainer(container);

    const { createKiwiPixiRuntime } = await import('./pixi-runtime.mjs');
    const runtime = await createKiwiPixiRuntime({
      container,
      policy: options.policy,
    });

    // Phase 7 mounts only the runtime infrastructure. The biological renderer
    // is added in Phase 8. Until then, a requested Pixi mount is considered
    // incomplete and must fall back rather than showing an empty canvas.
    await runtime.destroy();
    return mountLegacy('pixi-renderer-not-implemented');
  } catch (error) {
    return mountLegacy(
      error instanceof Error ? error.message : String(error)
    );
  }
}

export function getDefaultTreeRendererMode() {
  // Keep the production SVG renderer authoritative until Phase 8 explicitly
  // changes this boundary.
  return 'legacy';
}
