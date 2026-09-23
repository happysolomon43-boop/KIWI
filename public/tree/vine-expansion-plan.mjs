import {
  clamp01,
  deterministicRange,
  deterministicUnit,
  profileNameForWidth,
} from './vine-geometry.mjs';

export function rectFromDOMRect(rect, rootRect = { left: 0, top: 0 }) {
  const left = Number(rect.left) - Number(rootRect.left || 0);
  const top = Number(rect.top) - Number(rootRect.top || 0);
  const width = Number(rect.width) || Math.max(0, Number(rect.right) - Number(rect.left));
  const height = Number(rect.height) || Math.max(0, Number(rect.bottom) - Number(rect.top));
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  };
}

export function edgePoint(rect, edge, insetPx = 0, ratio = null) {
  const inset = Number(insetPx) || 0;
  const r = Number.isFinite(Number(ratio)) ? clamp01(Number(ratio)) : 0.5;

  switch (edge) {
    case 'top-left':
      return { x: rect.left + inset, y: rect.top + inset };
    case 'top-right':
      return { x: rect.right - inset, y: rect.top + inset };
    case 'bottom-left':
      return { x: rect.left + inset, y: rect.bottom - inset };
    case 'bottom-right':
      return { x: rect.right - inset, y: rect.bottom - inset };
    case 'left':
      return { x: rect.left + inset, y: rect.top + rect.height * r };
    case 'right':
      return { x: rect.right - inset, y: rect.top + rect.height * r };
    case 'top':
      return { x: rect.left + rect.width * r, y: rect.top + inset };
    case 'bottom':
      return { x: rect.left + rect.width * r, y: rect.bottom - inset };
    default:
      return { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 };
  }
}

export function localSocketPoint(sceneRect, socket, profile) {
  const safe = Math.max(0, Math.min(0.18, Number(profile?.safeMargin) || 0));
  const x = safe + socket.point.x * (1 - safe * 2);
  const y = safe + socket.point.y * (1 - safe * 2);
  return {
    x: sceneRect.left + sceneRect.width * x,
    y: sceneRect.top + sceneRect.height * y,
  };
}

function pageRailX(source, target, bounds, side, clearance) {
  if (side === 'left') {
    return Math.max(
      bounds.left + 3,
      Math.min(source.x, target.x) - clearance
    );
  }
  return Math.min(
    bounds.right - 3,
    Math.max(source.x, target.x) + clearance
  );
}

function pageRailY(source, target, bounds, side, clearance) {
  if (side === 'top') {
    return Math.max(bounds.top + 3, Math.min(source.y, target.y) - clearance);
  }
  return Math.min(bounds.bottom - 3, Math.max(source.y, target.y) + clearance);
}

export function corridorPoints(source, target, corridor, bounds, clearance = 14) {
  const c = Math.max(8, Number(clearance) || 14);
  const midY = source.y + (target.y - source.y) * 0.5;
  const midX = source.x + (target.x - source.x) * 0.5;

  switch (corridor) {
    case 'outer-gutter':
    case 'right-column-perimeter':
    case 'page-right-safe-rail': {
      const x = pageRailX(source, target, bounds, 'right', c);
      return [source, { x, y: source.y }, { x, y: target.y }, target];
    }
    case 'page-left-safe-rail':
    case 'setup-card-outer-left-only':
    case 'tree-card-to-grid-outer-left':
    case 'grid-perimeter-only': {
      const x = pageRailX(source, target, bounds, 'left', c);
      return [source, { x, y: source.y }, { x, y: target.y }, target];
    }
    case 'tree-card-to-grid-outer-right': {
      const x = pageRailX(source, target, bounds, 'right', c);
      return [source, { x, y: source.y }, { x, y: target.y }, target];
    }
    case 'page-outer-perimeter': {
      const x = pageRailX(source, target, bounds, 'right', c);
      const y = pageRailY(source, target, bounds, 'top', c);
      return [source, { x, y: source.y }, { x, y }, { x: target.x, y }, target];
    }
    case 'column-gap':
      return [
        source,
        { x: midX, y: source.y },
        { x: midX, y: target.y },
        target,
      ];
    default:
      return [
        source,
        { x: source.x + (target.x - source.x) * 0.35, y: midY },
        { x: source.x + (target.x - source.x) * 0.68, y: midY },
        target,
      ];
  }
}

