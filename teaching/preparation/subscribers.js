'use strict';

const { TEACHING_EVENTS } = require('../events/names');
const { reconcileMaterialityAndStaleness } = require('./t0-handlers');

const D09_PREPARATION_EVENT_TYPES = Object.freeze([
  TEACHING_EVENTS.PREPARATION_WORKSPACE_SEEDED,
  TEACHING_EVENTS.PREPARATION_INPUT_CHANGED,
]);

function fail(message, code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function requireRepository(repository) {
  for (const method of [
    'getWorkspaceSnapshot',
    'getMaterialitySnapshot',
    'applyMaterialityDecision',
    'hasProcessedEvent',
    'auditNoop',
  ]) {
    if (typeof repository?.[method] !== 'function') {
      throw new TypeError(`Preparation published-event handlers require repository.${method}().`);
    }
  }
}

function normalizeVersion(value, field) {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 0) throw new TypeError(`${field} must be a non-negative integer.`);
  return version;
}

function eventAuditMetadata(event, extra = {}) {
  return Object.freeze({
    event_id: event.eventId,
    event_type: event.eventType,
    event_aggregate_version: normalizeVersion(event.aggregateVersion, 'event.aggregateVersion'),
    route_qualification: 'UNQUALIFIED_UNTIL_D30',
    ...extra,
  });
}

