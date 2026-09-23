'use strict';

// Compatibility bridge.
// Canonical morphology now lives in vine-growth-model.js because KIWI's organism
// is a trained woody kiwifruit vine rather than a freestanding tree.
const vine = require('./vine-growth-model');

module.exports = {
  TREE_GROWTH_MODEL_VERSION: vine.VINE_GROWTH_MODEL_VERSION,
  TREE_GROWTH_THRESHOLDS: vine.VINE_GROWTH_THRESHOLDS,
  TREE_VISUAL_MATURITY_ANCHORS: vine.VINE_VISUAL_MATURITY_ANCHORS,
  TREE_STAGE_LABELS: vine.VINE_STAGE_LABELS,
  ANCIENT_GROWTH_POINTS: vine.ANCIENT_GROWTH_POINTS,

  computeGrowthStage: vine.computeGrowthStage,
  computeGrowthPosition: vine.computeGrowthPosition,

  // Legacy names retained until the SVG renderer migration is complete.
  computeStructuralGrowth(overallGrowthProgress, postAncientGrowth) {
    return vine.toLegacyStructuralGrowth(
      vine.computeVineStructure(overallGrowthProgress, postAncientGrowth)
    );
  },

  computeVisualHealth(vitality) {
    return vine.toLegacyVisualHealth(vine.computeVineHealth(vitality));
  },

  computeContinuousTreeGrowth(input) {
    return vine.computeContinuousVineGrowth(input);
  },
};
