'use strict';

const { assertAuthorityLevel, authorityAtLeast } = require('./contracts');

const VALIDATED_MODEL_RESULT = Symbol('KIWI_TEACHING_VALIDATED_MODEL_RESULT');
const VALIDATION_REPAIRABILITY = Object.freeze(new Set(['NONE','MODEL_RETRY','TARGETED_REPAIR','STATE_REFRESH','UNSPECIFIED']));

function safeValidationFieldPath(value){return typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_.]{0,63}$/.test(value)?value:null;}

function normalizeRepairability(value, fallback = 'UNSPECIFIED') {
  const normalized = String(value || fallback).trim().toUpperCase();
  return VALIDATION_REPAIRABILITY.has(normalized) ? normalized : fallback;
}

function normalizedValidatorResult(result, fallbackReason, {
  retryable = false,
  repairable = 'UNSPECIFIED',
  validatorId = null,
} = {}) {
  if (result === true) return { ok: true };
  if (result === false || result == null) {
    return {
      ok: false,
      reason: fallbackReason,
      retryable: retryable === true,
      repairable: normalizeRepairability(repairable),
      validatorId,fieldPath:null,
    };
  }
  if (typeof result !== 'object' || Array.isArray(result)) {
    throw new TypeError('Model-output validators must return boolean or an object.');
  }
  return {
    ok: result.ok === true,
    value: Object.prototype.hasOwnProperty.call(result, 'value') ? result.value : undefined,
    reason: result.reason == null ? fallbackReason : String(result.reason),
    retryable: result.retryable == null ? retryable === true : result.retryable === true,
    repairable: normalizeRepairability(result.repairable, repairable),
    validatorId: result.validatorId == null ? validatorId : String(result.validatorId),
    fieldPath:safeValidationFieldPath(result.fieldPath),
  };
}

function rejected(reason, stage, {
  retryable = false,
  repairable = 'UNSPECIFIED',
  validatorId = null,
  fieldPath = null,
} = {}) {
  const validationFailure = Object.freeze({
    kind: 'VALIDATION_REJECTION',
    stage: String(stage),
    reason: String(reason),
    retryable: retryable === true,
    repairable: normalizeRepairability(repairable),
    validatorId: validatorId == null ? null : String(validatorId),
    fieldPath:safeValidationFieldPath(fieldPath),
  });
  return Object.freeze({
    accepted: false,
    stage: validationFailure.stage,
    reason: validationFailure.reason,
    retryable: validationFailure.retryable,
    repairable: validationFailure.repairable,
    validationFailure,
    authoritative: false,
  });
}

async function validateModelOutput({
  output,
  authorityLevel,
  schemaValidator = null,
  domainValidator = null,
  deterministicChecks = [],
  context = {},
} = {}) {
  const authority = assertAuthorityLevel(authorityLevel);

  if (authority === 'T0') {
    return rejected('T0_MODEL_OUTPUT_CANNOT_REPLACE_DETERMINISTIC_AUTHORITY', 'authority', {
      retryable: false,
      repairable: 'NONE',
      validatorId: 'authority',
    });
  }

  if (authorityAtLeast(authority, 'T2') && typeof schemaValidator !== 'function') {
    return rejected('SCHEMA_VALIDATOR_REQUIRED_FOR_T2_TO_T4', 'schema', {
      retryable: false,
      repairable: 'NONE',
      validatorId: 'schema',
    });
  }
  if (authorityAtLeast(authority, 'T2') && typeof domainValidator !== 'function') {
    return rejected('DOMAIN_VALIDATOR_REQUIRED_FOR_T2_TO_T4', 'domain', {
      retryable: false,
      repairable: 'NONE',
      validatorId: 'domain',
    });
  }

  let candidate = output;

  if (typeof schemaValidator === 'function') {
    // A malformed model artifact can legitimately improve on one bounded model
    // retry. The retry remains local to the model call; outer workflows must not
    // reinterpret the eventual deterministic rejection as a transient outage.
    const schema = normalizedValidatorResult(
      await schemaValidator(candidate, context),
      'MODEL_OUTPUT_SCHEMA_INVALID',
      { retryable: true, repairable: 'MODEL_RETRY', validatorId: 'schema' }
    );
    if (!schema.ok) return rejected(schema.reason, 'schema', schema);
    if (Object.prototype.hasOwnProperty.call(schema, 'value') && schema.value !== undefined) {
      candidate = schema.value;
    }
  }

  if (typeof domainValidator === 'function') {
    const domain = normalizedValidatorResult(
      await domainValidator(candidate, context),
      'MODEL_OUTPUT_DOMAIN_INVALID',
      { retryable: false, repairable: 'TARGETED_REPAIR', validatorId: 'domain' }
    );
    if (!domain.ok) return rejected(domain.reason, 'domain', domain);
    if (Object.prototype.hasOwnProperty.call(domain, 'value') && domain.value !== undefined) {
      candidate = domain.value;
    }
  }

  if (!Array.isArray(deterministicChecks)) {
    throw new TypeError('deterministicChecks must be an array.');
  }

  for (const check of deterministicChecks) {
    if (!check || typeof check.evaluate !== 'function') {
      throw new TypeError('Each deterministic authority check must expose evaluate().');
    }
    const checkId = String(check.id || 'unknown');
    const result = normalizedValidatorResult(
      await check.evaluate(candidate, context),
      `DETERMINISTIC_AUTHORITY_CONFLICT:${checkId}`,
      { retryable: false, repairable: 'TARGETED_REPAIR', validatorId: checkId }
    );
    if (!result.ok) return rejected(result.reason, 'deterministic_authority', result);
  }

  const validated = {
    accepted: true,
    authorityLevel: authority,
    output: candidate,
    authoritative: false,
    validation: Object.freeze({
      schemaValidated: typeof schemaValidator === 'function',
      domainValidated: typeof domainValidator === 'function',
      deterministicChecks: deterministicChecks.length,
    }),
  };

  Object.defineProperty(validated, VALIDATED_MODEL_RESULT, {
    value: true,
    enumerable: false,
    writable: false,
  });

  return Object.freeze(validated);
}

function isValidatedModelResult(value) {
  return Boolean(value && value.accepted === true && value[VALIDATED_MODEL_RESULT] === true);
}

module.exports = {
  validateModelOutput,
  isValidatedModelResult,
  normalizedValidatorResult,
};
