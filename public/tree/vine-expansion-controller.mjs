import { loadVineBlueprint } from './vine-blueprint-loader.mjs';
import { loadExpansionContract } from './vine-expansion-loader.mjs';
import {
  corridorPoints,
  createPathDecorations,
  edgePoint,
  expansionProfile,
  fallbackPerimeterPath,
  localSocketPoint,
  pathIntersectsRects,
  polylineLength,
  rectFromDOMRect,
} from './vine-expansion-plan.mjs';
import { createVineExpansionRenderer } from './vine-expansion-renderer.mjs';
import {
  derivePixiRuntimePolicy,
  readBrowserRuntimeSignals,
} from './runtime-policy.mjs';
import {
  getCurrentTreeState,
  publishTreeState,
  subscribeTreeState,
} from './tree-state-channel.mjs';

function elementVisible(element) {
  if (!element || !element.isConnected) return false;
  if (element === document.body) return true;
  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
}

function selectorActive(selector) {
  try {
    return [...document.querySelectorAll(selector)].some(elementVisible);
  } catch (_) {
    return false;
  }
}

function visibleElements(selector) {
  try {
    return [...document.querySelectorAll(selector)].filter(elementVisible);
  } catch (_) {
    return [];
  }
}

function uniqueElements(elements) {
  return [...new Set(elements.filter(Boolean))];
}

function selectTargets(path) {
  let elements = visibleElements(path.target.selector);

  if (path.resolveTargetAncestor) {
    elements = uniqueElements(
      elements.map((element) => element.closest(path.resolveTargetAncestor))
    ).filter(elementVisible);
  }

  if (!elements.length) return [];

  const maxTargets = Math.max(1, Number(path.target.maxTargets) || 1);
  if (path.target.targetMode !== 'outermost-per-column') {
    return elements.slice(0, maxTargets);
  }

  const edge = path.target.edge || '';
  elements.sort((a, b) => {
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    const horizontal =
      edge.includes('left')
        ? ar.left - br.left
        : edge.includes('right')
          ? br.right - ar.right
          : 0;
    if (Math.abs(horizontal) > 2) return horizontal;
    return ar.top - br.top;
  });

  return elements.slice(0, maxTargets);
}

function routePolicyDecision(contract, route, state, flags, width) {
  const profile = expansionProfile(contract, width).profile;

  if (profile === 'mobile') {
    return { enabled: false, reason: 'mobile', profile };
  }

  if (!state) {
    return { enabled: false, reason: 'missing-state', profile };
  }

  const policy = contract.routePolicy[route] || 'disabled';
  if (policy !== 'mapped') {
    return { enabled: false, reason: policy, profile };
  }

  const routeMap = contract.routeExpansionMap[route];
  if (!routeMap) {
    return { enabled: false, reason: 'missing-route-map', profile };
  }

  if (flags.overlayActive || flags.reckoningActive || flags.tourActive) {
    return { enabled: false, reason: 'focus-suspended', profile };
  }

  if (route === 'study' && flags.activeStudySession) {
    return { enabled: false, reason: 'active-study', profile };
  }

  const maturity = Number(state.overallGrowthProgress) || 0;
  if (maturity < contract.expansionMaturity.firstEscape) {
    return { enabled: false, reason: 'maturity', profile };
  }

  return {
    enabled: true,
    reason: 'eligible',
    profile,
    routeMap,
  };
}

function colorForVitality(vitality) {
  const v = Math.max(0, Math.min(100, Number(vitality) || 0)) / 100;
  if (v >= 0.72) return 0x557343;
  if (v >= 0.40) return 0x6f6841;
  return 0x67583d;
}

function leafColorForState(state) {
  const saturation = Number(state?.vineHealth?.leafSaturation) || 0.5;
  if (saturation >= 0.72) return 0x5b9b50;
  if (saturation >= 0.45) return 0x71864b;
  return 0x81744a;
}

