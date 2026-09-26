'use strict';

const { getCapability } = require('../capability-registry');
const { authorityFailurePolicy } = require('../ai/failure-policy');
const { createExecutionEnvelope, ORCHESTRATION_TRIGGER_TYPES } = require('./contracts');
const { revalidateAuthoritativeState } = require('./state-revalidation');

const REPLAY_SAFE_TRIGGER_TYPES = Object.freeze(new Set([
  ORCHESTRATION_TRIGGER_TYPES.SCHEDULED_DUE_EVENT,
  ORCHESTRATION_TRIGGER_TYPES.COMMITTED_DOMAIN_EVENT,
  ORCHESTRATION_TRIGGER_TYPES.BACKGROUND_ANALYSIS,
  ORCHESTRATION_TRIGGER_TYPES.WORKFLOW_CONTINUATION,
]));

function createTeachingOrchestrator({
  promptControl,
  aiAdapter,
  executionStore,
  stateReader,
  contextAssembler,
  preflight,
  ownerRouter,
  deterministicHandlers = {},
  cancellationReader = async () => false,
  randomUUID,
  clock = () => new Date(),
} = {}) {
  if (!promptControl || typeof promptControl.getCapability !== 'function') {
    throw new TypeError('Teaching Orchestrator requires the D03 prompt control plane.');
  }
  if (!aiAdapter || typeof aiAdapter.prepare !== 'function' || typeof aiAdapter.execute !== 'function') {
    throw new TypeError('Teaching Orchestrator requires the D05 Teaching AI adapter.');
  }
  if (!executionStore || typeof executionStore.begin !== 'function' || typeof executionStore.mark !== 'function') {
    throw new TypeError('Teaching Orchestrator requires durable D05 execution storage.');
  }
  if (typeof stateReader !== 'function') throw new TypeError('Teaching Orchestrator requires stateReader().');
  if (!contextAssembler || typeof contextAssembler.assemble !== 'function') {
    throw new TypeError('Teaching Orchestrator requires capability-scoped context assembly.');
  }
  if (!preflight || typeof preflight.run !== 'function') throw new TypeError('Teaching Orchestrator requires deterministic preflight.');
  if (!ownerRouter || typeof ownerRouter.commit !== 'function') throw new TypeError('Teaching Orchestrator requires authoritative owner routing.');
  if (typeof cancellationReader !== 'function') throw new TypeError('Teaching Orchestrator cancellationReader must be a function.');
  if (typeof randomUUID !== 'function') throw new TypeError('Teaching Orchestrator requires randomUUID().');
  if (typeof clock !== 'function') throw new TypeError('Teaching Orchestrator requires clock().');

  async function safeMark(executionId, status, metadata = {}) {
    return executionStore.mark(executionId, status, metadata);
  }

  async function cancelled(envelope, phase) {
    const result = await cancellationReader(envelope, { phase });
    return result === true || (result && result.cancelled === true)
      ? Object.freeze({ cancelled: true, reason: result?.reason == null ? 'ORCHESTRATION_CANCELLED' : String(result.reason) })
      : Object.freeze({ cancelled: false, reason: null });
  }

  async function execute(request = {}) {
    const executionId = String(request.executionId || randomUUID());
    const trigger = request.trigger;
    const triggerType = String(trigger?.type || '').trim();
    if (REPLAY_SAFE_TRIGGER_TYPES.has(triggerType) && !String(request.idempotencyKey || '').trim()) {
      const error = new Error(`${triggerType} orchestration requires an idempotency key.`);
      error.code = 'TEACHING_D05_IDEMPOTENCY_KEY_REQUIRED';
      throw error;
    }

    const correlationId = String(
      request.correlationId || trigger?.event_id || request.idempotencyKey || executionId
    ).trim();
    const envelope = createExecutionEnvelope({
      executionId,
      trigger,
      capabilityId: request.capabilityId,
      declaredAuthorityLevel: request.declaredAuthorityLevel,
      stateReference: request.stateReference,
      preconditions: request.preconditions || {},
      provenanceRefs: request.provenanceRefs || [],
      resultContract: request.resultContract,
      correlationId,
      causationId: request.causationId,
      idempotencyKey: request.idempotencyKey,
      deadlineAt: request.deadlineAt,
      auditMetadata: request.auditMetadata || {},
      serverNow: clock(),
    });

    const started = await executionStore.begin(envelope);
    if (!started.inserted) {
      return Object.freeze({
        executionId: started.execution.execution_id,
        replay: true,
        status: started.execution.status,
        authoritativeMutationPerformed: false,
      });
    }

    const capability = getCapability(envelope.capability.id);
    try {
      const initialSnapshot = await stateReader(envelope, { phase: 'preflight' });
      await preflight.run({
        envelope,
        authoritativeSnapshot: initialSnapshot,
        requestContext: request.preflightContext || {},
      });
      await safeMark(executionId, 'PREFLIGHT_PASSED');

      if (capability.authority_ceiling === 'T0') {
        const handler = deterministicHandlers[capability.id];
        if (typeof handler !== 'function') {
          const error = new Error(`No deterministic handler is registered for ${capability.id}.`);
          error.code = 'TEACHING_D05_T0_HANDLER_MISSING';
          throw error;
        }
        const deterministicResult = await handler({
          envelope,
          input: request.deterministicInput || {},
          authoritativeSnapshot: initialSnapshot,
        });
        await safeMark(executionId, 'COMPLETED', {
          validationOutcome: 'DETERMINISTIC_T0',
          safeMetadata: { deterministic: true },
        });
        return Object.freeze({
          executionId,
          replay: false,
          deterministic: true,
          result: deterministicResult,
          authoritativeMutationPerformed: Boolean(deterministicResult?.authoritativeMutationPerformed),
        });
      }

      const beforeModelCancellation = await cancelled(envelope, 'before_model');
      if (beforeModelCancellation.cancelled) {
        const policy = authorityFailurePolicy(capability.authority_ceiling);
        await safeMark(executionId, 'CANCELLED', { failureCode: beforeModelCancellation.reason });
        return Object.freeze({
          executionId,
          replay: false,
          cancelled: true,
          failureDisposition: policy.disposition,
          authoritativeMutationPerformed: false,
        });
      }

      const contextLanes = await contextAssembler.assemble({
        capability,
        contextSpec: request.contextSpec || {},
        accessContext: request.accessContext || {},
      });
      const invocation = aiAdapter.prepare({
        envelope,
        taskMode: request.taskMode,
        directive: request.directive,
        contextLanes,
        contextAllowlist: request.contextAllowlist || null,
        outputSchema: request.outputSchema,
        capabilityCriticalityOverride: request.capabilityCriticalityOverride || null,
        preparation: request.preparation || null,
      });

      await safeMark(executionId, 'MODEL_PENDING', {
        safeMetadata: {
          prompt_family_id: invocation.prompt.family_id,
          prompt_family_version: invocation.prompt.family_version,
        },
      });

      // No authoritative database transaction is held by this service while the
      // central KIWI AI Orchestrator is running. Only captured/versioned inputs
      // cross this boundary; authoritative state is re-read below.
      const modelResult = await aiAdapter.execute({
        invocation,
        academicInput: request.academicInput || {},
        schemaValidator: request.schemaValidator,
        domainValidator: request.domainValidator,
        provenanceValidator: request.provenanceValidator,
        deterministicChecks: request.deterministicChecks || [],
        validationContext: request.validationContext || {},
        safeCommunicationFallback: request.safeCommunicationFallback || null,
      });

      if (!modelResult.accepted) {
        const policy = authorityFailurePolicy(capability.authority_ceiling);
        await safeMark(executionId, 'NOOP', {
          validationOutcome: modelResult.fallbackUsed ? 'SAFE_FALLBACK' : 'REJECTED',
          failureCode: policy.disposition,
        });
        return Object.freeze({
          executionId,
          replay: false,
          accepted: false,
          fallbackUsed: modelResult.fallbackUsed === true,
          fallback: modelResult.fallback,
          failureDisposition: policy.disposition,
          authoritativeMutationPerformed: false,
        });
      }

      const postModelCancellation = await cancelled(envelope, 'post_model');
      if (postModelCancellation.cancelled) {
        const policy = authorityFailurePolicy(capability.authority_ceiling);
        await safeMark(executionId, 'CANCELLED', {
          validationOutcome: 'VALIDATED_BUT_CANCELLED',
          failureCode: postModelCancellation.reason,
        });
        return Object.freeze({
          executionId,
          replay: false,
          accepted: false,
          cancelled: true,
          failureDisposition: policy.disposition,
          authoritativeMutationPerformed: false,
        });
      }

      const currentSnapshot = await stateReader(envelope, { phase: 'post_model' });
      const freshness = revalidateAuthoritativeState({
        expectedState: envelope.state_reference,
        currentState: currentSnapshot?.stateReference,
        expectedPreconditions: envelope.preconditions,
        currentPreconditions: currentSnapshot?.preconditions || {},
      });
      if (freshness.stale) {
        await safeMark(executionId, 'STALE_REJECTED', {
          validationOutcome: 'STALE_REJECTED',
          staleReasons: freshness.reasons,
        });
        return Object.freeze({
          executionId,
          replay: false,
          accepted: false,
          stale: true,
          staleReasons: freshness.reasons,
          authoritativeMutationPerformed: false,
        });
      }

      if (request.commit !== true) {
        await safeMark(executionId, 'COMPLETED', { validationOutcome: 'VALIDATED_PROVISIONAL' });
        return Object.freeze({
          executionId,
          replay: false,
          accepted: true,
          provisional: true,
          validatedResult: modelResult.validatedResult,
          authoritativeMutationPerformed: false,
        });
      }

      await safeMark(executionId, 'COMMIT_PENDING', { validationOutcome: 'VALIDATED' });
      const receipt = await ownerRouter.commit({
        ownerBoundary: capability.authoritative_owner_boundary,
        validatedResult: modelResult.validatedResult,
        preconditions: {
          stateReference: envelope.state_reference,
          ...envelope.preconditions,
        },
        mutationContext: {
          executionId,
          correlationId: envelope.correlation_id,
          causationId: envelope.causation_id,
          capabilityId: capability.id,
          triggerRef: envelope.trigger.ref,
        },
      });
      await safeMark(executionId, 'COMPLETED', {
        validationOutcome: 'VALIDATED_AND_HANDED_OFF',
        mutationRef: receipt?.mutationRef || receipt?.id || null,
      });
      return Object.freeze({
        executionId,
        replay: false,
        accepted: true,
        authoritativeMutationPerformed: true,
        ownerReceipt: receipt,
      });
    } catch (error) {
      await safeMark(executionId, 'FAILED', {
        failureCode: error?.code || 'TEACHING_D05_ORCHESTRATION_FAILED',
        safeMetadata: { message: String(error?.message || 'Teaching orchestration failed safely.').slice(0,500) },
      }).catch(() => {});
      throw error;
    }
  }

  return Object.freeze({ execute });
}

module.exports = { createTeachingOrchestrator, REPLAY_SAFE_TRIGGER_TYPES };
