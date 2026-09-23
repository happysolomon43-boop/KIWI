function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function uniqueMilestones(value) {
  return new Set(
    (Array.isArray(value) ? value : [])
      .map((item) => Math.floor(Number(item)))
      .filter((item) => Number.isFinite(item) && item > 0)
  );
}

export function deriveTreeReactions(previous, next) {
  if (!previous || !next) return [];

  const reactions = [];
  const prevGrowth = finite(previous.growthPoints);
  const nextGrowth = finite(next.growthPoints);
  const growthDelta = nextGrowth - prevGrowth;

  if (growthDelta > 0) {
    reactions.push({
      type: 'growth',
      magnitude: Math.min(1, 0.25 + growthDelta / 24),
      delta: growthDelta,
    });
  }

  const prevStage = Math.max(1, Math.floor(finite(previous.stage, 1)));
  const nextStage = Math.max(1, Math.floor(finite(next.stage, 1)));
  if (nextStage > prevStage) {
    reactions.push({
      type: 'milestone',
      magnitude: Math.min(1, 0.55 + (nextStage - prevStage) * 0.18),
      fromStage: prevStage,
      toStage: nextStage,
    });
  }

  const vitalityDelta = finite(next.vitality ?? next.health, 100) -
    finite(previous.vitality ?? previous.health, 100);
  if (vitalityDelta >= 5) {
    reactions.push({
      type: 'recovery',
      magnitude: Math.min(1, 0.30 + vitalityDelta / 45),
      delta: vitalityDelta,
    });
  } else if (vitalityDelta <= -8) {
    reactions.push({
      type: 'stress-settle',
      magnitude: Math.min(1, 0.25 + Math.abs(vitalityDelta) / 50),
      delta: vitalityDelta,
    });
  }

  const fruitDelta = Math.floor(finite(next.fruits)) -
    Math.floor(finite(previous.fruits));
  if (fruitDelta > 0) {
    reactions.push({
      type: 'fruit-set',
      magnitude: Math.min(1, 0.40 + fruitDelta / 8),
      delta: fruitDelta,
    });
  }

  const previousMilestones = uniqueMilestones(previous.milestones);
  const newMilestones = [...uniqueMilestones(next.milestones)]
    .filter((value) => !previousMilestones.has(value));
  const ringDelta = Math.floor(finite(next.rings)) - Math.floor(finite(previous.rings));
  if (newMilestones.length > 0 || ringDelta > 0) {
    reactions.push({
      type: 'streak-root',
      magnitude: Math.min(1, 0.46 + Math.max(newMilestones.length, ringDelta) * 0.15),
      milestones: newMilestones,
      ringDelta: Math.max(0, ringDelta),
    });
  }

  const prevFlowering = finite(previous.vineStructure?.floweringCapacity);
  const nextFlowering = finite(next.vineStructure?.floweringCapacity);
  const prevVigor = finite(previous.vineHealth?.flowerVigor);
  const nextVigor = finite(next.vineHealth?.flowerVigor);
  if (
    nextFlowering > 0.08 &&
    (
      (prevFlowering <= 0.08 && nextFlowering > prevFlowering) ||
      nextVigor - prevVigor >= 0.22
    )
  ) {
    reactions.push({
      type: 'bloom',
      magnitude: Math.min(1, 0.35 + (nextFlowering - prevFlowering) + (nextVigor - prevVigor)),
    });
  }

  return reactions;
}

export function strongestTreeReaction(reactions) {
  const priority = {
    milestone: 6,
    'fruit-set': 5,
    'streak-root': 4,
    growth: 3,
    bloom: 2,
    recovery: 1,
    'stress-settle': 0,
  };
  return (Array.isArray(reactions) ? reactions : [])
    .slice()
    .sort((a, b) => {
      const p = (priority[b.type] ?? -1) - (priority[a.type] ?? -1);
      if (p !== 0) return p;
      return finite(b.magnitude) - finite(a.magnitude);
    })[0] || null;
}