function createPreparationPublishedEventHandlers({ repository } = {}) {
  requireRepository(repository);

  async function replayOutcome(event) {
    const processed = await repository.hasProcessedEvent({
      workspaceId: event.aggregateId,
      eventId: event.eventId,
    });
    return processed
      ? Object.freeze({
          accepted: true,
          idempotent: true,
          stale: false,
          disposition: 'ALREADY_PROCESSED',
          modelWorkStarted: false,
          routeQualification: 'UNQUALIFIED_UNTIL_D30',
        })
      : null;
  }

  async function classifyVersion(workspace, event) {
    const currentVersion = normalizeVersion(workspace.state_version, 'workspace.state_version');
    const eventVersion = normalizeVersion(event.aggregateVersion, 'event.aggregateVersion');
    if (currentVersion < eventVersion) {
      fail(
        `Preparation event ${event.eventId} is ahead of workspace ${workspace.workspace_id} state.`,
        'TEACHING_PPL_EVENT_ORDER_GAP'
      );
    }
    return Object.freeze({
      currentVersion,
      eventVersion,
      stale: currentVersion > eventVersion,
    });
  }

  async function auditStale(event, workspace, reason = 'STALE_EVENT_SUPERSEDED') {
    await repository.auditNoop({
      workspaceId: workspace.workspace_id,
      action: 'preparation.event.stale.noop',
      reason,
      correlationId: event.correlationId || null,
      causationId: event.eventId || null,
      safeMetadata: eventAuditMetadata(event, {
        current_workspace_version: Number(workspace.state_version),
      }),
    });
    return Object.freeze({ accepted: true, stale: true, reason });
  }

  async function handleWorkspaceSeeded(event) {
    const replay = await replayOutcome(event);
    if (replay) return replay;
    const snapshot = await repository.getWorkspaceSnapshot(event.aggregateId);
    if (!snapshot?.workspace) {
      fail(`Preparation Workspace not found: ${event.aggregateId}`, 'TEACHING_PPL_WORKSPACE_NOT_FOUND');
    }
    const version = await classifyVersion(snapshot.workspace, event);
    if (version.stale) return auditStale(event, snapshot.workspace);
    if (!snapshot.workspace.current_authoritative_input_bundle_ref) {
      fail(
        'Workspace-seeded event cannot be acknowledged without its authoritative input bundle.',
        'TEACHING_PPL_SEEDED_BUNDLE_MISSING'
      );
    }

    await repository.auditNoop({
      workspaceId: snapshot.workspace.workspace_id,
      action: 'preparation.workspace.seed_event.accepted',
      reason: 'WORKSPACE_SEEDED_ROUTE_HELD',
      correlationId: event.correlationId || null,
      causationId: event.eventId || null,
      safeMetadata: eventAuditMetadata(event, {
        current_authoritative_input_bundle_ref: snapshot.workspace.current_authoritative_input_bundle_ref,
      }),
    });
    return Object.freeze({
      accepted: true,
      stale: false,
      materiality: 'SEED_ACCEPTED',
      modelWorkStarted: false,
      routeQualification: 'UNQUALIFIED_UNTIL_D30',
    });
  }

  async function handleInputChanged(event) {
    const replay = await replayOutcome(event);
    if (replay) return replay;
    const snapshot = await repository.getMaterialitySnapshot(event.aggregateId);
    if (!snapshot?.workspace) {
      fail(`Preparation Workspace not found: ${event.aggregateId}`, 'TEACHING_PPL_WORKSPACE_NOT_FOUND');
    }
    const version = await classifyVersion(snapshot.workspace, event);
    if (version.stale) return auditStale(event, snapshot.workspace);

    const changedDependencyRefs = [...new Set(
      (event.payload?.changedDependencyRefs || []).map(String).filter(Boolean)
    )].sort();

    if (!snapshot.workspace.current_artifact_version_ref || !snapshot.artifact) {
      await repository.auditNoop({
        workspaceId: snapshot.workspace.workspace_id,
        action: 'preparation.materiality.noop',
        reason: 'NO_CURRENT_ARTIFACT_TO_INVALIDATE',
        correlationId: event.correlationId || null,
        causationId: event.eventId || null,
        safeMetadata: eventAuditMetadata(event, {
          changed_dependency_refs: changedDependencyRefs,
        }),
      });
      return Object.freeze({
        accepted: true,
        stale: false,
        material: changedDependencyRefs.length > 0,
        disposition: 'NO_CURRENT_ARTIFACT_TO_INVALIDATE',
        modelWorkStarted: false,
        routeQualification: 'UNQUALIFIED_UNTIL_D30',
      });
    }

    const decision = reconcileMaterialityAndStaleness({
      changedDependencyRefs,
      componentDependencies: snapshot.componentDependencies || [],
      allComponentIds: snapshot.componentIds || [],
    });

    if (!decision.material) {
      await repository.auditNoop({
        workspaceId: snapshot.workspace.workspace_id,
        action: 'preparation.materiality.noop',
        reason: decision.disposition,
        correlationId: event.correlationId || null,
        causationId: event.eventId || null,
        safeMetadata: eventAuditMetadata(event, {
          changed_dependency_refs: changedDependencyRefs,
        }),
      });
      return Object.freeze({
        accepted: true,
        ...decision,
        modelWorkStarted: false,
        routeQualification: 'UNQUALIFIED_UNTIL_D30',
      });
    }

    const committed = await repository.applyMaterialityDecision({
      workspaceId: snapshot.workspace.workspace_id,
      artifactVersionId: snapshot.workspace.current_artifact_version_ref,
      expectedStateVersion: snapshot.workspace.state_version,
      decision,
      correlationId: event.correlationId || null,
      causationId: event.eventId || null,
    });
    return Object.freeze({
      accepted: true,
      ...decision,
      workspaceVersion: Number(committed.workspace?.state_version),
      modelWorkStarted: false,
      routeQualification: 'UNQUALIFIED_UNTIL_D30',
    });
  }

  function handlerFor(eventType) {
    if (eventType === TEACHING_EVENTS.PREPARATION_WORKSPACE_SEEDED) return handleWorkspaceSeeded;
    if (eventType === TEACHING_EVENTS.PREPARATION_INPUT_CHANGED) return handleInputChanged;
    throw new TypeError(`Unsupported D09 preparation published event: ${eventType}`);
  }

  return Object.freeze({
    eventTypes: D09_PREPARATION_EVENT_TYPES,
    handleWorkspaceSeeded,
    handleInputChanged,
    handlerFor,
  });
}

function registerPreparationPublishedEventSubscribers(registry, handlers, {
  subscriberId = 'ppl-d09-deterministic-gate',
} = {}) {
  if (!registry || typeof registry.register !== 'function') {
    throw new TypeError('Preparation published-event registration requires subscriber registry.');
  }
  if (!handlers || typeof handlers.handlerFor !== 'function') {
    throw new TypeError('Preparation published-event registration requires handlers.');
  }

  return Object.freeze(handlers.eventTypes.map((eventType) => registry.register(eventType, {
    subscriberId,
    handle: handlers.handlerFor(eventType),
  })));
}

module.exports = {
  D09_PREPARATION_EVENT_TYPES,
  createPreparationPublishedEventHandlers,
  registerPreparationPublishedEventSubscribers,
};
