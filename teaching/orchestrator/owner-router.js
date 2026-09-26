'use strict';

const { isValidatedModelResult } = require('../ai/output-validation');

function createAuthoritativeOwnerRouter({ ownerServices = {} } = {}) {
  async function commit({ ownerBoundary, validatedResult, preconditions = {}, mutationContext = {} } = {}) {
    const owner = String(ownerBoundary || '').trim();
    if (!owner) throw new TypeError('Teaching owner router requires ownerBoundary.');
    if (!isValidatedModelResult(validatedResult)) {
      const error = new Error('Only a branded validated model result may reach an authoritative owner service.');
      error.code = 'TEACHING_VALIDATED_MODEL_RESULT_REQUIRED';
      throw error;
    }
    const service = ownerServices[owner];
    if (!service || typeof service.commitValidatedModelResult !== 'function') {
      const error = new Error(`No authoritative owner service is registered for ${owner}.`);
      error.code = 'TEACHING_AUTHORITATIVE_OWNER_UNAVAILABLE';
      throw error;
    }
    return service.commitValidatedModelResult({
      output: validatedResult.output,
      authorityLevel: validatedResult.authorityLevel,
      preconditions: Object.freeze({ ...preconditions }),
      mutationContext: Object.freeze({ ...mutationContext }),
    });
  }
  return Object.freeze({ commit });
}

module.exports = { createAuthoritativeOwnerRouter };
