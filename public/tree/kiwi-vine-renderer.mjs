import { Container, Graphics } from '/vendor/pixi/pixi.min.mjs';

import { loadVineBlueprint } from './vine-blueprint-loader.mjs';
import { profileNameForWidth } from './vine-geometry.mjs';
import {
  interpolateVineRenderState,
  normalizeVineRenderState,
} from './vine-render-state.mjs';
import { buildStructurePlan } from './vine-structure-plan.mjs';
import { buildFoliagePlan } from './vine-foliage-plan.mjs';
import { buildReproductivePlan } from './vine-reproductive-plan.mjs';

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
    this._leafNodes = new Map();
    this._flowerNodes = new Map();
    this._fruitNodes = new Map();
    this._livingTime = 0;
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
    const profileName = profileNameForWidth(globalThis.innerWidth);
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

  _renderAdditionalSystems(layout, plan) {
    const foliagePlan = buildFoliagePlan(
      this.blueprint,
      this.currentState,
      plan,
      layout.profileName
    );
    this._renderFoliage(layout, foliagePlan);

    const reproductivePlan = buildReproductivePlan(
      this.blueprint,
      this.currentState,
      plan,
      layout.profileName
    );
    this._renderReproduction(layout, reproductivePlan);
  }

  _createLeafNode(id, layerName) {
    const container = new Container();
    container.label = id;

    const petiole = new Graphics();
    const leaf = new Graphics();

    // Broad cordate kiwi leaf: pointed tip, rounded shoulders, shallow basal notch.
    leaf
      .moveTo(0, -14)
      .bezierCurveTo(10, -10, 15, -1, 11, 8)
      .bezierCurveTo(7, 14, 2.5, 11, 0, 7)
      .bezierCurveTo(-2.5, 11, -7, 14, -11, 8)
      .bezierCurveTo(-15, -1, -10, -10, 0, -14)
      .closePath()
      .fill({ color: 0xffffff, alpha: 1 });

    // Main vein and a restrained pair of secondary veins.
    leaf
      .moveTo(0, 7)
      .lineTo(0, -11)
      .stroke({ color: 0xffffff, width: 0.9, alpha: 0.42, cap: 'round' })
      .moveTo(0, -1)
      .lineTo(6.5, -5)
      .stroke({ color: 0xffffff, width: 0.55, alpha: 0.24, cap: 'round' })
      .moveTo(0, 1)
      .lineTo(-6.2, -3)
      .stroke({ color: 0xffffff, width: 0.55, alpha: 0.22, cap: 'round' });

    container.addChild(petiole);
    container.addChild(leaf);
    this.runtime.getLayer(layerName).addChild(container);

    const node = {
      id,
      layerName,
      container,
      petiole,
      leaf,
      phase: 0,
      speed: 0,
      sway: 0,
      movementStrength: 0,
      baseLeafRotation: 0,
      active: false,
    };
    this._leafNodes.set(id, node);
    return node;
  }

  _renderFoliage(layout, foliagePlan) {
    const activeIds = new Set();

    for (const item of foliagePlan.leaves) {
      activeIds.add(item.id);
      let node = this._leafNodes.get(item.id);
      if (!node) node = this._createLeafNode(item.id, item.layer);

      const attach = layout.point(item.attach);
      const center = layout.point(item.center);
      const dx = center.x - attach.x;
      const dy = center.y - attach.y;
      const halfSize = Math.max(5.5, item.size * layout.unit);
      const leafScale = (halfSize / 14) * item.scale;

      node.container.visible = true;
      node.container.renderable = true;
      node.container.position.set(attach.x, attach.y);
      node.container.alpha = item.alpha;

      node.petiole
        .clear()
        .moveTo(0, 0)
        .lineTo(dx, dy)
        .stroke({
          color: 0x587144,
          width: Math.max(0.75, halfSize * 0.075),
          alpha: Math.min(0.74, item.alpha * 0.82),
          cap: 'round',
        });

      node.leaf.position.set(dx, dy);
      node.leaf.scale.set(leafScale * item.aspect, leafScale);
      node.leaf.rotation = item.rotation;
      node.leaf.tint = item.color;

      node.phase = item.phase;
      node.speed = item.speed;
      node.sway = item.sway;
      node.movementStrength = item.movementStrength;
      node.baseLeafRotation = item.rotation;
      node.active = true;
    }

    for (const [id, node] of this._leafNodes) {
      if (activeIds.has(id)) continue;
      node.active = false;
      node.container.visible = false;
      node.container.renderable = false;
    }
  }

  _createFlowerNode(id) {
    const container = new Container();
    container.label = id;

    const stem = new Graphics();
    const bloom = new Graphics();

    for (let i = 0; i < 5; i += 1) {
      const angle = -Math.PI / 2 + (Math.PI * 2 * i) / 5;
      const px = Math.cos(angle) * 3.1;
      const py = Math.sin(angle) * 3.1;
      bloom
        .ellipse(px, py, 2.5, 3.4)
        .fill({ color: 0xf4efd9, alpha: 0.95 });
    }
    bloom
      .circle(0, 0, 2.15)
      .fill({ color: 0xd8b64d, alpha: 0.98 })
      .circle(-0.7, -0.6, 0.45)
      .fill({ color: 0xfff7c8, alpha: 0.82 });

    container.addChild(stem);
    container.addChild(bloom);
    this.runtime.getLayer('flowers').addChild(container);

    const node = {
      id,
      container,
      stem,
      bloom,
      phase: 0,
      movementStrength: 0,
      baseRotation: 0,
      active: false,
    };
    this._flowerNodes.set(id, node);
    return node;
  }

  _createFruitNode(id) {
    const container = new Container();
    container.label = id;

    const stem = new Graphics();
    const fruit = new Graphics();
    container.addChild(stem);
    container.addChild(fruit);
    this.runtime.getLayer('fruit').addChild(container);

    const node = {
      id,
      container,
      stem,
      fruit,
      phase: 0,
      sway: 0,
      movementStrength: 0,
      active: false,
    };
    this._fruitNodes.set(id, node);
    return node;
  }

  _renderReproduction(layout, reproductivePlan) {
    const activeFlowerIds = new Set();

    for (const item of reproductivePlan.flowers) {
      activeFlowerIds.add(item.id);
      let node = this._flowerNodes.get(item.id);
      if (!node) node = this._createFlowerNode(item.id);

      const attach = layout.point(item.attach);
      const center = layout.point(item.center);
      const dx = center.x - attach.x;
      const dy = center.y - attach.y;
      const size = Math.max(3.6, item.size * layout.unit);
      const scale = (size / 7) * item.scale;

      node.container.visible = true;
      node.container.renderable = true;
      node.container.position.set(attach.x, attach.y);
      node.container.alpha = item.alpha;

      node.stem
        .clear()
        .moveTo(0, 0)
        .lineTo(dx, dy)
        .stroke({
          color: 0x607746,
          width: Math.max(0.65, size * 0.12),
          alpha: 0.66,
          cap: 'round',
        });

      node.bloom.position.set(dx, dy);
      node.bloom.scale.set(scale);
      node.bloom.rotation = item.baseRotation;

      node.phase = item.phase;
      node.movementStrength = item.movementStrength;
      node.baseRotation = item.baseRotation;
      node.active = true;
    }

    for (const [id, node] of this._flowerNodes) {
      if (activeFlowerIds.has(id)) continue;
      node.active = false;
      node.container.visible = false;
      node.container.renderable = false;
    }

    const activeFruitIds = new Set();

    for (const item of reproductivePlan.fruits) {
      activeFruitIds.add(item.id);
      let node = this._fruitNodes.get(item.id);
      if (!node) node = this._createFruitNode(item.id);

      const attach = layout.point(item.attach);
      const stemLength = Math.max(7, item.stemLength * layout.scaleY);
      const fruitHalfWidth = Math.max(3.4, item.size * layout.unit);
      const fruitHalfHeight = fruitHalfWidth * 1.30;
      const spread = Math.max(3.2, item.spread * layout.scaleX);

      node.container.visible = true;
      node.container.renderable = true;
      node.container.position.set(attach.x, attach.y);
      node.container.alpha = item.alpha;
      node.container.scale.set(item.scale);

      node.stem
        .clear()
        .moveTo(0, 0)
        .bezierCurveTo(
          0,
          stemLength * 0.34,
          spread * 0.08,
          stemLength * 0.70,
          0,
          stemLength
        )
        .stroke({
          color: 0x5b7040,
          width: Math.max(0.85, fruitHalfWidth * 0.14),
          alpha: 0.84,
          cap: 'round',
        });

      node.fruit.clear();
      const clusterSize = Math.max(1, Math.min(3, item.clusterSize || 1));
      for (let i = 0; i < clusterSize; i += 1) {
        const offsetX =
          clusterSize === 1
            ? 0
            : (i - (clusterSize - 1) / 2) * spread;
        const offsetY =
          stemLength +
          (i % 2) * fruitHalfHeight * 0.28;

        node.fruit
          .ellipse(
            offsetX,
            offsetY + fruitHalfHeight * 0.46,
            fruitHalfWidth,
            fruitHalfHeight
          )
          .fill({ color: 0x8b6a3f, alpha: 0.98 })
          .ellipse(
            offsetX - fruitHalfWidth * 0.28,
            offsetY + fruitHalfHeight * 0.12,
            fruitHalfWidth * 0.26,
            fruitHalfHeight * 0.40
          )
          .fill({ color: 0xb79a66, alpha: 0.27 })
          .circle(
            offsetX + fruitHalfWidth * 0.24,
            offsetY + fruitHalfHeight * 0.54,
            Math.max(0.45, fruitHalfWidth * 0.10)
          )
          .fill({ color: 0x5b4229, alpha: 0.48 });
      }

      node.phase = item.phase;
      node.sway = item.sway;
      node.movementStrength = item.movementStrength;
      node.active = true;
    }

    for (const [id, node] of this._fruitNodes) {
      if (activeFruitIds.has(id)) continue;
      node.active = false;
      node.container.visible = false;
      node.container.renderable = false;
    }
  }

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

  _animateLivingSystems(deltaMS, motionScale) {
    this._livingTime += deltaMS / 1000;
    const interactionBoost = 1 + this._interactionImpulse * 1.8;

    for (const node of this._leafNodes.values()) {
      if (!node.active || !node.container.visible) continue;
      const sway =
        Math.sin(this._livingTime * node.speed * Math.PI * 2 + node.phase) *
        node.sway *
        node.movementStrength *
        motionScale *
        interactionBoost;
      node.container.rotation = sway;
    }

    for (const node of this._flowerNodes.values()) {
      if (!node.active || !node.container.visible) continue;
      node.container.rotation =
        Math.sin(this._livingTime * 1.45 + node.phase) *
        0.018 *
        node.movementStrength *
        motionScale *
        interactionBoost;
    }

    for (const node of this._fruitNodes.values()) {
      if (!node.active || !node.container.visible) continue;
      node.container.rotation =
        Math.sin(this._livingTime * 1.10 + node.phase) *
        node.sway *
        node.movementStrength *
        motionScale *
        interactionBoost;
    }
  }

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
    this._leafNodes.clear();
    this._flowerNodes.clear();
    this._fruitNodes.clear();

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
