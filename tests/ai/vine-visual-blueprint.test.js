'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  VINE_BLUEPRINT_VERSION,
  DEPTH_LAYERS,
  TRELLIS,
  VINE_SEGMENTS,
  FOLIAGE_ZONES,
  REPRODUCTIVE_ZONES,
  LOCAL_EXIT_SOCKETS,
  COMPOSITION_PROFILES,
} = require('../../services/vine-visual-blueprint');

function assertPoint(point, label) {
  assert.ok(point.x >= 0 && point.x <= 1, `${label}.x out of bounds`);
  assert.ok(point.y >= 0 && point.y <= 1, `${label}.y out of bounds`);
}

test('visual blueprint has a stable version and ordered depth layers', () => {
  assert.equal(VINE_BLUEPRINT_VERSION, 1);

  const values = Object.values(DEPTH_LAYERS);
  for (let i = 1; i < values.length; i += 1) {
    assert.ok(values[i] > values[i - 1]);
  }
});

test('trellis geometry stays inside the normalized local scene', () => {
  assert.ok(TRELLIS.bounds.x >= 0);
  assert.ok(TRELLIS.bounds.y >= 0);
  assert.ok(TRELLIS.bounds.x + TRELLIS.bounds.width <= 1);
  assert.ok(TRELLIS.bounds.y + TRELLIS.bounds.height <= 1);

  const ids = new Set();
  for (const member of TRELLIS.members) {
    assert.equal(ids.has(member.id), false, `duplicate trellis id ${member.id}`);
    ids.add(member.id);
    assertPoint(member.from, member.id + '.from');
    assertPoint(member.to, member.id + '.to');
    assert.ok(member.thickness > 0 && member.thickness < 0.1);
  }
});

test('vine skeleton has unique deterministic parent-before-child topology', () => {
  const seen = new Set();

  for (const segment of VINE_SEGMENTS) {
    assert.equal(seen.has(segment.id), false, `duplicate segment ${segment.id}`);

    if (segment.parentId !== null) {
      assert.equal(
        seen.has(segment.parentId),
        true,
        `parent ${segment.parentId} must be declared before ${segment.id}`
      );
    }

    assert.ok(segment.unlockAt >= 0 && segment.unlockAt <= 1);
    assert.ok(segment.completeAt >= 0 && segment.completeAt <= 1);
    assert.ok(segment.completeAt > segment.unlockAt);

    assertPoint(segment.from, segment.id + '.from');
    assertPoint(segment.c1, segment.id + '.c1');
    assertPoint(segment.c2, segment.id + '.c2');
    assertPoint(segment.to, segment.id + '.to');

    seen.add(segment.id);
  }

  assert.equal(seen.has('leader-main'), true);
  assert.equal(seen.has('cordon-left'), true);
  assert.equal(seen.has('cordon-right'), true);
});

test('the main leader establishes before cordons and laterals', () => {
  const byId = Object.fromEntries(VINE_SEGMENTS.map((segment) => [segment.id, segment]));

  assert.ok(byId['leader-main'].unlockAt < byId['cordon-left'].unlockAt);
  assert.ok(byId['leader-main'].unlockAt < byId['cordon-right'].unlockAt);

  const laterals = VINE_SEGMENTS.filter((segment) => segment.kind === 'lateral');
  for (const lateral of laterals) {
    assert.ok(lateral.unlockAt > byId['cordon-left'].unlockAt);
  }
});

test('foliage zones reference real vine segments and remain in bounds', () => {
  const segmentIds = new Set(VINE_SEGMENTS.map((segment) => segment.id));

  for (const zone of FOLIAGE_ZONES) {
    for (const segmentId of zone.segments) {
      assert.equal(segmentIds.has(segmentId), true, `unknown segment ${segmentId}`);
    }

    assert.ok(zone.bounds.x >= 0);
    assert.ok(zone.bounds.y >= 0);
    assert.ok(zone.bounds.x + zone.bounds.width <= 1);
    assert.ok(zone.bounds.y + zone.bounds.height <= 1);
    assert.ok(zone.densityWeight > 0 && zone.densityWeight <= 1);
  }
});

test('reproductive zones attach to real segments and flower before fruit', () => {
  const segmentIds = new Set(VINE_SEGMENTS.map((segment) => segment.id));

  for (const zone of REPRODUCTIVE_ZONES) {
    assert.equal(segmentIds.has(zone.segmentId), true, `unknown segment ${zone.segmentId}`);
    assert.ok(zone.tRange[0] >= 0);
    assert.ok(zone.tRange[1] <= 1);
    assert.ok(zone.tRange[0] < zone.tRange[1]);
    assert.ok(zone.flowerUnlockAt < zone.fruitUnlockAt);
    assert.ok(zone.maxVisibleClusters > 0);
  }
});

test('local exit sockets are high-maturity reservations only', () => {
  const segmentIds = new Set(VINE_SEGMENTS.map((segment) => segment.id));

  for (const socket of LOCAL_EXIT_SOCKETS) {
    assert.equal(segmentIds.has(socket.sourceSegmentId), true);
    assertPoint(socket.point, socket.id + '.point');
    assert.ok(socket.minimumMaturity >= 0.70);
  }
});

test('mobile profile preserves identity while reducing visual density', () => {
  const { desktop, tablet, mobile } = COMPOSITION_PROFILES;

  assert.equal(desktop.allowExitSockets, true);
  assert.equal(tablet.allowExitSockets, true);
  assert.equal(mobile.allowExitSockets, false);

  assert.ok(
    mobile.maxVisibleFruitClusters < tablet.maxVisibleFruitClusters
  );
  assert.ok(
    tablet.maxVisibleFruitClusters < desktop.maxVisibleFruitClusters
  );

  assert.ok(mobile.maxFoliageScale < tablet.maxFoliageScale);
  assert.ok(tablet.maxFoliageScale < desktop.maxFoliageScale);

  assert.ok(mobile.suppressSegments.includes('lateral-l4'));
  assert.ok(mobile.suppressSegments.includes('lateral-r4'));

  assert.ok(mobile.visibleSegmentKinds.includes('leader'));
  assert.ok(mobile.visibleSegmentKinds.includes('cordon'));
});
