'use strict';

function createModuleDescriptor(id, options = {}) {
  if (!id || typeof id !== 'string') {
    throw new TypeError('Teaching module descriptor requires a stable id.');
  }

  return Object.freeze({
    id,
    authority: options.authority || 'none-d01-foundation',
    status: options.status || 'foundation-only',
  });
}

module.exports = { createModuleDescriptor };
