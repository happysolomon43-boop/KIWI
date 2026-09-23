export const QUALITY_TIER_ORDER = Object.freeze([
  'minimal',
  'low',
  'balanced',
  'high',
]);

export const QUALITY_TIER_CONFIG = Object.freeze({
  minimal: Object.freeze({
    tier: 'minimal',
    qualityScale: 0.58,
    foliageScale: 0.64,
    flowerScale: 0.55,
    motionScale: 0.24,
    maxFPS: 24,
    continuousMotion: false,
    geometryRefreshMinMs: 120,
  }),
  low: Object.freeze({
    tier: 'low',
    qualityScale: 0.74,
    foliageScale: 0.80,
    flowerScale: 0.72,
    motionScale: 0.52,
    maxFPS: 30,
    continuousMotion: false,
    geometryRefreshMinMs: 82,
  }),
  balanced: Object.freeze({
    tier: 'balanced',
    qualityScale: 0.90,
    foliageScale: 0.94,
    flowerScale: 0.90,
    motionScale: 0.82,
    maxFPS: 45,
    continuousMotion: true,
    geometryRefreshMinMs: 48,
  }),
  high: Object.freeze({
    tier: 'high',
    qualityScale: 1,
    foliageScale: 1,
    flowerScale: 1,
    motionScale: 1,
    maxFPS: 60,
    continuousMotion: true,
    geometryRefreshMinMs: 32,
  }),
});

export function getQualityConfig(tier) {
  return QUALITY_TIER_CONFIG[tier] || QUALITY_TIER_CONFIG.balanced;
}

export function deriveInitialQualityTier(input = {}) {
  if (input.reducedMotion === true || input.saveData === true) {
    return 'minimal';
  }

  const memory = Number(input.deviceMemory);
  const cores = Number(input.hardwareConcurrency);
  const profile = String(input.profile || 'desktop');

  if (
    (Number.isFinite(memory) && memory <= 2) ||
    (Number.isFinite(cores) && cores <= 2)
  ) {
    return 'minimal';
  }

  if (
    input.constrainedDevice === true ||
    profile === 'mobile'
  ) {
    return 'low';
  }

  if (profile === 'tablet') {
    return 'balanced';
  }

  return 'high';
}

function tierIndex(tier) {
  const index = QUALITY_TIER_ORDER.indexOf(tier);
  return index >= 0 ? index : QUALITY_TIER_ORDER.indexOf('balanced');
}

export function lowerQualityTier(tier) {
  const index = tierIndex(tier);
  return QUALITY_TIER_ORDER[Math.max(0, index - 1)];
}

export function higherQualityTier(tier, ceiling = 'high') {
  const index = tierIndex(tier);
  const ceilingIndex = tierIndex(ceiling);
  return QUALITY_TIER_ORDER[
    Math.min(ceilingIndex, index + 1)
  ];
}

export class FrameBudgetMonitor {
  constructor(options = {}) {
    this.initialTier = options.initialTier || 'balanced';
    this.tier = this.initialTier;
    this.ceilingTier = options.ceilingTier || this.initialTier;
    this.onTierChange =
      typeof options.onTierChange === 'function'
        ? options.onTierChange
        : null;

    this.windowSize = Math.max(
      30,
      Math.floor(Number(options.windowSize) || 90)
    );
    this.recoveryWindows = Math.max(
      3,
      Math.floor(Number(options.recoveryWindows) || 6)
    );

    this.samples = [];
    this.goodWindows = 0;
    this.totalSamples = 0;
    this.totalSlowFrames = 0;
    this.lastAverageMs = 0;
    this.lastSlowRatio = 0;
    this.lastDecision = 'stable';
  }

  sample(deltaMS) {
    const raw = Number(deltaMS);
    if (!Number.isFinite(raw) || raw <= 0) return null;

    // Ignore background-tab / debugger discontinuities; those are not GPU load.
    const value = Math.min(120, raw);
    this.samples.push(value);
    this.totalSamples += 1;

    const target =
      1000 / getQualityConfig(this.tier).maxFPS;
    if (value > target * 1.55) {
      this.totalSlowFrames += 1;
    }

    if (this.samples.length < this.windowSize) {
      return null;
    }

    const current = this.samples.splice(0, this.samples.length);
    const average =
      current.reduce((sum, sample) => sum + sample, 0) /
      current.length;
    const slow = current.filter(
      (sample) => sample > target * 1.55
    ).length;
    const slowRatio = slow / current.length;

    this.lastAverageMs = average;
    this.lastSlowRatio = slowRatio;

    const overloaded =
      average > target * 1.24 ||
      slowRatio >= 0.18;

    if (overloaded) {
      this.goodWindows = 0;
      const next = lowerQualityTier(this.tier);
      if (next !== this.tier) {
        return this._changeTier(next, 'frame-budget-overload');
      }
      this.lastDecision = 'minimum-quality';
      return null;
    }

    const comfortablyWithinBudget =
      average < target * 0.86 &&
      slowRatio <= 0.035;

    if (comfortablyWithinBudget) {
      this.goodWindows += 1;
      if (this.goodWindows >= this.recoveryWindows) {
        this.goodWindows = 0;
        const next = higherQualityTier(
          this.tier,
          this.ceilingTier
        );
        if (next !== this.tier) {
          return this._changeTier(next, 'sustained-headroom');
        }
      }
    } else {
      this.goodWindows = 0;
    }

    this.lastDecision = 'stable';
    return null;
  }

  _changeTier(nextTier, reason) {
    const previousTier = this.tier;
    this.tier = nextTier;
    this.lastDecision = reason;

    const event = Object.freeze({
      previousTier,
      tier: nextTier,
      reason,
      config: getQualityConfig(nextTier),
      averageMs: this.lastAverageMs,
      slowRatio: this.lastSlowRatio,
    });

    if (this.onTierChange) {
      try { this.onTierChange(event); } catch (_) {}
    }

    return event;
  }

  snapshot() {
    return Object.freeze({
      tier: this.tier,
      initialTier: this.initialTier,
      ceilingTier: this.ceilingTier,
      totalSamples: this.totalSamples,
      totalSlowFrames: this.totalSlowFrames,
      averageMs: this.lastAverageMs,
      slowRatio: this.lastSlowRatio,
      decision: this.lastDecision,
    });
  }
}
