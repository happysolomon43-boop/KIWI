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

function applyContainerRatio(container, width, height) {
  const w = Math.max(1, Number(width) || 300);
  const h = Math.max(1, Number(height) || 360);
  container.style.aspectRatio = w + ' / ' + h;
}

export async function mountKiwiTreeRenderer(options = {}) {
  const container = options.container;
  if (!container) throw new Error('Tree renderer requires a container.');

  const mode = normalizeTreeRendererMode(options.mode || getDefaultTreeRendererMode());
  const legacyFactory =
    typeof options.legacyFactory === 'function'
      ? options.legacyFactory
      : defaultLegacyFactory;

  const legacyOptions = {
    width: options.width,
    height: options.height,
    state: options.state,
    interactive: options.interactive !== false,
    onShake: options.onShake,
  };

  const mountLegacy = (reason = null) => {
    clearContainer(container);
    if (container.dataset) container.dataset.kiwiRenderer = 'legacy-svg';
    const instance = legacyFactory(container, legacyOptions);

    return {
      mode: 'legacy',
      instance,
      fallbackReason: reason,
      updateState(nextState, animate = true) {
        if (typeof instance?.updateState === 'function') {
          instance.updateState(nextState, animate);
        }
      },
      async destroy() {
        clearContainer(container);
        if (container.dataset) delete container.dataset.kiwiRenderer;
      },
    };
  };

  if (mode !== 'pixi') {
    return mountLegacy(null);
  }

  let runtime = null;

  try {
    clearContainer(container);
    applyContainerRatio(container, options.width, options.height);

    const [
      { createKiwiPixiRuntime },
      { createKiwiVineRenderer },
    ] = await Promise.all([
      import('./pixi-runtime.mjs'),
      import('./kiwi-vine-renderer.mjs'),
    ]);

    runtime = await createKiwiPixiRuntime({
      container,
      policy: options.policy,
    });

    const renderer = await createKiwiVineRenderer({
      runtime,
      container,
      state: options.state,
      width: options.width,
      height: options.height,
      interactive: options.interactive !== false,
      onShake: options.onShake,
    });

    return {
      mode: 'pixi',
      instance: renderer,
      runtime,
      fallbackReason: null,
      updateState(nextState, animate = true) {
        renderer.updateState(nextState, animate);
      },
      async destroy() {
        await renderer.destroy({ destroyRuntime: true });
        clearContainer(container);
      },
    };
  } catch (error) {
    if (runtime) {
      try { await runtime.destroy(); } catch (_) {}
    }

    return mountLegacy(
      error instanceof Error ? error.message : String(error)
    );
  }
}

export function getDefaultTreeRendererMode() {
  const requested = globalThis.KIWI_TREE_RENDERER_MODE;
  if (requested != null) return normalizeTreeRendererMode(requested);
  return 'pixi';
}
