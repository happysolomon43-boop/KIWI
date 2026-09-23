import {
  Application,
  Container,
  Graphics,
} from '/vendor/pixi/pixi.min.mjs';

import {
  derivePixiRuntimePolicy,
  readBrowserRuntimeSignals,
} from './runtime-policy.mjs';
import {
  partialPolyline,
  pointAlongPolyline,
} from './vine-expansion-plan.mjs';

function drawSmoothPath(graphics, points, style) {
  graphics.clear();
  if (!Array.isArray(points) || points.length < 2) return;

  graphics.moveTo(points[0].x, points[0].y);
  if (points.length === 2) {
    graphics.lineTo(points[1].x, points[1].y);
  } else {
    for (let i = 1; i < points.length - 1; i += 1) {
      const current = points[i];
      const next = points[i + 1];
      const mid = {
        x: (current.x + next.x) * 0.5,
        y: (current.y + next.y) * 0.5,
      };
      graphics.quadraticCurveTo(current.x, current.y, mid.x, mid.y);
    }
    const last = points[points.length - 1];
    graphics.lineTo(last.x, last.y);
  }

  graphics.stroke({
    color: style.shadowColor,
    width: style.width + 1.8,
    alpha: style.alpha * 0.30,
    cap: 'round',
    join: 'round',
  });

  graphics.moveTo(points[0].x, points[0].y);
  if (points.length === 2) {
    graphics.lineTo(points[1].x, points[1].y);
  } else {
    for (let i = 1; i < points.length - 1; i += 1) {
      const current = points[i];
      const next = points[i + 1];
      const mid = {
        x: (current.x + next.x) * 0.5,
        y: (current.y + next.y) * 0.5,
      };
      graphics.quadraticCurveTo(current.x, current.y, mid.x, mid.y);
    }
    const last = points[points.length - 1];
    graphics.lineTo(last.x, last.y);
  }

  graphics.stroke({
    color: style.color,
    width: style.width,
    alpha: style.alpha,
    cap: 'round',
    join: 'round',
  });
}

function drawLeaf(graphics, x, y, size, rotation, color, alpha) {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const p = (dx, dy) => ({
    x: x + dx * cos - dy * sin,
    y: y + dx * sin + dy * cos,
  });
  const tip = p(size * 1.2, 0);
  const top = p(0.1 * size, -0.72 * size);
  const base = p(-0.66 * size, 0);
  const bottom = p(0.1 * size, 0.72 * size);

  graphics
    .moveTo(base.x, base.y)
    .bezierCurveTo(top.x, top.y, tip.x - size * 0.16 * sin, tip.y + size * 0.16 * cos, tip.x, tip.y)
    .bezierCurveTo(tip.x + size * 0.16 * sin, tip.y - size * 0.16 * cos, bottom.x, bottom.y, base.x, base.y)
    .closePath()
    .fill({ color, alpha });
}

function drawFlower(graphics, x, y, size, alpha) {
  for (let i = 0; i < 5; i += 1) {
    const a = -Math.PI / 2 + (Math.PI * 2 * i) / 5;
    graphics
      .ellipse(
        x + Math.cos(a) * size * 0.55,
        y + Math.sin(a) * size * 0.55,
        size * 0.42,
        size * 0.56
      )
      .fill({ color: 0xf4efd9, alpha });
  }
  graphics.circle(x, y, size * 0.30).fill({ color: 0xd7b54b, alpha });
}

export class VineExpansionRenderer {
  constructor(options = {}) {
    this.host = options.host || null;
    this.app = null;
    this.policy = null;
    this.destroyed = false;
    this.nodes = new Map();
    this.time = 0;
    this.reaction = null;
    this._visibilityHandler = null;
    this._motionQuery = null;
    this._motionHandler = null;
  }