export function pointInRect(point, rect, padding = 0) {
  return (
    point.x >= rect.left - padding &&
    point.x <= rect.right + padding &&
    point.y >= rect.top - padding &&
    point.y <= rect.bottom + padding
  );
}

export function segmentIntersectsRect(a, b, rect, padding = 0, samples = 18) {
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const point = {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    };
    if (pointInRect(point, rect, padding)) return true;
  }
  return false;
}

export function pathIntersectsRects(points, rects, padding = 0) {
  for (let i = 1; i < points.length; i += 1) {
    for (const rect of rects) {
      if (segmentIntersectsRect(points[i - 1], points[i], rect, padding)) {
        return true;
      }
    }
  }
  return false;
}

export function fallbackPerimeterPath(source, target, bounds, forbiddenRects, clearance = 14) {
  const leftX = bounds.left + 4;
  const rightX = bounds.right - 4;
  const left = [source, { x: leftX, y: source.y }, { x: leftX, y: target.y }, target];
  const right = [source, { x: rightX, y: source.y }, { x: rightX, y: target.y }, target];

  const leftHits = forbiddenRects.reduce(
    (sum, rect) => sum + (pathIntersectsRects(left, [rect], clearance) ? 1 : 0),
    0
  );
  const rightHits = forbiddenRects.reduce(
    (sum, rect) => sum + (pathIntersectsRects(right, [rect], clearance) ? 1 : 0),
    0
  );
  return leftHits <= rightHits ? left : right;
}

export function polylineLength(points) {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    length += Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y
    );
  }
  return length;
}

export function pointAlongPolyline(points, progress) {
  const p = clamp01(progress);
  const total = polylineLength(points);
  if (total <= 0 || points.length < 2) return points[0] || { x: 0, y: 0 };

  let distance = p * total;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (distance <= len) {
      const t = len > 0 ? distance / len : 0;
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      };
    }
    distance -= len;
  }
  return points[points.length - 1];
}

export function partialPolyline(points, progress) {
  const p = clamp01(progress);
  if (p <= 0 || points.length === 0) return [];
  if (p >= 1) return points.map((point) => ({ ...point }));

  const total = polylineLength(points);
  const target = p * total;
  const result = [{ ...points[0] }];
  let travelled = 0;

  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (travelled + len <= target) {
      result.push({ ...b });
      travelled += len;
      continue;
    }

    const remaining = target - travelled;
    const t = len > 0 ? remaining / len : 0;
    result.push({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    });
    break;
  }

  return result;
}

export function createPathDecorations(path, style, seed) {
  const length = polylineLength(path.points);
  const leaves = [];
  const flowers = [];
  const leafCount = Math.min(
    path.leafBudget || 0,
    Math.max(0, Math.floor(length / Math.max(36, style.leafSpacingPx || 58)))
  );
  for (let i = 0; i < leafCount; i += 1) {
    const id = seed + ':leaf:' + i;
    leaves.push({
      id,
      t: (i + 1) / (leafCount + 1),
      side: deterministicUnit(id + ':side') < 0.5 ? -1 : 1,
      size: deterministicRange(id + ':size', 6.5, 10.5) * (style.leafScale || 0.76),
      rotation: deterministicRange(id + ':rotation', -0.55, 0.55),
      phase: deterministicRange(id + ':phase', 0, Math.PI * 2),
    });
  }

  const flowerCount = Math.min(
    path.flowerBudget || 0,
    Math.max(0, Math.floor(length / Math.max(80, style.flowerSpacingPx || 120)))
  );
  for (let i = 0; i < flowerCount; i += 1) {
    const id = seed + ':flower:' + i;
    flowers.push({
      id,
      t: 0.58 + 0.34 * ((i + 1) / (flowerCount + 1)),
      size: deterministicRange(id + ':size', 3.2, 4.8),
      phase: deterministicRange(id + ':phase', 0, Math.PI * 2),
    });
  }

  return { leaves, flowers };
}

export function expansionProfile(contract, viewportWidth) {
  const profile = profileNameForWidth(viewportWidth);
  return {
    profile,
    mobileDisabled: profile === 'mobile',
  };
}
