'use strict';

const { isValidatedModelResult } = require('../ai/output-validation');
const { assertAuthoritativeOwner } = require('./owners');

function createAuthoritativeCommitGateway({
  ownerServices = {},
  onCommit = null,
} = {}) {
  async function commit({
    owner,
    validatedResult,
    preconditions = {},
    mutationContext = {},
  } = {}) {
    const ownerId = assertAuthoritativeOwner(owner);

    if (!isValidatedModelResult(validatedResult)) {
      const error = new Error(
        'Model output cannot mutate authoritative Teaching state without trusted validation.'
      );
      error.code = 'TEACHING_VALIDATED_MODEL_RESULT_REQUIRED';
      throw error;
    }

    const service = ownerServices[ownerId];
    if (!service || typeof service.commitValidatedModelResult !== 'function') {
      const error = new Error(
        `Authoritative owner ${ownerId} has no registered model-result commit service.`
      );
      error.code = 'TEACHING_AUTHORITATIVE_OWNER_UNAVAILABLE';
      throw error;
    }

    const receipt = await service.commitValidatedModelResult({
      output: validatedResult.output,
      authorityLevel: validatedResult.authorityLevel,
      preconditions: Object.freeze({ ...preconditions }),
      mutationContext: Object.freeze({ ...mutationContext }),
    });

    if (typeof onCommit === 'function') {
      await onCommit({
        owner: ownerId,
        receipt,
        mutationContext,
      });
    }

    return receipt;
  }

  return Object.freeze({ commit });
}

module.exports = {
  createAuthoritativeCommitGateway,
};
