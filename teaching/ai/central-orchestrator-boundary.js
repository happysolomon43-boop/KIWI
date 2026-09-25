'use strict';

const {
  assertIntelligenceClass,
  assertAuthorityLevel,
} = require('./contracts');
const { validateModelOutput } = require('./output-validation');
const { authorityFailurePolicy } = require('./failure-policy');

class TeachingAIExecutionError extends Error {
  constructor(message, {
    code = 'TEACHING_AI_EXECUTION_FAILED',
    disposition = null,
    cause = null,
  } = {}) {
    super(message);
    this.name = 'TeachingAIExecutionError';
    this.code = code;
    this.disposition = disposition;
    this.cause = cause;
  }
}

function createCentralAIExecutionBoundary({
  aiRun,
  telemetry = null,
} = {}) {
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
  } = {}) {
    const klass = assertIntelligenceClass(intelligenceClass);
    const authority = assertAuthorityLevel(authorityLevel);

    if (authority === 'T0') {
      throw new TeachingAIExecutionError(
        'T0 Teaching responsibility is deterministic and cannot be executed as a model-backed task.',
        {
          code: 'TEACHING_T0_MODEL_EXECUTION_FORBIDDEN',
          disposition: authorityFailurePolicy('T0').disposition,
        }
      );
    }

    const executionId = telemetry
      ? await telemetry.beginExecution({
          correlationId,
          causationId,
          responsibilityKey,
          capabilityId,
          intelligenceClass: klass,
          authorityLevel: authority,
          centralTaskId: taskId,
          promptTemplateVersion,
          promptFamilyId,
          promptFamilyVersion,
          constitutionVersion,
          outputSchemaId,
          outputSchemaVersion,
          authoritativeOwner,
        })
      : null;

    try {
      const centralResult = await aiRun(taskId, request, {});

      const validated = await validateModelOutput({
        output: centralResult,
        authorityLevel: authority,
        schemaValidator,
        domainValidator,
        deterministicChecks,
        context: validationContext,
      });

      if (telemetry && executionId) {
        await telemetry.finishExecution(executionId, {
          modelIdentifier: centralResult?.modelId || centralResult?.model || null,
          validationOutcome: validated.accepted ? 'ACCEPTED' : 'REJECTED',
          rejectionReason: validated.accepted ? null : validated.reason,
          outcome: validated.accepted ? 'VALIDATED' : 'REJECTED',
        });
      }

      return Object.freeze({
        executionId,
        accepted: validated.accepted,
        validatedResult: validated.accepted ? validated : null,
        rejectionReason: validated.accepted ? null : validated.reason,
        validationStage: validated.accepted ? null : validated.stage,
        modelMetadata: Object.freeze({
          modelIdentifier: centralResult?.modelId || centralResult?.model || null,
          taskId,
          attempts: centralResult?.attempts ?? null,
        }),
      });
    } catch (error) {
      const policy = authorityFailurePolicy(authority);

      if (authority === 'T1' && typeof safeCommunicationFallback === 'function') {
        const fallback = await safeCommunicationFallback(error);
        if (telemetry && executionId) {
          await telemetry.finishExecution(executionId, {
            validationOutcome: 'SAFE_FALLBACK',
            safeFailureCode: error?.code || 'TEACHING_AI_EXECUTION_FAILED',
            outcome: policy.disposition,
          });
        }
        return Object.freeze({
          executionId,
          accepted: false,
          validatedResult: null,
          fallbackUsed: true,
          fallback,
          failureDisposition: policy.disposition,
        });
      }

      if (telemetry && executionId) {
        await telemetry.finishExecution(executionId, {
          validationOutcome: 'FAILED',
          safeFailureCode: error?.code || 'TEACHING_AI_EXECUTION_FAILED',
          outcome: policy.disposition,
        });
      }

      throw new TeachingAIExecutionError(
        error?.message || 'Teaching AI execution failed safely.',
        {
          code: error?.code || 'TEACHING_AI_EXECUTION_FAILED',
          disposition: policy.disposition,
          cause: error,
        }
      );
    }
  }

  return Object.freeze({ execute });
}

module.exports = {
  TeachingAIExecutionError,
  createCentralAIExecutionBoundary,
};
