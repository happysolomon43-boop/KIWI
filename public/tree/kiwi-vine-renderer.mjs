import { Graphics } from '/vendor/pixi/pixi.min.mjs';

import { loadVineBlueprint } from './vine-blueprint-loader.mjs';
import { profileNameForWidth } from './vine-geometry.mjs';
import {
  interpolateVineRenderState,
  normalizeVineRenderState,
} from './vine-render-state.mjs';
import { buildStructurePlan } from './vine-structure-plan.mjs';

function easeInOutCubic(t) {
  const p = Math.min(1, Math.max(0, Number(t) || 0));
  return p < 0.5
    ? 4 * p * p * p
    : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

function setGraphicsVisible(graphics, visible) {
  if (!graphics) return;
  graphics.visible = visible;
  graphics.renderable = visible;
}

export class KiwiVineRenderer {
  constructor(options = {}) {
    this.runtime = options.runtime || null;
    this.container = options.container || this.runtime?.container || null;
    this.blueprint = options.blueprint || null;
    this.rawState = options.state || {};
    this.currentState = null;
    this.targetState = null;
    this.animationStartState = null;
    this.animationElapsed = 0;
    this.animationDuration = 0;
    this.animatingState = false;

    this.interactive = options.interactive !== false;
    this.onShake = typeof options.onShake === 'function' ? options.onShake : null;
    this.widthHint = Number(options.width) || 300;
    this.heightHint = Number(options.height) || 360;

    this.destroyed = false;
    this.ready = false;
    this._removeTicker = null;
    this._resizeObserver = null;
    this._clickHandler = null;
    this._interactionImpulse = 0;
    this._lastLayoutKey = '';

    this._backdrop = null;
    this._ground = null;
    this._trellis = null;
    this._roots = null;
    this._tips = null;
    this._segmentGraphics = new Map();
  }

  async init() {
    if (this.destroyed) throw new Error('Cannot initialize a destroyed KIWI vine renderer.');
    if (!this.runtime?.ready || !this.runtime.app) {
      throw new Error('KIWI vine renderer requires a ready Pixi runtime.');
    }
    if (!this.container) {
      throw new Error('KIWI vine renderer requires a container.');
    }

    this.blueprint = this.blueprint || await loadVineBlueprint();

    this._prepareContainer();
    this._createSceneObjects();
    this._installLifecycle();

    this.currentState = normalizeVineRenderState(this.rawState);
    this.targetState = this.currentState;
    this._renderAll();

    this._removeTicker = this.runtime.addTicker((ticker, motionScale) => {
      this._tick(ticker, motionScale);
    }, { motionAware: false });

    this.ready = true;
    this.runtime.renderOnce();
    return this;
  }

  _prepareContainer() {
    const ratioWidth = Math.max(1, this.widthHint);
    const ratioHeight = Math.max(1, this.heightHint);
    this.container.style.aspectRatio = ratioWidth + ' / ' + ratioHeight;
    this.container.style.overflow = 'visible';
    this.container.dataset.kiwiRenderer = 'pixi-vine';
    if (this.interactive) {
      this.container.style.cursor = 'pointer';
      this.container.setAttribute('role', 'img');
      this.container.setAttribute(
        'aria-label',
        'Your living KIWI vine. Growth reflects permanent learning progress and foliage condition reflects current Vitality.'
      );
    }
  }

  _createSceneObjects() {
    this._backdrop = new Graphics();
    this._ground = new Graphics();
    this._trellis = new Graphics();
    this._roots = new Graphics();
    this._tips = new Graphics();

    this.runtime.getLayer('backdrop').addChild(this._backdrop);
    this.runtime.getLayer('backdrop').addChild(this._ground);
    this.runtime.getLayer('trellisRear').addChild(this._trellis);
    this.runtime.getLayer('woodyVine').addChild(this._roots);
    this.runtime.getLayer('woodyVine').addChild(this._tips);
  }

  _installLifecycle() {
    if (typeof ResizeObserver === 'function') {
      this._resizeObserver = new ResizeObserver(() => {
        if (this.destroyed) return;
        this.runtime.resize();
        this._lastLayoutKey = '';
        this._renderAll();
      });
      this._resizeObserver.observe(this.container);
    }

    if (this.interactive) {
      this._clickHandler = () => {
        this._interactionImpulse = Math.min(1, this._interactionImpulse + 0.75);
        if (this.onShake) {
          try { this.onShake(); } catch (_) {}
        }
      };
      this.container.addEventListener('click', this._clickHandler);
    }
  }

  _layout() {
    const screen = this.runtime.app.screen;
    const width = Math.max(1, Number(screen.width) || this.container.clientWidth || this.widthHint);
    const height = Math.max(1, Number(screen.height) || this.container.clientHeight || this.heightHint);
    const profileName = this.runtime.policy?.profile || profileNameForWidth(globalThis.innerWidth);
    const profile =
      this.blueprint.compositionProfiles?.[profileName] ||
      this.blueprint.compositionProfiles?.desktop ||
      {};
    const safe = Math.max(0, Math.min(0.18, Number(profile.safeMargin) || 0.055));
    const scaleX = width * (1 - safe * 2);
    const scaleY = height * (1 - safe * 2);
    const originX = width * safe;
    const originY = height * safe;
    const unit = Math.min(scaleX, scaleY);

    return {
      width,
      height,
      profileName,
      profile,
      safe,
      originX,
      originY,
      scaleX,
      scaleY,
      unit,
      point(point) {
        return {
          x: originX + point.x * scaleX,
          y: originY + point.y * scaleY,
        };
      },
    };
  }

  _renderAll() {
    if (this.destroyed || !this.currentState || !this.blueprint || !this.runtime?.app) return;
    const layout = this._layout();
    const plan = buildStructurePlan(
      this.blueprint,
      this.currentState,
      layout.profileName
    );

    this._renderBackdrop(layout, plan);
    this._renderTrellis(layout, plan);
    this._renderRoots(layout, plan);
    this._renderVineSegments(layout, plan);
    this._renderAdditionalSystems(layout, plan);
    this.runtime.renderOnce();
  }

  // Phase 9 and 10 extend this hook without changing the permanent structure path.
  _renderAdditionalSystems(_layout, _plan) {}

  _renderBackdrop(layout, plan) {
    const base = layout.point({ x: 0.5, y: 0.88 });
    const spread = plan.ground.spread * layout.scaleX;

    this._backdrop
      .clear()
      .ellipse(
        layout.width * 0.5,
        layout.height * 0.48,
        layout.width * 0.43,
        layout.height * 0.39
      )
      .fill({ color: 0x2d6a4f, alpha: 0.025 + plan.state.vineStructure.foliageCapacity * 0.035 });

    this._ground
      .clear()
      .ellipse(base.x, base.y + 5, Math.max(18, spread), Math.max(5, spread * 0.18))
      .fill({ color: 0x21160f, alpha: plan.ground.alpha });
  }

  _renderTrellis(layout, plan) {
    this._trellis.clear();

    for (const member of plan.trellis) {
      const from = layout.point(member.from);
      const to = layout.point(member.to);
      const width = Math.max(2, member.thickness * layout.unit);

      this._trellis
        .moveTo(from.x, from.y)
        .lineTo(to.x, to.y)
        .stroke({
          color: 0x2b1b12,
          width: width + 2.5,
          alpha: member.alpha * 0.58,
          cap: 'round',
          join: 'round',
        });

      this._trellis
        .moveTo(from.x, from.y)
        .lineTo(to.x, to.y)
        .stroke({
          color: member.role === 'brace' ? 0x765139 : 0x8b6242,
          width,
          alpha: member.alpha,
          cap: 'round',
          join: 'round',
        });

      this._trellis
        .moveTo(from.x, from.y)
        .lineTo(to.x, to.y)
        .stroke({
          color: 0xc29262,
          width: Math.max(0.8, width * 0.18),
          alpha: member.alpha * 0.32,
          cap: 'round',
        });
    }
  }

  _renderRoots(layout, plan) {
    const strength = plan.roots.strength;
    const base = layout.point({ x: 0.5, y: 0.88 });
    const spread = 0.045 + 0.12 * strength;
    const depth = 0.016 + 0.026 * strength;
    const rootDefs = [
      [-1.0, 0.82],
      [1.0, 0.78],
      [-0.62, 1.12],
      [0.58, 1.08],
      [-0.20, 1.30],
    ];

    this._roots.clear();
    for (let i = 0; i < rootDefs.length; i += 1) {
      const [direction, lengthScale] = rootDefs[i];
      const end = layout.point({
        x: 0.5 + direction * spread * lengthScale,
        y: 0.88 + depth * (0.55 + i * 0.08),
      });
      const c1 = {
        x: base.x + (end.x - base.x) * 0.28,
        y: base.y + 2 + i,
      };
      const c2 = {
        x: base.x + (end.x - base.x) * 0.70,
        y: end.y - 1,
      };
      const width = Math.max(
        0.8,
        layout.unit * (0.0025 + plan.roots.baseThickness * 0.0065) * (1 - i * 0.09)
      );

      this._roots
        .moveTo(base.x, base.y)
        .bezierCurveTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y)
        .stroke({
          color: 0x51331f,
          width,
          alpha: 0.34 + strength * 0.36,
          cap: 'round',
        });
    }
  }

  _getSegmentGraphics(id) {
    let graphics = this._segmentGraphics.get(id);
    if (!graphics) {
      graphics = new Graphics();
      graphics.label = 'kiwi:vine:' + id;
      this._segmentGraphics.set(id, graphics);
      this.runtime.getLayer('woodyVine').addChild(graphics);
    }
    return graphics;
  }

  _renderVineSegments(layout, plan) {
    const activeIds = new Set();
    this._tips.clear();

    for (const segment of plan.segments) {
      activeIds.add(segment.id);
      const graphics = this._getSegmentGraphics(segment.id);
      const p0 = layout.point(segment.curve.from);
      const p1 = layout.point(segment.curve.c1);
      const p2 = layout.point(segment.curve.c2);
      const p3 = layout.point(segment.curve.to);
      const width = Math.max(1.15, segment.width * layout.unit);

      graphics
        .clear()
        .moveTo(p0.x, p0.y)
        .bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y)
        .stroke({
          color: 0x25170f,
          width: width + Math.max(1, width * 0.20),
          alpha: segment.alpha * 0.50,
          cap: 'round',
          join: 'round',
        })
        .moveTo(p0.x, p0.y)
        .bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y)
        .stroke({
          color: segment.color,
          width,
          alpha: segment.alpha,
          cap: 'round',
          join: 'round',
        })
        .moveTo(p0.x, p0.y)
        .bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y)
        .stroke({
          color: 0xb88a5a,
          width: Math.max(0.65, width * 0.14),
          alpha: 0.11 + plan.state.vineStructure.woodyMaturity * 0.08,
          cap: 'round',
        });

      setGraphicsVisible(graphics, true);

      if (segment.tipActive) {
        this._tips
          .circle(p3.x, p3.y, Math.max(1.5, width * 0.26))
          .fill({
            color: 0x6f9f55,
            alpha: 0.42 + plan.state.vineHealth.shootVigor * 0.48,
          });
      }
    }

    for (const [id, graphics] of this._segmentGraphics) {
      if (activeIds.has(id)) continue;
      graphics.clear();
      setGraphicsVisible(graphics, false);
    }
  }

  _tick(ticker, motionScale) {
    if (this.destroyed) return;

    const deltaMS = Math.min(50, Math.max(0, Number(ticker?.deltaMS) || 16.67));

    if (this.animatingState && this.animationDuration > 0) {
      this.animationElapsed += deltaMS;
      const raw = Math.min(1, this.animationElapsed / this.animationDuration);
      const eased = easeInOutCubic(raw);
      this.currentState = interpolateVineRenderState(
        this.animationStartState,
        this.targetState,
        eased
      );
      this._renderAll();

      if (raw >= 1) {
        this.currentState = this.targetState;
        this.animatingState = false;
        this._renderAll();
      }
    }

    if (this._interactionImpulse > 0) {
      this._interactionImpulse = Math.max(
        0,
        this._interactionImpulse - deltaMS / 650
      );
    }

    this._animateLivingSystems(deltaMS, motionScale);
  }

  // Phase 9/10 use the existing ticker for leaf and reproductive motion.
  _animateLivingSystems(_deltaMS, _motionScale) {}

  updateState(nextState, animate = true) {
    if (this.destroyed) return;
    this.rawState = { ...this.rawState, ...(nextState || {}) };
    const normalized = normalizeVineRenderState(this.rawState);

    if (
      !animate ||
      this.runtime.motionScale <= 0 ||
      !this.currentState
    ) {
      this.currentState = normalized;
      this.targetState = normalized;
      this.animatingState = false;
      this._renderAll();
      return;
    }

    const growthDelta = Math.abs(
      normalized.overallGrowthProgress - this.currentState.overallGrowthProgress
    );
    const vitalityDelta = Math.abs(
      normalized.vitality - this.currentState.vitality
    ) / 100;

    this.animationStartState = this.currentState;
    this.targetState = normalized;
    this.animationElapsed = 0;
    this.animationDuration = Math.round(
      650 + Math.min(1250, growthDelta * 2600 + vitalityDelta * 900)
    );
    this.animatingState = true;
    this.runtime.resume();
  }

  async destroy(options = {}) {
    if (this.destroyed) return;
    this.destroyed = true;
    this.ready = false;

    if (this._removeTicker) {
      try { this._removeTicker(); } catch (_) {}
      this._removeTicker = null;
    }

    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }

    if (this._clickHandler && this.container) {
      this.container.removeEventListener('click', this._clickHandler);
      this._clickHandler = null;
    }

    this._segmentGraphics.clear();

    if (this.container) {
      delete this.container.dataset.kiwiRenderer;
      this.container.style.cursor = '';
      this.container.removeAttribute('role');
      this.container.removeAttribute('aria-label');
    }

    if (options.destroyRuntime !== false && this.runtime) {
      await this.runtime.destroy();
    }
  }
}

export async function createKiwiVineRenderer(options = {}) {
  const renderer = new KiwiVineRenderer(options);
  await renderer.init();
  return renderer;
}
