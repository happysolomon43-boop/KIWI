'use strict';

const { authorityAtLeast } = require('../ai/contracts');

function createTeachingAIAdapter({
  promptControl,
  aiBoundary,
  resolveCentralTaskId = null,
  assertRouteExecutable = null,
} = {}) {
  if (!promptControl || typeof promptControl.createInvocation !== 'function') {
    throw new TypeError('Teaching AI adapter requires the D03 prompt control plane.');
  }
  if (!aiBoundary || typeof aiBoundary.execute !== 'function') {
    throw new TypeError('Teaching AI adapter requires the D02 central AI execution boundary.');
  }

  const routeGuard = assertRouteExecutable || ((route) => promptControl.assertRouteQualified(route));

  function prepare({
    envelope,
    taskMode,
    directive,
    contextLanes,
    contextAllowlist = null,
    outputSchema,
    capabilityCriticalityOverride = null,
    preparation = null,
  } = {}) {
    if (!envelope?.capability?.id) throw new TypeError('Teaching AI adapter requires an execution envelope.');
    return promptControl.createInvocation({
      capabilityId: envelope.capability.id,
      taskMode,
      directive,
      contextLanes,
      contextAllowlist,
      stateReference: envelope.state_reference,
      outputSchema,
      capabilityCriticalityOverride,
      preparation,
      audit: {
        correlation_id: envelope.correlation_id,
        causation_id: envelope.causation_id,
      },
    });
  }

  async function execute({
    invocation,
    academicInput = {},
    schemaValidator,
    domainValidator,
    provenanceValidator = null,
    deterministicChecks = [],
    validationContext = {},
    safeCommunicationFallback = null,
  } = {}) {
    if (!invocation?.capability?.id) throw new TypeError('Teaching AI execution requires a prepared structural invocation.');
    if (authorityAtLeast(invocation.capability.authority_ceiling, 'T2') && typeof provenanceValidator !== 'function') {
      const error = new Error('T2–T4 Teaching execution requires explicit provenance validation.');
      error.code = 'TEACHING_D05_PROVENANCE_VALIDATOR_REQUIRED';
      throw error;
    }
    routeGuard(invocation.route_control);
    if (typeof resolveCentralTaskId !== 'function') {
      const error = new Error('No qualified central KIWI AI task route has been bound for Teaching yet.');
      error.code = 'TEACHING_CENTRAL_ROUTE_UNBOUND';
      throw error;
    }
    const taskId = await resolveCentralTaskId(invocation.route_control, invocation);
    if (!String(taskId || '').trim()) {
      const error = new Error('Qualified Teaching route resolved no central KIWI AI task.');
      error.code = 'TEACHING_CENTRAL_ROUTE_UNBOUND';
      throw error;
    }

    const effectiveChecks = [...deterministicChecks];
    if (typeof provenanceValidator === 'function') {
      effectiveChecks.push(Object.freeze({
        id: 'd05.provenance.validation',
        async evaluate(candidate, context) {
          return provenanceValidator(candidate, {
            ...context,
            capabilityId: invocation.capability.id,
            promptFamilyId: invocation.prompt.family_id,
          });
        },
      }));
    }

    return aiBoundary.execute({
      taskId: String(taskId).trim(),
      request: Object.freeze({
        teachingInvocation: invocation,
        academicInput: Object.freeze({ ...academicInput }),
      }),
      responsibilityKey: invocation.capability.id,
      capabilityId: invocation.capability.id,
      intelligenceClass: invocation.capability.execution_class,
      authorityLevel: invocation.capability.authority_ceiling,
      authoritativeOwner: invocation.capability.authoritative_owner_boundary,
      correlationId: invocation.audit.correlation_id,
      causationId: invocation.audit.causation_id,
      promptFamilyId: invocation.prompt.family_id,
      promptFamilyVersion: invocation.prompt.family_version,
      constitutionVersion: invocation.constitution.version,
      outputSchemaId: invocation.output_schema.id,
      outputSchemaVersion: invocation.output_schema.version,
      schemaValidator,
      domainValidator,
      deterministicChecks: effectiveChecks,
      validationContext,
      safeCommunicationFallback,
    });
  }

  return Object.freeze({ prepare, execute });
}

module.exports = { createTeachingAIAdapter };