function reactionAnnouncement(reactions) {
  if (!Array.isArray(reactions) || reactions.length === 0) return '';

  if (reactions.some((reaction) => reaction.type === 'milestone')) {
    return 'Your KIWI vine reached a new growth milestone.';
  }
  if (reactions.some((reaction) => reaction.type === 'fruit-set')) {
    return 'New kiwi fruit appeared on your vine.';
  }
  if (reactions.some((reaction) => reaction.type === 'streak-root')) {
    return 'Your KIWI vine strengthened with a new streak milestone.';
  }
  if (reactions.some((reaction) => reaction.type === 'growth')) {
    return 'Your KIWI vine grew from your recent progress.';
  }
  if (reactions.some((reaction) => reaction.type === 'bloom')) {
    return 'Your KIWI vine is blooming.';
  }
  if (reactions.some((reaction) => reaction.type === 'recovery')) {
    return 'Your KIWI vine recovered some vitality.';
  }
  return '';
}

export class VineExpansionController {
  constructor(options = {}) {
    this.mainContent =
      options.mainContent || document.getElementById('mainContent');
    this.overlayRoot =
      options.overlayRoot ||
      document.getElementById('appContainer') ||
      this.mainContent?.parentElement ||
      document.body;
    this.routeProvider =
      options.routeProvider || (() => '');
    this.uiStateProvider =
      options.uiStateProvider || (() => ({}));
    this.stateProvider =
      typeof options.stateProvider === 'function'
        ? options.stateProvider
        : null;

    this.contract = null;
    this.blueprint = null;
    this.renderer = null;
    this.host = null;
    this.destroyed = false;

    this._unsubscribeState = null;
    this._mutationObserver = null;
    this._resizeObserver = null;
    this._onResize = null;
    this._onScroll = null;
    this._raf = 0;
    this._refreshTimer = null;
    this._rendererReleaseTimer = null;
    this._lastRefreshAt = 0;
    this._geometryPolicy = null;
    this._lastRoute = null;
    this._lastFlags = null;
    this._stateRefreshInFlight = null;
    this._statusRegion = null;
  }

  async init() {
    if (!this.mainContent) {
      throw new Error('KIWI vine expansion requires #mainContent.');
    }

    [this.contract, this.blueprint] = await Promise.all([
      loadExpansionContract(),
      loadVineBlueprint(),
    ]);

    this._geometryPolicy =
      derivePixiRuntimePolicy(
        readBrowserRuntimeSignals(window)
      );

    this._createHost();
    this._installObservers();

    this._unsubscribeState = subscribeTreeState(
      (event) => {
        if (this.destroyed) return;
        this.renderer?.playReactions(event.reactions);
        this._announceReactions(event);
        this.scheduleRefresh();
      },
      { emitCurrent: true }
    );

    await this._refreshTreeState(false);
    this.scheduleRefresh();
    return this;
  }

  _createHost() {
    this.mainContent.classList.add('kiwi-vine-expansion-root');

    const existing = this.overlayRoot.querySelector(
      ':scope > .kiwi-vine-expansion-overlay'
    );
    if (existing) existing.remove();

    const host = document.createElement('div');
    host.className = 'kiwi-vine-expansion-overlay';
    host.setAttribute('aria-hidden', 'true');
    Object.assign(host.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      pointerEvents: 'none',
      overflow: 'hidden',
      zIndex: '1',
    });

    this.overlayRoot.appendChild(host);
    this.host = host;

    const status = document.createElement('div');
    status.className = 'sr-only';
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    status.id = 'kiwiVineStatus';
    this.overlayRoot.appendChild(status);
    this._statusRegion = status;

