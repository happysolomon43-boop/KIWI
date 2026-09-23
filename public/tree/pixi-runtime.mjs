import {
  Application,
  Container,
} from '/vendor/pixi/pixi.min.mjs';

import {
  PIXI_LAYER_ORDER,
  derivePixiRuntimePolicy,
  readBrowserRuntimeSignals,
  shouldRunTicker,
} from './runtime-policy.mjs';

function createLayer(name) {
  const layer = new Container();
  layer.label = 'kiwi:' + name;
  return layer;
}

export class KiwiPixiRuntime {
  constructor(options = {}) {
    this.container = options.container || null;
    this.onFailure = typeof options.onFailure === 'function' ? options.onFailure : null;
    this.onReady = typeof options.onReady === 'function' ? options.onReady : null;
    this.policyOverrides = options.policy || null;

    this.app = null;
    this.layers = null;
    this.policy = null;
    this.destroyed = false;
    this.ready = false;
    this.intersectionKnown = false;
    this.intersecting = true;

    this._intersectionObserver = null;
    this._visibilityHandler = null;
    this._motionQuery = null;
    this._motionHandler = null;
  }

  async init() {
    if (this.destroyed) {
      throw new Error('Cannot initialize a destroyed KIWI Pixi runtime.');
    }
    if (!this.container || typeof this.container.appendChild !== 'function') {
      throw new Error('KIWI Pixi runtime requires a valid container element.');
    }
    if (!this.container.isConnected) {
      throw new Error('KIWI Pixi runtime container must be connected to the document.');
    }
    if (this.app) return this;

    try {
      const signals = readBrowserRuntimeSignals(window);
      this.policy = Object.freeze({
        ...derivePixiRuntimePolicy(signals),
        ...(this.policyOverrides || {}),
      });

      const app = new Application();

      await app.init({
        resizeTo: this.container,
        preference: 'webgl',
        powerPreference: this.policy.powerPreference,
        backgroundAlpha: this.policy.backgroundAlpha,
        antialias: this.policy.antialias,
        autoDensity: this.policy.autoDensity,
        resolution: this.policy.resolution,
        autoStart: false,
        sharedTicker: false,
        textureGCActive: this.policy.textureGCActive,
      });

      this.app = app;
      this.app.ticker.maxFPS = this.policy.maxFPS;

      const canvas = app.canvas;
      canvas.className = 'kiwi-pixi-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.tabIndex = -1;
      Object.assign(canvas.style, {
        display: 'block',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      });

      this.container.appendChild(canvas);

      this.layers = Object.create(null);
      for (const name of PIXI_LAYER_ORDER) {
        const layer = createLayer(name);
        this.layers[name] = layer;
        app.stage.addChild(layer);
      }

      this._installLifecycleObservers();
      this.ready = true;
      this._syncTicker();

      if (this.onReady) this.onReady(this);
      return this;
    } catch (error) {
      await this.destroy();
      if (this.onFailure) {
        try { this.onFailure(error); } catch (_) {}
      }
      throw error;
    }
  }

  getLayer(name) {
    if (!this.layers || !this.layers[name]) {
      throw new Error('Unknown or unavailable KIWI Pixi layer: ' + name);
    }
    return this.layers[name];
  }

  get motionScale() {
    return this.policy?.reducedMotion ? 0 : (this.policy?.motionScale ?? 1);
  }

  addTicker(callback, options = {}) {
    if (!this.app || typeof callback !== 'function') return () => {};

    const motionAware = options.motionAware !== false;
    const wrapped = (ticker) => {
      if (motionAware && this.motionScale <= 0) return;
      callback(ticker, this.motionScale);
    };

    this.app.ticker.add(wrapped);
    this._syncTicker();

    return () => {
      if (this.app) this.app.ticker.remove(wrapped);
    };
  }

  renderOnce() {
    if (!this.app || this.destroyed) return;
    this.app.renderer.render(this.app.stage);
  }

  resize() {
    if (!this.app || this.destroyed) return;
    if (typeof this.app.resize === 'function') this.app.resize();
  }

  pause() {
    if (this.app) this.app.ticker.stop();
  }

  resume() {
    this._syncTicker();
  }

  _installLifecycleObservers() {
    this._visibilityHandler = () => this._syncTicker();
    document.addEventListener('visibilitychange', this._visibilityHandler, { passive: true });

    if (typeof IntersectionObserver === 'function') {
      this._intersectionObserver = new IntersectionObserver(
        (entries) => {
          const entry = entries[entries.length - 1];
          if (!entry) return;
          this.intersectionKnown = true;
          this.intersecting = entry.isIntersecting && entry.intersectionRatio > 0;
          this._syncTicker();
        },
        { root: null, threshold: [0, 0.01] }
      );
      this._intersectionObserver.observe(this.container);
    }

    if (typeof window.matchMedia === 'function') {
      this._motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      this._motionHandler = (event) => {
        this.policy = Object.freeze({
          ...this.policy,
          reducedMotion: event.matches,
          motionScale: event.matches ? 0 : 1,
        });
        this.renderOnce();
      };

      if (typeof this._motionQuery.addEventListener === 'function') {
        this._motionQuery.addEventListener('change', this._motionHandler);
      } else if (typeof this._motionQuery.addListener === 'function') {
        this._motionQuery.addListener(this._motionHandler);
      }
    }
  }

  _syncTicker() {
    if (!this.app) return;

    const run = shouldRunTicker({
      destroyed: this.destroyed,
      documentHidden: document.hidden,
      intersectionKnown: this.intersectionKnown,
      intersecting: this.intersecting,
    });

    if (run) this.app.ticker.start();
    else this.app.ticker.stop();
  }

  async destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.ready = false;

    if (this._intersectionObserver) {
      this._intersectionObserver.disconnect();
      this._intersectionObserver = null;
    }

    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
    }

    if (this._motionQuery && this._motionHandler) {
      if (typeof this._motionQuery.removeEventListener === 'function') {
        this._motionQuery.removeEventListener('change', this._motionHandler);
      } else if (typeof this._motionQuery.removeListener === 'function') {
        this._motionQuery.removeListener(this._motionHandler);
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

    this.layers = null;
  }
}

export async function createKiwiPixiRuntime(options) {
  const runtime = new KiwiPixiRuntime(options);
  await runtime.init();
  return runtime;
}
