'use strict';

const { assertAuthorityLevel, authorityAtLeast } = require('./contracts');

const VALIDATED_MODEL_RESULT = Symbol('KIWI_TEACHING_VALIDATED_MODEL_RESULT');

function normalizedValidatorResult(result, fallbackReason) {
  if (result === true) return { ok: true };
  if (result === false || result == null) return { ok: false, reason: fallbackReason };
  if (typeof result !== 'object' || Array.isArray(result)) {
    throw new TypeError('Model-output validators must return boolean or an object.');
  }
  return {
    ok: result.ok === true,
    value: Object.prototype.hasOwnProperty.call(result, 'value') ? result.value : undefined,
    reason: result.reason == null ? fallbackReason : String(result.reason),
  };
}

function rejected(reason, stage) {
  return Object.freeze({
    accepted: false,
    stage,
    reason,
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
    return rejected('T0_MODEL_OUTPUT_CANNOT_REPLACE_DETERMINISTIC_AUTHORITY', 'authority');
  }

  if (authorityAtLeast(authority, 'T2') && typeof schemaValidator !== 'function') {
    return rejected('SCHEMA_VALIDATOR_REQUIRED_FOR_T2_TO_T4', 'schema');
  }
  if (authorityAtLeast(authority, 'T2') && typeof domainValidator !== 'function') {
    return rejected('DOMAIN_VALIDATOR_REQUIRED_FOR_T2_TO_T4', 'domain');
  }

  let candidate = output;

  if (typeof schemaValidator === 'function') {
    const schema = normalizedValidatorResult(
      await schemaValidator(candidate, context),
      'MODEL_OUTPUT_SCHEMA_INVALID'
    );
    if (!schema.ok) return rejected(schema.reason, 'schema');
    if (Object.prototype.hasOwnProperty.call(schema, 'value') && schema.value !== undefined) {
      candidate = schema.value;
    }
  }

  if (typeof domainValidator === 'function') {
    const domain = normalizedValidatorResult(
      await domainValidator(candidate, context),
      'MODEL_OUTPUT_DOMAIN_INVALID'
    );
    if (!domain.ok) return rejected(domain.reason, 'domain');
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
    const result = normalizedValidatorResult(
      await check.evaluate(candidate, context),
      `DETERMINISTIC_AUTHORITY_CONFLICT:${check.id || 'unknown'}`
    );
    if (!result.ok) return rejected(result.reason, 'deterministic_authority');
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
};
