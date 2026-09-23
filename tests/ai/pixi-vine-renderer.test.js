'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '../..');
const blueprint = require('../../public/tree/vine-blueprint.json');
const serverBlueprint = require('../../services/vine-visual-blueprint');
const { buildTreeState } = require('../../services/tree-state');

async function importModule(relativePath) {
  return import(
    pathToFileURL(path.join(ROOT, relativePath)).href +
      '?test=' +
      Date.now() +
      Math.random()
  );
}

test('browser blueprint is the same canonical data consumed by the backend', () => {
  assert.equal(serverBlueprint.VINE_BLUEPRINT_VERSION, blueprint.version);
  assert.deepEqual(serverBlueprint.TRELLIS, blueprint.trellis);
  assert.deepEqual(serverBlueprint.VINE_SEGMENTS, blueprint.vineSegments);
  assert.deepEqual(serverBlueprint.FOLIAGE_ZONES, blueprint.foliageZones);
  assert.deepEqual(
    serverBlueprint.REPRODUCTIVE_ZONES,
    blueprint.reproductiveZones
  );
  assert.deepEqual(
    serverBlueprint.COMPOSITION_PROFILES,
    blueprint.compositionProfiles
  );
});

test('partial cubic growth ends exactly on the full curve at the same t', async () => {
  const {
    cubicPoint,
    partialCubic,
    segmentGrowthProgress,
  } = await importModule('public/tree/vine-geometry.mjs');

  const segment = blueprint.vineSegments.find((item) => item.id === 'cordon-right');
  const t = 0.4375;
  const fullPoint = cubicPoint(segment, t);
  const partial = partialCubic(segment, t);

  assert.ok(Math.abs(fullPoint.x - partial.to.x) < 1e-12);
  assert.ok(Math.abs(fullPoint.y - partial.to.y) < 1e-12);
  assert.equal(segmentGrowthProgress(segment, segment.unlockAt), 0);
  assert.equal(segmentGrowthProgress(segment, segment.completeAt), 1);
});

test('permanent structure grows monotonically and Vitality cannot de-age it', async () => {
  const { buildStructurePlan } = await importModule(
    'public/tree/vine-structure-plan.mjs'
  );

  const young = buildTreeState({
    growthPoints: 320,
    stage: 4,
    vitality: 95,
  });
  const mature = buildTreeState({
    growthPoints: 1800,
    stage: 6,
    vitality: 95,
  });

  const youngPlan = buildStructurePlan(blueprint, young, 'desktop');
  const maturePlan = buildStructurePlan(blueprint, mature, 'desktop');

  assert.ok(maturePlan.segments.length >= youngPlan.segments.length);

  const youngById = new Map(youngPlan.segments.map((segment) => [segment.id, segment]));
  const matureById = new Map(maturePlan.segments.map((segment) => [segment.id, segment]));

  for (const [id, segment] of youngById) {
    assert.ok(matureById.has(id), id + ' disappeared with maturity');
    assert.ok(
      matureById.get(id).progress >= segment.progress,
      id + ' regressed in reach'
    );
    assert.ok(
      matureById.get(id).width >= segment.width,
      id + ' regressed in thickness'
    );
  }

  const healthy = buildTreeState({
    growthPoints: 1800,
    stage: 6,
    vitality: 95,
  });
  const critical = buildTreeState({
    growthPoints: 1800,
    stage: 6,
    vitality: 10,
  });
  const healthyPlan = buildStructurePlan(blueprint, healthy, 'desktop');
  const criticalPlan = buildStructurePlan(blueprint, critical, 'desktop');

  const permanentProjection = (plan) =>
    plan.segments.map((segment) => ({
      id: segment.id,
      progress: segment.progress,
      curve: segment.curve,
      width: segment.width,
      color: segment.color,
    }));

  assert.deepEqual(
    permanentProjection(healthyPlan),
    permanentProjection(criticalPlan)
  );
});

test('foliage nodes stay deterministic while Vitality changes density and posture', async () => {
  const { buildStructurePlan } = await importModule(
    'public/tree/vine-structure-plan.mjs'
  );
  const { buildFoliagePlan } = await importModule(
    'public/tree/vine-foliage-plan.mjs'
  );

  const healthy = buildTreeState({
    growthPoints: 2200,
    stage: 7,
    vitality: 95,
  });
  const stressed = buildTreeState({
    growthPoints: 2200,
    stage: 7,
    vitality: 20,
  });

  const healthyStructure = buildStructurePlan(blueprint, healthy, 'desktop');
  const stressedStructure = buildStructurePlan(blueprint, stressed, 'desktop');
  const healthyLeaves = buildFoliagePlan(
    blueprint,
    healthy,
    healthyStructure,
    'desktop'
  );
  const stressedLeaves = buildFoliagePlan(
    blueprint,
    stressed,
    stressedStructure,
    'desktop'
  );

  assert.ok(healthyLeaves.leaves.length > stressedLeaves.leaves.length);

  const healthyById = new Map(healthyLeaves.leaves.map((leaf) => [leaf.id, leaf]));
  for (const leaf of stressedLeaves.leaves) {
    const healthyLeaf = healthyById.get(leaf.id);
    assert.ok(healthyLeaf, leaf.id + ' was reshuffled instead of retained');
    assert.deepEqual(healthyLeaf.attach, leaf.attach);
    assert.ok(
      leaf.rotation !== healthyLeaf.rotation ||
        stressed.vineHealth.leafDroop === healthy.vineHealth.leafDroop
    );
  }
});

