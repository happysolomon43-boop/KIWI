'use strict';

const { assertIntelligenceClass, assertAuthorityLevel } = require('./contracts');
const { validateModelOutput } = require('./output-validation');
const { authorityFailurePolicy } = require('./failure-policy');
const { safeExecutionMetadata } = require('../d28/ai-controls');

const TRUNCATED_FINISH_REASONS = new Set(['MAX_TOKENS','MAX_OUTPUT_TOKENS','LENGTH']);

class TeachingAIExecutionError extends Error {
  constructor(message, { code = 'TEACHING_AI_EXECUTION_FAILED', disposition = null, cause = null } = {}) {
    super(message);
    this.name = 'TeachingAIExecutionError';
    this.code = code;
    this.disposition = disposition;
    this.cause = cause;
  }
}

function candidateFromCentralResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const text = typeof result.text === 'string' ? result.text.trim() : null;
  if (!text) return result;
  const json = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(json);
  } catch {
    return result;
  }
}

function assertCentralResultComplete(result) {
  const finishReason = String(result?.finishReason || result?.finish_reason || '').trim().toUpperCase();
  if (!TRUNCATED_FINISH_REASONS.has(finishReason)) return result;
  const error = new Error(`Central KIWI AI returned an incomplete Teaching artifact (${finishReason}).`);
  error.code = 'TEACHING_AI_OUTPUT_TRUNCATED';
  error.retryable = false;
  error.finishReason = finishReason;
  error.executionMetadata = safeExecutionMetadata(result);
  throw error;
}

function createCentralAIExecutionBoundary({ aiRun, telemetry = null, executionControls = null } = {}) {
  if (typeof aiRun !== 'function') {
    throw new TypeError('Teaching AI execution requires the central KIWI AI Orchestrator aiRun().');
  }

  async function execute({
    taskId,
    request = {},
    responsibilityKey,
    capabilityId = null,
    intelligenceClass,
    authorityLevel,
    authoritativeOwner = null,
    correlationId = null,
    causationId = null,
    promptTemplateVersion = null,
    promptFamilyId = null,
    promptFamilyVersion = null,
    constitutionVersion = null,
    outputSchemaId = null,
    outputSchemaVersion = null,
    schemaValidator = null,
    domainValidator = null,
    deterministicChecks = [],
    validationContext = {},
    safeCommunicationFallback = null,
    cachePolicy = null,
    centralRouteOptions = {},
  } = {}) {
    const klass = assertIntelligenceClass(intelligenceClass);
    const authority = assertAuthorityLevel(authorityLevel);
    if (authority === 'T0') {
      throw new TeachingAIExecutionError('T0 Teaching responsibility is deterministic and cannot be executed as a model-backed task.', {
        code: 'TEACHING_T0_MODEL_EXECUTION_FORBIDDEN',
        disposition: authorityFailurePolicy('T0').disposition,
      });
    }

    const executionId = telemetry ? await telemetry.beginExecution({
      correlationId, causationId, responsibilityKey, capabilityId, intelligenceClass: klass,
      authorityLevel: authority, centralTaskId: taskId, promptTemplateVersion, promptFamilyId,
      promptFamilyVersion, constitutionVersion, outputSchemaId, outputSchemaVersion, authoritativeOwner,
    }) : null;
    const validate = async (output) => validateModelOutput({
      output: candidateFromCentralResult(output), authorityLevel: authority, schemaValidator,
      domainValidator, deterministicChecks, context: validationContext,
    });
    const runCentral = async (id, payload) => assertCentralResultComplete(await aiRun(id, payload, centralRouteOptions));

    try {
      let centralResult;
      let validated;
      let validationRetryCount = 0;
      let cacheStatus = 'BYPASS';
      if (executionControls?.executeValidated) {
        const controlled = await executionControls.executeValidated({
          taskId, request, capabilityId: capabilityId || responsibilityKey, authorityLevel: authority,
          promptVersion: promptTemplateVersion || (promptFamilyId && promptFamilyVersion ? `${promptFamilyId}@${promptFamilyVersion}` : null),
          schemaVersion: outputSchemaVersion, cachePolicy,
          executeCentral: runCentral, validate,
        });
        centralResult = controlled.centralResult;
        validated = controlled.validated;
        validationRetryCount = controlled.validationRetryCount;
        cacheStatus = controlled.cacheStatus;
      } else {
        centralResult = await runCentral(taskId, request);
        validated = await validate(centralResult);
      }

      const meta = safeExecutionMetadata(centralResult, validationRetryCount, cacheStatus);
      if (telemetry && executionId) await telemetry.finishExecution(executionId, {
        ...meta,
        validationOutcome: validated.accepted ? 'ACCEPTED' : 'REJECTED',
        rejectionReason: validated.accepted ? null : validated.reason,
        outcome: validated.accepted ? 'VALIDATED' : 'REJECTED',
        executionMetadata: { taskId, authorityLevel: authority, intelligenceClass: klass },
      });
      return Object.freeze({
        executionId,
        accepted: validated.accepted,
        validatedResult: validated.accepted ? validated : null,
        rejectionReason: validated.accepted ? null : validated.reason,
        validationStage: validated.accepted ? null : validated.stage,
        validationFailure: validated.accepted ? null : (validated.validationFailure || Object.freeze({
          kind: 'VALIDATION_REJECTION',
          stage: validated.stage || 'unknown',
          reason: validated.reason || 'MODEL_OUTPUT_REJECTED',
          retryable: validated.retryable === true,
          repairable: validated.repairable || 'UNSPECIFIED',
          validatorId: null,
        })),
        modelMetadata: Object.freeze({ ...meta, taskId }),
      });
    } catch (error) {
      const policy = authorityFailurePolicy(authority);
      if (authority === 'T1' && typeof safeCommunicationFallback === 'function') {
        const fallback = await safeCommunicationFallback(error);
        if (telemetry && executionId) await telemetry.finishExecution(executionId, {
          validationOutcome: 'SAFE_FALLBACK', safeFailureCode: error?.code || 'TEACHING_AI_EXECUTION_FAILED', outcome: policy.disposition,
        });
        return Object.freeze({ executionId, accepted: false, validatedResult: null, fallbackUsed: true, fallback, failureDisposition: policy.disposition });
      }
      if (telemetry && executionId) await telemetry.finishExecution(executionId, {
        ...(error.executionMetadata || {}),
        validationOutcome: 'FAILED', safeFailureCode: error?.code || 'TEACHING_AI_EXECUTION_FAILED', outcome: policy.disposition,
      });
      throw new TeachingAIExecutionError(error?.message || 'Teaching AI execution failed safely.', {
        code: error?.code || 'TEACHING_AI_EXECUTION_FAILED', disposition: policy.disposition, cause: error,
      });
    }
  }

  return Object.freeze({ execute });
}

module.exports = { TeachingAIExecutionError, candidateFromCentralResult, assertCentralResultComplete, createCentralAIExecutionBoundary };