    this._liftPageContent();
    this._syncHostSize();
  }

  _liftPageContent() {
    if (getComputedStyle(this.mainContent).position === 'static') {
      this.mainContent.style.position = 'relative';
    }
    if (this.mainContent.style.zIndex !== '2') {
      this.mainContent.style.zIndex = '2';
    }
  }

  _syncHostSize() {
    if (!this.host) return;
    const width = Math.max(
      Number(window.innerWidth) || 0,
      document.documentElement.clientWidth || 0,
      1
    );
    const height = Math.max(
      Number(window.innerHeight) || 0,
      document.documentElement.clientHeight || 0,
      1
    );
    const nextWidth = width + 'px';
    const nextHeight = height + 'px';
    if (this.host.style.width !== nextWidth) {
      this.host.style.width = nextWidth;
    }
    if (this.host.style.height !== nextHeight) {
      this.host.style.height = nextHeight;
    }
  }

  _installObservers() {
    this._mutationObserver = new MutationObserver(() => {
      if (this.destroyed) return;
      this._liftPageContent();
      this._syncHostSize();
      this.scheduleRefresh();
    });

    this._mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    });

    if (typeof ResizeObserver === 'function') {
      this._resizeObserver = new ResizeObserver(() => {
        if (this.destroyed) return;
        this._syncHostSize();
        this.renderer?.resize();
        this.scheduleRefresh();
      });
      this._resizeObserver.observe(this.mainContent);
    }

    this._onResize = () => {
      this._syncHostSize();
      this.renderer?.resize();
      this.scheduleRefresh();
    };
    window.addEventListener('resize', this._onResize, {
      passive: true,
    });

    this._onScroll = () => this.scheduleRefresh();
    window.addEventListener('scroll', this._onScroll, {
      passive: true,
    });
    this.mainContent.addEventListener(
      'scroll',
      this._onScroll,
      { passive: true }
    );
  }

  scheduleRefresh(options = {}) {
    if (
      this.destroyed ||
      this._raf ||
      this._refreshTimer
    ) {
      return;
    }

    const now =
      typeof performance !== 'undefined'
        ? performance.now()
        : Date.now();
    const minInterval =
      options.immediate === true
        ? 0
        : Math.max(
            16,
            Number(
              this._geometryPolicy
                ?.geometryRefreshMinMs
            ) || 48
          );
    const elapsed =
      now - this._lastRefreshAt;
    const wait = Math.max(
      0,
      minInterval - elapsed
    );

    const queueFrame = () => {
      this._refreshTimer = null;
      if (this.destroyed || this._raf) return;

      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        this._lastRefreshAt =
          typeof performance !== 'undefined'
            ? performance.now()
            : Date.now();

        this.refresh().catch((error) => {
          console.warn(
            '[KIWI] Vine expansion refresh failed:',
            error
          );
        });
      });
    };

    if (wait > 0) {
      this._refreshTimer = setTimeout(
        queueFrame,
        wait
      );
    } else {
      queueFrame();
    }
  }

  async _ensureRenderer() {
    if (
      this.renderer &&
      !this.renderer.destroyed
    ) {
      return this.renderer;
    }

    this._cancelRendererRelease();

    this.renderer =
      await createVineExpansionRenderer({
        host: this.host,
      });

    return this.renderer;
  }

  _cancelRendererRelease() {
    if (this._rendererReleaseTimer) {
      clearTimeout(
        this._rendererReleaseTimer
      );
      this._rendererReleaseTimer = null;
    }
  }

  _scheduleRendererRelease() {
    if (
      !this.renderer ||
      this._rendererReleaseTimer
    ) {
      return;
    }

    this._rendererReleaseTimer =
      setTimeout(async () => {
        this._rendererReleaseTimer = null;
        const renderer = this.renderer;
        this.renderer = null;

        if (renderer) {
          try {
            await renderer.destroy();
          } catch (_) {}
        }
      }, 20000);
  }

  _clearRenderer() {
    if (!this.renderer) return;
    this.renderer.setPaths([]);
    this._scheduleRendererRelease();
  }

  async invalidateState(source = 'manual') {
    await this._refreshTreeState(true, source);
    this.scheduleRefresh();
  }

  async _refreshTreeState(force, source = 'expansion') {
    if (typeof this.stateProvider !== 'function') {
      return getCurrentTreeState();
    }

    if (this._stateRefreshInFlight) {
      return this._stateRefreshInFlight;
    }

    this._stateRefreshInFlight = Promise.resolve()
      .then(() => this.stateProvider({ force: !!force }))
      .then((state) => {
        if (state) {
          publishTreeState(state, {
            source,
            silent: !getCurrentTreeState(),
          });
        }
        return state;
      })
      .catch((error) => {
        console.warn(
          '[KIWI] Tree-state refresh unavailable:',
          error
        );
        return getCurrentTreeState();
      })
      .finally(() => {
        this._stateRefreshInFlight = null;
      });

    return this._stateRefreshInFlight;
  }

  _flags(routeMap) {
    const appFlags = this.uiStateProvider() || {};
    const overlayActive =
      this.contract.globalSuspendSelectors.some(selectorActive);
    const routeSuppress =
      (routeMap?.suppressWhenSelectorsPresent || []).some(
        selectorActive
      );

    return {
      overlayActive: overlayActive || routeSuppress,
      reckoningActive: appFlags.reckoningActive === true,
      tourActive: appFlags.tourActive === true,
      activeStudySession:
        appFlags.activeStudySession === true ||
        selectorActive('#studyLayout') ||
        selectorActive('#studyArena'),
    };
  }

  _rootReferenceRect() {
    return { left: 0, top: 0 };
  }

  _relativeRect(element, rootRect) {
    return rectFromDOMRect(
      element.getBoundingClientRect(),
      rootRect
    );
  }

  _forbiddenRects(routeMap, rootRect) {
    const selectors = [
      ...this.contract.globalForbiddenSelectors,
      ...(routeMap?.forbiddenSelectors || []),
    ];
    const rects = [];

    for (const selector of selectors) {
      for (const element of visibleElements(selector)) {
        if (
          element === this.host ||
          this.host?.contains(element)
        ) {
          continue;
        }
        rects.push(this._relativeRect(element, rootRect));
      }
    }

    return rects;
  }

  _resolveShellAnchor(anchorId, rootRect) {
    const anchor = this.contract.shellAnchors[anchorId];
    if (!anchor) return null;

    const element = visibleElements(anchor.selector)[0];
    if (!element) return null;

    return edgePoint(
      this._relativeRect(element, rootRect),
      anchor.edge,
      anchor.insetPx,
      anchor.ratio
    );
  }

  _resolveLocalSocket(
    routeMap,
    socketId,
    profileName,
    rootRect
  ) {
    if (!routeMap.localSceneSelector) return null;

    const scene = visibleElements(
      routeMap.localSceneSelector
    )[0];
    if (!scene) return null;

    const socket = this.blueprint.localExitSockets.find(
      (item) => item.id === socketId
    );
    if (!socket) return null;

    const profile =
      this.blueprint.compositionProfiles[profileName] ||
      this.blueprint.compositionProfiles.desktop;

    if (!profile.allowExitSockets) return null;

    return localSocketPoint(
      this._relativeRect(scene, rootRect),
      socket,
      profile
    );
  }

  _makePlans(route, routeMap, state, profileName) {
    const rootRect = this._rootReferenceRect();
    const bounds = {
      left: 0,
      top: 0,
      right: Math.max(1, window.innerWidth),
      bottom: Math.max(1, window.innerHeight),
      width: Math.max(1, window.innerWidth),
      height: Math.max(1, window.innerHeight),
    };
    const forbiddenRects =
      this._forbiddenRects(routeMap, rootRect);
    const resolvedEnds = new Map();
    const plans = [];

    let coverage = 0;
    const area = Math.max(1, bounds.width * bounds.height);
    const style = this.contract.externalVineStyle;
    const maturity =
      Number(state.overallGrowthProgress) || 0;

    const eligible = routeMap.paths
      .filter((path) => maturity >= path.minMaturity)
      .filter((path) => path.profiles.includes(profileName))
      .slice()
      .sort((a, b) => a.order - b.order);

    for (const path of eligible) {
      let source = null;

      if (path.source.kind === 'local-socket') {
        source = this._resolveLocalSocket(
          routeMap,
          path.source.socketId,
          profileName,
          rootRect
        );
      } else if (path.source.kind === 'shell-anchor') {
        source = this._resolveShellAnchor(
          path.source.anchorId,
          rootRect
        );
      } else if (path.source.kind === 'path-end') {
        source =
          resolvedEnds.get(path.source.pathId) || null;
      }

      if (!source) continue;

      const targets = selectTargets(path);
      if (!targets.length) continue;

      let firstEnd = null;

      targets.forEach((targetElement, index) => {
        const targetRect = this._relativeRect(
          targetElement,
          rootRect
        );
        const target = edgePoint(
          targetRect,
          path.target.edge,
          path.target.insetPx,
          path.target.ratio
        );

        let points = corridorPoints(
          source,
          target,
          path.corridor,
          bounds,
          path.target.clearancePx
        );

        if (pathIntersectsRects(
          points,
          forbiddenRects,
          3
        )) {
          points = fallbackPerimeterPath(
            source,
            target,
            bounds,
            forbiddenRects,
            path.target.clearancePx
          );
        }

        if (pathIntersectsRects(
          points,
          forbiddenRects,
          3
        )) {
          return;
        }

        const width =
          1.15 +
          (Number(
            state.vineStructure?.baseStemThickness
          ) || 0.25) *
            5.2 *
            style.maxThicknessScale;

        const pathCoverage =
          polylineLength(points) *
          Math.max(1, width) /
          area;

        if (
          coverage + pathCoverage >
          style.maxScreenCoverageRatio
        ) {
          return;
        }

        coverage += pathCoverage;

        const leafBudget = Math.max(
          0,
          Math.round(
            (path.leafBudget || 0) *
            (
              0.28 +
              0.72 *
                (
                  Number(
                    state.vineHealth?.leafDensity
                  ) || 0
                )
            )
          )
        );

        const flowerBudget = Math.max(
          0,
          Math.round(
            (path.flowerBudget || 0) *
            (
              Number(
                state.vineHealth?.flowerVigor
              ) || 0
            )
          )
        );

        const id =
          targets.length > 1
            ? path.id + ':' + index
            : path.id;

        const plan = {
          id,
          basePathId: path.id,
          points,
          width,
          alpha:
            0.62 +
            (
              Number(
                state.vineStructure?.woodyMaturity
              ) || 0
            ) *
              0.20,
          color: colorForVitality(
            state.vitality ?? state.health
          ),
          leafColor: leafColorForState(state),
          leafAlpha:
            0.50 +
            (
              Number(
                state.vineHealth?.leafRetention
              ) || 0.5
            ) *
              0.34,
          flowerAlpha:
            0.68 +
            (
              Number(
                state.vineHealth?.flowerVigor
              ) || 0
            ) *
              0.24,
          motionScale:
            (path.motionScale || 0) *
            style.motionScale,
          leafBudget,
          flowerBudget,
          phase: (path.order || 0) * 0.137,
        };

        plan.decorations = createPathDecorations(
          {
            ...path,
            leafBudget,
            flowerBudget,
            points,
          },
          style,
          route + ':' + id
        );

        plans.push(plan);
        if (!firstEnd) firstEnd = target;
      });

      if (firstEnd) {
        resolvedEnds.set(path.id, firstEnd);
      }
    }

    return plans;
  }

  async refresh() {
    if (this.destroyed) return;

    this._syncHostSize();

    const route = String(
      this.routeProvider() || ''
    );
    const routeMap =
      this.contract.routeExpansionMap[route] || null;

    if (route !== this._lastRoute) {
      this._lastRoute = route;
      await this._refreshTreeState(
        true,
        'route-change'
      );
    }

    let state = getCurrentTreeState();
    let flags = this._flags(routeMap);

    const previousFlags = this._lastFlags;
    this._lastFlags = { ...flags };

    if (
      previousFlags?.activeStudySession === true &&
      flags.activeStudySession === false
    ) {
      state = await this._refreshTreeState(
        true,
        'study-complete'
      );
      flags = this._flags(routeMap);
      this._lastFlags = { ...flags };
    }

    const decision = routePolicyDecision(
      this.contract,
      route,
      state,
      flags,
      window.innerWidth
    );

    if (!decision.enabled || !routeMap) {
      this._clearRenderer();
      return;
    }

    const missingRequired =
      (routeMap.requiredSelectors || []).some(
        (selector) =>
          visibleElements(selector).length === 0
      );

    if (missingRequired) {
      this._clearRenderer();
      return;
    }

    const plans = this._makePlans(
      route,
      routeMap,
      state,
      decision.profile
    );

    if (plans.length === 0) {
      this._clearRenderer();
      return;
    }

    const renderer =
      await this._ensureRenderer();
    this._cancelRendererRelease();
    renderer.setPaths(plans);
  }

  _announceReactions(event) {
    if (
      !this._statusRegion ||
      !event ||
      !Array.isArray(event.reactions)
    ) {
      return;
    }

    const route = String(this.routeProvider() || '');
    const routeMap =
      this.contract?.routeExpansionMap?.[route] || null;
    const policy =
      this.contract?.routePolicy?.[route] || 'disabled';
    const flags = this.contract
      ? this._flags(routeMap)
      : {};

    if (
      policy !== 'mapped' ||
      flags.overlayActive ||
      flags.reckoningActive ||
      flags.tourActive ||
      (route === 'study' && flags.activeStudySession)
    ) {
      return;
    }

    const message =
      reactionAnnouncement(event.reactions);

    if (!message) return;

    this._statusRegion.textContent = '';
    requestAnimationFrame(() => {
      if (this._statusRegion) {
        this._statusRegion.textContent = message;
      }
    });
  }

  getPerformanceSnapshot() {
    return Object.freeze({
      rendererAllocated: !!this.renderer,
      geometryPolicy: this._geometryPolicy
        ? Object.freeze({
            qualityTier: this._geometryPolicy.qualityTier,
            geometryRefreshMinMs:
              this._geometryPolicy.geometryRefreshMinMs,
            maxFPS: this._geometryPolicy.maxFPS,
            reducedMotion:
              this._geometryPolicy.reducedMotion,
            constrainedDevice:
              this._geometryPolicy.constrainedDevice,
          })
        : null,
      renderer:
        this.renderer?.getPerformanceSnapshot?.() ||
        null,
    });
  }

  async destroy() {
    if (this.destroyed) return;
    this.destroyed = true;

    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }

    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }

    this._cancelRendererRelease();

    if (this._unsubscribeState) {
      this._unsubscribeState();
      this._unsubscribeState = null;
    }

    if (this._mutationObserver) {
      this._mutationObserver.disconnect();
      this._mutationObserver = null;
    }

    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }

    if (this._onResize) {
      window.removeEventListener(
        'resize',
        this._onResize
      );
      this._onResize = null;
    }

    if (this._onScroll) {
      window.removeEventListener(
        'scroll',
        this._onScroll
      );
      this.mainContent?.removeEventListener(
        'scroll',
        this._onScroll
      );
      this._onScroll = null;
    }

    if (this.renderer) {
      await this.renderer.destroy();
      this.renderer = null;
    }

    if (this.host) {
      this.host.remove();
      this.host = null;
    }

    if (this._statusRegion) {
      this._statusRegion.remove();
      this._statusRegion = null;
    }

    this.mainContent?.classList.remove(
      'kiwi-vine-expansion-root'
    );
  }
}

export async function createVineExpansionController(
  options
) {
  const controller =
    new VineExpansionController(options);
  await controller.init();
  return controller;
}