test('mobile foliage is intentionally lighter than desktop for the same organism', async () => {
  const { buildStructurePlan } = await importModule(
    'public/tree/vine-structure-plan.mjs'
  );
  const { buildFoliagePlan } = await importModule(
    'public/tree/vine-foliage-plan.mjs'
  );

  const state = buildTreeState({
    growthPoints: 3000,
    stage: 8,
    vitality: 100,
  });

  const desktopStructure = buildStructurePlan(blueprint, state, 'desktop');
  const mobileStructure = buildStructurePlan(blueprint, state, 'mobile');
  const desktop = buildFoliagePlan(
    blueprint,
    state,
    desktopStructure,
    'desktop'
  );
  const mobile = buildFoliagePlan(
    blueprint,
    state,
    mobileStructure,
    'mobile'
  );

  assert.ok(desktop.leaves.length > mobile.leaves.length);
  assert.equal(
    mobileStructure.progressById['lateral-l4'],
    0
  );
  assert.equal(
    mobileStructure.progressById['lateral-r4'],
    0
  );
});

test('flowers depend on health but earned fruit survives low Vitality', async () => {
  const { buildStructurePlan } = await importModule(
    'public/tree/vine-structure-plan.mjs'
  );
  const { buildReproductivePlan } = await importModule(
    'public/tree/vine-reproductive-plan.mjs'
  );

  const healthy = buildTreeState({
    growthPoints: 3200,
    stage: 8,
    vitality: 98,
    fruits: 12,
  });
  const stressed = buildTreeState({
    growthPoints: 3200,
    stage: 8,
    vitality: 15,
    fruits: 12,
  });

  const healthyStructure = buildStructurePlan(blueprint, healthy, 'desktop');
  const stressedStructure = buildStructurePlan(blueprint, stressed, 'desktop');

  const healthyRepro = buildReproductivePlan(
    blueprint,
    healthy,
    healthyStructure,
    'desktop'
  );
  const stressedRepro = buildReproductivePlan(
    blueprint,
    stressed,
    stressedStructure,
    'desktop'
  );

  assert.ok(healthyRepro.flowers.length > stressedRepro.flowers.length);
  assert.deepEqual(
    healthyRepro.fruits.map((fruit) => fruit.id),
    stressedRepro.fruits.map((fruit) => fruit.id)
  );
});

test('fruit visualization obeys profile caps and compresses large totals', async () => {
  const { buildStructurePlan } = await importModule(
    'public/tree/vine-structure-plan.mjs'
  );
  const { buildReproductivePlan } = await importModule(
    'public/tree/vine-reproductive-plan.mjs'
  );

  const state = buildTreeState({
    growthPoints: 9000,
    stage: 8,
    vitality: 100,
    fruits: 100,
  });

  for (const [profile, cap] of [
    ['desktop', 12],
    ['tablet', 9],
    ['mobile', 6],
  ]) {
    const structure = buildStructurePlan(blueprint, state, profile);
    const repro = buildReproductivePlan(
      blueprint,
      state,
      structure,
      profile
    );

    assert.ok(repro.fruits.length <= cap, profile);
    assert.ok(repro.requestedClusters <= cap, profile);
    if (repro.fruits.length > 0) {
      assert.ok(repro.fruits.every((fruit) => fruit.clusterSize >= 2));
    }
  }
});

test('young vines cannot flower or fruit before reproductive maturity', async () => {
  const { buildStructurePlan } = await importModule(
    'public/tree/vine-structure-plan.mjs'
  );
  const { buildReproductivePlan } = await importModule(
    'public/tree/vine-reproductive-plan.mjs'
  );

  const state = buildTreeState({
    growthPoints: 120,
    stage: 3,
    vitality: 100,
    fruits: 50,
  });
  const structure = buildStructurePlan(blueprint, state, 'desktop');
  const repro = buildReproductivePlan(
    blueprint,
    state,
    structure,
    'desktop'
  );

  assert.deepEqual(repro.flowers, []);
  assert.deepEqual(repro.fruits, []);
});

test('Dashboard and Biome mount the canonical TreeState through the living-vine gateway', () => {
  const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  assert.match(source, /async function mountKiwiLivingTree/);
  assert.match(source, /import\('\/tree\/tree-renderer-gateway\.mjs'\)/);
  assert.match(source, /mountKiwiLivingTree\(treeContainer, \{/);
  assert.match(source, /state: ts,/);
  assert.match(source, /state: globalTreeState,/);
  assert.match(source, /AppState\.treeInstance = handle/);
  assert.match(source, /AppState\.biomeTreeInstance = handle/);
});

test('renderer source uses persistent scene pools and does not implement website spillover', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'public/tree/kiwi-vine-renderer.mjs'),
    'utf8'
  );

  assert.match(source, /_segmentGraphics = new Map\(\)/);
  assert.match(source, /_leafNodes = new Map\(\)/);
  assert.match(source, /_flowerNodes = new Map\(\)/);
  assert.match(source, /_fruitNodes = new Map\(\)/);
  assert.match(source, /buildStructurePlan/);
  assert.match(source, /buildFoliagePlan/);
  assert.match(source, /buildReproductivePlan/);

  // Phase 11 is intentionally not part of this delivery.
  assert.doesNotMatch(source, /vine-expansion-map/);
  assert.doesNotMatch(source, /GLOBAL_SUSPEND_SELECTORS/);
  assert.doesNotMatch(source, /dashboard-right-rail/);
});