  async init() {
    if (!this.host?.isConnected) {
      throw new Error('KIWI expansion renderer requires a connected host.');
    }
    const signals = readBrowserRuntimeSignals(window);
    this.policy = derivePixiRuntimePolicy(signals);

    const app = new Application();
    await app.init({
      resizeTo: this.host,
      preference: 'webgl',
      powerPreference: this.policy.powerPreference,
      backgroundAlpha: 0,
      antialias: this.policy.antialias,
      autoDensity: true,
      resolution: this.policy.resolution,
      autoStart: false,
      sharedTicker: false,
      textureGCActive: true,
    });
    this.app = app;
    this.app.ticker.maxFPS = Math.min(this.policy.maxFPS, 45);

    const canvas = app.canvas;
    canvas.className = 'kiwi-vine-expansion-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.tabIndex = -1;
    Object.assign(canvas.style, {
      width: '100%',
      height: '100%',
      display: 'block',
      pointerEvents: 'none',
    });
    this.host.appendChild(canvas);

    app.ticker.add((ticker) => this._tick(ticker));

    this._visibilityHandler = () => {
      if (!this.app || this.destroyed) return;
      if (document.hidden) {
        this.app.ticker.stop();
      } else if (
        [...this.nodes.values()].some(
          (node) => node.container.visible
        )
      ) {
        this.app.ticker.start();
        this._render();
      }
    };
    document.addEventListener(
      'visibilitychange',
      this._visibilityHandler,
      { passive: true }
    );

    if (typeof window.matchMedia === 'function') {
      this._motionQuery =
        window.matchMedia(
          '(prefers-reduced-motion: reduce)'
        );
      this._motionHandler = (event) => {
        this.policy = Object.freeze({
          ...this.policy,
          reducedMotion: event.matches,
          motionScale: event.matches ? 0 : 1,
        });

        if (event.matches) {
          for (const node of this.nodes.values()) {
            node.reveal = node.targetReveal;
            node.container.position.set(0, 0);
          }
          this.reaction = null;
        }

        this._render();
      };

      if (
        typeof this._motionQuery.addEventListener ===
        'function'
      ) {
        this._motionQuery.addEventListener(
          'change',
          this._motionHandler
        );
      } else if (
        typeof this._motionQuery.addListener ===
        'function'
      ) {
        this._motionQuery.addListener(
          this._motionHandler
        );
      }
    }

    if (!document.hidden) app.ticker.start();
    return this;
  }

  _createNode(plan) {
    const container = new Container();
    container.label = 'kiwi:external:' + plan.id;
    const vine = new Graphics();
    const decoration = new Graphics();
    container.addChild(vine);
    container.addChild(decoration);
    this.app.stage.addChild(container);
    const node = {
      id: plan.id,
      container,
      vine,
      decoration,
      plan,
      reveal: this.policy.reducedMotion ? 1 : 0,
      targetReveal: 1,
      createdAt: performance.now(),
    };
    this.nodes.set(plan.id, node);
    return node;
  }

  setPaths(plans) {
    if (this.destroyed || !this.app) return;
    const active = new Set();

    for (const plan of plans || []) {
      active.add(plan.id);
      let node = this.nodes.get(plan.id);
      if (!node) node = this._createNode(plan);
      node.plan = plan;
      node.targetReveal = 1;
      node.container.visible = true;
    }

    for (const [id, node] of this.nodes) {
      if (active.has(id)) continue;
      if (this.policy.reducedMotion) {
        node.reveal = 0;
        node.container.visible = false;
      } else {
        node.targetReveal = 0;
      }
    }

    this._render();
    this.app.ticker.start();
  }

  playReactions(reactions) {
    const visible = (reactions || []).filter((r) => r.type !== 'stress-settle');
    if (!visible.length || this.policy?.reducedMotion) return;
    const strongest = visible.slice().sort((a, b) => (b.magnitude || 0) - (a.magnitude || 0))[0];
    this.reaction = {
      type: strongest.type,
      magnitude: Math.max(0.2, Math.min(1, Number(strongest.magnitude) || 0.4)),
      elapsed: 0,
      duration: strongest.type === 'milestone' ? 1500 : 900,
    };
    this.app?.ticker.start();
  }

