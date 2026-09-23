'use strict';

const blueprint = require('../public/tree/vine-blueprint.json');

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

deepFreeze(blueprint);

module.exports = {
  VINE_BLUEPRINT_VERSION: blueprint.version,
  DEPTH_LAYERS: blueprint.depthLayers,
  TRELLIS: blueprint.trellis,
  VINE_SEGMENTS: blueprint.vineSegments,
  FOLIAGE_ZONES: blueprint.foliageZones,
  REPRODUCTIVE_ZONES: blueprint.reproductiveZones,
  LOCAL_EXIT_SOCKETS: blueprint.localExitSockets,
  COMPOSITION_PROFILES: blueprint.compositionProfiles,
  ART_DIRECTION: blueprint.artDirection,
};
