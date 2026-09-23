function clearContainer(container) {
  if (!container) return;
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
}

function applyContainerRatio(
  container,
  width,
  height
) {
  const w = Math.max(
    1,
    Number(width) || 300
  );
  const h = Math.max(
    1,
    Number(height) || 360
  );
  container.style.aspectRatio =
    w + ' / ' + h;
}

function stateDescription(state) {
  const stage =
    String(state?.stageLabel || '').trim() ||
    'growing';
  const vitality = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        Number(
          state?.vitality ??
          state?.health ??
          100
        ) || 0
      )
    )
  );

  return (
    'KIWI living vine. ' +
    stage +
    ' maturity, ' +
    vitality +
    '% Vitality.'
  );
}

function mountStaticFallback(
  container,
  options,
  reason
) {
  clearContainer(container);
  applyContainerRatio(
    container,
    options.width,
    options.height
  );

  if (container.dataset) {
    container.dataset.kiwiRenderer =
      'static-fallback';
  }

  const fallback =
    document.createElement('div');
  fallback.className =
    'kiwi-vine-static-fallback';
  fallback.setAttribute('role', 'img');
  fallback.setAttribute(
    'aria-label',
    stateDescription(options.state)
  );

  Object.assign(fallback.style, {
    width: '100%',
    height: '100%',
    minHeight: '180px',
    display: 'grid',
    placeItems: 'center',
    position: 'relative',
    overflow: 'hidden',
    pointerEvents: 'none',
    borderRadius: '18px',
  });

  const trellis =
    document.createElement('div');
  Object.assign(trellis.style, {
    width: '72%',
    height: '48%',
    position: 'absolute',
    top: '20%',
    left: '14%',
    borderTop:
      '8px solid rgba(116,81,57,.72)',
    borderLeft:
      '7px solid rgba(116,81,57,.58)',
    borderRight:
      '7px solid rgba(116,81,57,.58)',
    borderRadius: '6px 6px 0 0',
    opacity: '0.72',
  });

  const vine =
    document.createElement('div');
  vine.textContent = '🌿';
  Object.assign(vine.style, {
    fontSize:
      'clamp(54px, 22vw, 110px)',
    lineHeight: '1',
    filter:
      'drop-shadow(0 10px 18px rgba(21,54,38,.18))',
    transform: 'translateY(4%)',
  });

  fallback.appendChild(trellis);
  fallback.appendChild(vine);
  container.appendChild(fallback);

  let currentState =
    options.state || {};

  return {
    mode: 'static-fallback',
    instance: null,
    runtime: null,
    fallbackReason: reason,
    updateState(nextState) {
      currentState = {
        ...currentState,
        ...(nextState || {}),
      };
      fallback.setAttribute(
        'aria-label',
        stateDescription(currentState)
      );
    },
    playReactions() {},
    getPerformanceSnapshot() {
      return Object.freeze({
        mode: 'static-fallback',
        reason,
      });
    },
    async destroy() {
      clearContainer(container);
      if (container.dataset) {
        delete container.dataset.kiwiRenderer;
      }
    },
  };
}

export function normalizeTreeRendererMode() {
  // Phase 15: PixiJS is the only production living-vine renderer.
  return 'pixi';
}

export async function mountKiwiTreeRenderer(
  options = {}
) {
  const container = options.container;
  if (!container) {
    throw new Error(
      'Tree renderer requires a container.'
    );
  }

  let runtime = null;

  try {
    clearContainer(container);
    applyContainerRatio(
      container,
      options.width,
      options.height
    );

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

    const renderer =
      await createKiwiVineRenderer({
        runtime,
        container,
        state: options.state,
        width: options.width,
        height: options.height,
        interactive:
          options.interactive !== false,
        onShake: options.onShake,
      });

    return {
      mode: 'pixi',
      instance: renderer,
      runtime,
      fallbackReason: null,
      updateState(
        nextState,
        animate = true
      ) {
        renderer.updateState(
          nextState,
          animate
        );
      },
      playReactions(reactions) {
        renderer.playReactions?.(
          reactions
        );
      },
      getPerformanceSnapshot() {
        return (
          renderer.getPerformanceSnapshot?.() ||
          runtime.getPerformanceSnapshot?.() ||
          null
        );
      },
      async destroy() {
        await renderer.destroy({
          destroyRuntime: true,
        });
        clearContainer(container);
      },
    };
  } catch (error) {
    if (runtime) {
      try {
        await runtime.destroy();
      } catch (_) {}
    }

    return mountStaticFallback(
      container,
      options,
      error instanceof Error
        ? error.message
        : String(error)
    );
  }
}

export function getDefaultTreeRendererMode() {
  return 'pixi';
}