  _tick(ticker) {
    if (this.destroyed || !this.app) return;
    const deltaMS = Math.min(50, Math.max(0, Number(ticker?.deltaMS) || 16.67));
    this.time += deltaMS / 1000;

    let activeAnimation = false;
    for (const node of this.nodes.values()) {
      if (Math.abs(node.reveal - node.targetReveal) > 0.001) {
        const step = deltaMS / (node.targetReveal > node.reveal ? 900 : 360);
        node.reveal += Math.sign(node.targetReveal - node.reveal) * step;
        if (
          (node.targetReveal > node.reveal && node.reveal > node.targetReveal) ||
          (node.targetReveal < node.reveal && node.reveal < node.targetReveal)
        ) node.reveal = node.targetReveal;
        node.reveal = Math.max(0, Math.min(1, node.reveal));
        activeAnimation = true;
      }
      if (node.reveal <= 0.001 && node.targetReveal === 0) {
        node.container.visible = false;
      }
    }

    if (this.reaction) {
      this.reaction.elapsed += deltaMS;
      if (this.reaction.elapsed >= this.reaction.duration) this.reaction = null;
      else activeAnimation = true;
    }

    this._render();

    const hasMotion = [...this.nodes.values()].some(
      (node) => node.container.visible && (node.plan.motionScale || 0) > 0
    );
    if (!activeAnimation && (!hasMotion || this.policy.reducedMotion || document.hidden)) {
      this.app.ticker.stop();
    }
  }

  _render() {
    if (!this.app) return;
    const reactionPhase = this.reaction
      ? 1 - Math.abs((this.reaction.elapsed / this.reaction.duration) * 2 - 1)
      : 0;
    const reactionBoost = this.reaction
      ? reactionPhase * this.reaction.magnitude
      : 0;

    for (const node of this.nodes.values()) {
      if (!node.container.visible || node.reveal <= 0.001) continue;
      const plan = node.plan;
      const visiblePoints = partialPolyline(plan.points, node.reveal);
      const sway =
        this.policy.reducedMotion
          ? 0
          : Math.sin(this.time * 0.70 + plan.phase) *
            0.55 *
            (plan.motionScale || 0);

      node.container.position.y = sway;
      node.container.alpha = Math.min(1, 0.88 + reactionBoost * 0.12);

      drawSmoothPath(node.vine, visiblePoints, {
        width: plan.width * (1 + reactionBoost * 0.12),
        color: plan.color,
        shadowColor: 0x22160f,
        alpha: plan.alpha,
      });

      node.decoration.clear();
      for (const leaf of plan.decorations?.leaves || []) {
        if (leaf.t > node.reveal) continue;
        const p = pointAlongPolyline(plan.points, leaf.t);
        drawLeaf(
          node.decoration,
          p.x,
          p.y,
          leaf.size * (1 + reactionBoost * 0.08),
          leaf.rotation + leaf.side * 0.20,
          plan.leafColor,
          plan.leafAlpha
        );
      }
      for (const flower of plan.decorations?.flowers || []) {
        if (flower.t > node.reveal) continue;
        const p = pointAlongPolyline(plan.points, flower.t);
        drawFlower(
          node.decoration,
          p.x,
          p.y,
          flower.size * (1 + reactionBoost * 0.10),
          plan.flowerAlpha
        );
      }
    }

    this.app.renderer.render(this.app.stage);
  }

  resize() {
    if (!this.app) return;
    if (typeof this.app.resize === 'function') this.app.resize();
    this._render();
  }

  async destroy() {
    if (this.destroyed) return;
    this.destroyed = true;

    if (this._visibilityHandler) {
      document.removeEventListener(
        'visibilitychange',
        this._visibilityHandler
      );
      this._visibilityHandler = null;
    }

    if (this._motionQuery && this._motionHandler) {
      if (
        typeof this._motionQuery.removeEventListener ===
        'function'
      ) {
        this._motionQuery.removeEventListener(
          'change',
          this._motionHandler
        );
      } else if (
        typeof this._motionQuery.removeListener ===
        'function'
      ) {
        this._motionQuery.removeListener(
          this._motionHandler
        );
      }
    }
    this._motionQuery = null;
    this._motionHandler = null;

    if (this.app) {
      try {
        this.app.ticker.stop();
        this.app.destroy(true, { children: true, texture: false, textureSource: false });
      } catch (_) {}
      this.app = null;
    }
    this.nodes.clear();
  }
}

export async function createVineExpansionRenderer(options) {
  const renderer = new VineExpansionRenderer(options);
  await renderer.init();
  return renderer;
}
