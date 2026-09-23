export function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function lerp(a, b, t) {
  return Number(a) + (Number(b) - Number(a)) * clamp01(t);
}

export function lerpPoint(a, b, t) {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
  };
}

export function cubicPoint(segment, t) {
  const p = clamp01(t);
  const mt = 1 - p;
  const mt2 = mt * mt;
  const p2 = p * p;
  return {
    x:
      mt2 * mt * segment.from.x +
      3 * mt2 * p * segment.c1.x +
      3 * mt * p2 * segment.c2.x +
      p2 * p * segment.to.x,
    y:
      mt2 * mt * segment.from.y +
      3 * mt2 * p * segment.c1.y +
      3 * mt * p2 * segment.c2.y +
      p2 * p * segment.to.y,
  };
}

export function cubicTangent(segment, t) {
  const p = clamp01(t);
  const mt = 1 - p;
  const x =
    3 * mt * mt * (segment.c1.x - segment.from.x) +
    6 * mt * p * (segment.c2.x - segment.c1.x) +
    3 * p * p * (segment.to.x - segment.c2.x);
  const y =
    3 * mt * mt * (segment.c1.y - segment.from.y) +
    6 * mt * p * (segment.c2.y - segment.c1.y) +
    3 * p * p * (segment.to.y - segment.c2.y);
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

export function cubicAngle(segment, t) {
  const tangent = cubicTangent(segment, t);
  return Math.atan2(tangent.y, tangent.x);
}

export function partialCubic(segment, t) {
  const p = clamp01(t);
  if (p <= 0) {
    return {
      from: { ...segment.from },
      c1: { ...segment.from },
      c2: { ...segment.from },
      to: { ...segment.from },
    };
  }
  if (p >= 1) {
    return {
      from: { ...segment.from },
      c1: { ...segment.c1 },
      c2: { ...segment.c2 },
      to: { ...segment.to },
    };
  }

  const p01 = lerpPoint(segment.from, segment.c1, p);
  const p12 = lerpPoint(segment.c1, segment.c2, p);
  const p23 = lerpPoint(segment.c2, segment.to, p);
  const p012 = lerpPoint(p01, p12, p);
  const p123 = lerpPoint(p12, p23, p);
  const point = lerpPoint(p012, p123, p);

  return {
    from: { ...segment.from },
    c1: p01,
    c2: p012,
    to: point,
  };
}

export function segmentGrowthProgress(segment, maturity) {
  const start = Number(segment.unlockAt) || 0;
  const end = Number(segment.completeAt);
  const finish = Number.isFinite(end) && end > start ? end : start + 0.0001;
  return clamp01((clamp01(maturity) - start) / (finish - start));
}

export function hashString(value) {
  const input = String(value);
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

export function deterministicUnit(seed) {
  let x = hashString(seed) || 1;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return (x >>> 0) / 4294967295;
}

export function deterministicRange(seed, min, max) {
  return min + (max - min) * deterministicUnit(seed);
}

export function profileNameForWidth(width) {
  const w = Number(width);
  if (Number.isFinite(w) && w <= 768) return 'mobile';
  if (Number.isFinite(w) && w <= 1024) return 'tablet';
  return 'desktop';
}
