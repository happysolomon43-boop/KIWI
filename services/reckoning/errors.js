'use strict';

class ReckoningEngineError extends Error {
  constructor(message, { code = 'ERR_RECKONING_ENGINE', cause } = {}) {
    super(message);
    this.name = 'ReckoningEngineError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

class ReckoningEngineNotImplementedError extends ReckoningEngineError {
  constructor(operation) {
    super(`Reckoning V2 operation "${operation}" is not implemented in Phase 1.`, {
      code: 'ERR_RECKONING_V2_NOT_IMPLEMENTED',
    });
    this.name = 'ReckoningEngineNotImplementedError';
    this.operation = operation;
  }
}

class ReckoningContractError extends ReckoningEngineError {
  constructor(message) {
    super(message, { code: 'ERR_RECKONING_CONTRACT' });
    this.name = 'ReckoningContractError';
  }
}

function notImplemented(operation) {
  throw new ReckoningEngineNotImplementedError(operation);
}

module.exports = {
  ReckoningEngineError,
  ReckoningEngineNotImplementedError,
  ReckoningContractError,
  notImplemented,
};
