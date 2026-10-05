'use strict';

function decorateD10RequestExperience(service) {
  if (!service || typeof service.submitRequest !== 'function' || typeof service.reviewRequest !== 'function') return service;

  async function submitRequest(user, requestId) {
    const submitted = await service.submitRequest(user, requestId);
    if (String(submitted?.state || '').toUpperCase() !== 'REVIEWING') return submitted;
    return service.reviewRequest(user, requestId);
  }

  return Object.freeze({
    ...service,
    submitRequest,
  });
}

module.exports = { decorateD10RequestExperience };
