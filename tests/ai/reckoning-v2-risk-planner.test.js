'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createRiskEngine,
  createPlanner,
  RISK_LEVELS,
} = require('../../services/reckoning');

const fixedNow = new Date('2026-09-23T08:00:00.000Z');

test('risk engine is deterministic and preserves the intended state ordering', () => {
  const engine = createRiskEngine({ clock: () => fixedNow.getTime() });

  const dangerous = engine.score({ state: 'DANGEROUS' }, { now: fixedNow });
  const stuck = engine.score({ state: 'STUCK' }, { now: fixedNow });
  const fragile = engine.score({ state: 'FRAGILE' }, { now: fixedNow });
  const stable = engine.score({ state: 'STABLE', verified: true }, { now: fixedNow });

  assert.ok(dangerous.score > stuck.score);
  assert.ok(stuck.score > fragile.score);
  assert.ok(fragile.score > stable.score);
  assert.equal(dangerous.level, RISK_LEVELS.CRITICAL);
  assert.equal(stable.level, RISK_LEVELS.SUPPORTING);

  assert.deepEqual(
    engine.score({ state: 'STUCK', recentExamMisses: 2 }, { now: fixedNow }),
    engine.score({ state: 'STUCK', recentExamMisses: 2 }, { now: fixedNow })
  );
});

test('risk signals increase risk without exceeding the bounded score', () => {
  const engine = createRiskEngine({ clock: () => fixedNow.getTime() });

  const base = engine.score({ state: 'FRAGILE', verified: true }, { now: fixedNow });
  const enriched = engine.score({
    state: 'FRAGILE',
    verified: false,
    isBubbleCritical: true,
    hasLearningDebt: true,
    retrievability: 0.45,
    stability: 0.8,
    daysOverdue: 25,
    daysToExam: 4,
    recentExamMisses: 5,
    recentAgainHard: 6,
  }, { now: fixedNow });

  assert.ok(enriched.score > base.score);
  assert.equal(enriched.score, 100);
  assert.equal(enriched.level, RISK_LEVELS.CRITICAL);

  const reasonCodes = new Set(enriched.reasons.map((reason) => reason.code));
  for (const code of [
    'BUBBLE_CRITICAL',
    'LEARNING_DEBT',
    'LOW_RETRIEVABILITY',
    'VERY_LOW_STABILITY',
    'SEVERELY_OVERDUE',
    'EXAM_WITHIN_7_DAYS',
    'RECENT_EXAM_MISSES',
    'RECENT_AGAIN_HARD',
  ]) {
    assert.equal(reasonCodes.has(code), true, `missing risk reason ${code}`);
  }
});

test('planner remains one-card-per-evidence-unit and deterministic in Delivery B', () => {
  const planner = createPlanner();

  const cards = [
    { id: 'danger', front_content: 'Danger Q', back_content: 'Danger A', stage: 2 },
    { id: 'stuck', front_content: 'Stuck Q', back_content: 'Stuck A', stage: 3 },
    { id: 'fragile', front_content: 'Fragile Q', back_content: 'Fragile A', stage: 3 },
    { id: 'stable-a', front_content: 'Stable A Q', back_content: 'Stable A A', stage: 4, verified: true },
    { id: 'stable-b', front_content: 'Stable B Q', back_content: 'Stable B A', stage: 4, verified: true },
    { id: 'stable-c', front_content: 'Stable C Q', back_content: 'Stable C A', stage: 5, verified: true },
    { id: 'stable-d', front_content: 'Stable D Q', back_content: 'Stable D A', stage: 5, verified: true },
  ];

  const states = [
    { card_id: 'danger', state: 'DANGEROUS', verified: false, learning_debt: true },
    { card_id: 'stuck', state: 'STUCK', verified: false },
    { card_id: 'fragile', state: 'FRAGILE', verified: false },
    { card_id: 'stable-a', state: 'STABLE', verified: true },
    { card_id: 'stable-b', state: 'STABLE', verified: true },
    { card_id: 'stable-c', state: 'VERIFIED', verified: true },
    { card_id: 'stable-d', state: 'VERIFIED', verified: true },
  ];

  const args = {
    cards,
    states,
    bubbleCardIds: ['danger'],
    context: { subjectId: 'subject-1', pressureScore: 24, daysToExam: 8 },
    now: fixedNow,
  };

  const first = planner.buildPlan(args);
  const second = planner.buildPlan(args);

  assert.deepEqual(first, second);
  assert.equal(first.mode, 'SHADOW');
  assert.ok(first.critical.length >= 2);
  assert.ok(first.controls.length >= 1);
  assert.ok(first.softQuestionBudget <= 24);
  assert.equal(first.hardQuestionCap, 30);

  const ids = first.evidence.map((item) => item.sourceCardId);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(first.evidence.every((item) => item.conceptKey === `card:${item.sourceCardId}`));
  assert.ok(first.critical.every((item) => item.requiredConfirmations === 1));
});

test('planner fills minimum evidence from supporting cards when pressure has no adverse-state cards', () => {
  const planner = createPlanner();
  const cards = Array.from({ length: 8 }, (_, index) => ({
    id: `card-${index + 1}`,
    front_content: `Q${index + 1}`,
    back_content: `A${index + 1}`,
    stage: 4,
    verified: true,
  }));
  const states = cards.map((card) => ({
    card_id: card.id,
    state: 'STABLE',
    verified: true,
  }));

  const plan = planner.buildPlan({
    cards,
    states,
    context: { subjectId: 'subject-1', pressureScore: 22 },
    now: fixedNow,
  });

  assert.equal(plan.critical.length, 0);
  assert.equal(plan.high.length, 0);
  assert.ok(plan.supporting.length >= 5);
  assert.ok(plan.controls.length >= 1);
});
