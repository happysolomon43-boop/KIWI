'use strict';

let activeBoundary = null;

function setActiveTeachingAIBoundary(boundary) {
  if (!boundary || typeof boundary.execute !== 'function') throw new TypeError('Teaching AI runtime bridge requires an execution boundary.');
  activeBoundary = boundary;
  return boundary;
}

function getActiveTeachingAIBoundary() {
  return activeBoundary;
}

module.exports = { setActiveTeachingAIBoundary, getActiveTeachingAIBoundary };
