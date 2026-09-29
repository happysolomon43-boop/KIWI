'use strict';

const { TEACHING_EVENTS } = require('../events/names');
const { reconcileMaterialityAndStaleness } = require('./t0-handlers');

function fail(message, code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function schedulingDependencyVersionReader(query) {
  if (typeof query !== 'function') throw new TypeError('PPL published-event subscriber requires query().');
  return async function currentVersion(dependency) {
    const kind = String(dependency?.dependency_kind || '').trim().toUpperCase();
    const ref = String(dependency?.aggregate_ref || '').trim();
    if (kind === 'SEMESTER' && ref.startsWith('semester:')) {
      const id = ref.slice('semester:'.length);
      const { rows } = await query('select state_version from public.teaching_semesters where semester_id=$1 limit 1',[id]);
      return rows?.[0]?.state_version == null ? null : String(rows[0].state_version);
    }
    if (kind === 'SCHEDULE_PROFILE' && ref.startsWith('schedule-profile:')) {
      const id = ref.slice('schedule-profile:'.length);
      const { rows } = await query('select version_no from public.teaching_schedule_profiles where profile_id=$1 limit 1',[id]);
      return rows?.[0]?.version_no == null ? null : String(rows[0].version_no);
    }
    fail(
      `No deterministic current-version reader is registered for PPL dependency ${kind || 'UNKNOWN'}:${ref || 'UNKNOWN'}.`,
      'TEACHING_PPL_DEPENDENCY_VERSION_READER_MISSING'
    );
  };
}

function assertSchedulingWorkspace(snapshot, event) {
  const workspace = snapshot?.workspace;
  if (!workspace) fail(
    `Preparation Workspace not found for published event: ${event.aggregateId}`,
    'TEACHING_PPL_WORKSPACE_NOT_FOUND'
  );
  if (
    String(workspace.workspace_type || '').toUpperCase() !== 'SCHEDULING_HORIZON' ||
    String(workspace.target_kind || '').toLowerCase() !== 'multi_course_schedule'
  ) {
    fail(
      'Baseline PPL published-event subscriber only owns the accepted D09 scheduling-horizon integration.',
      'TEACHING_PPL_PUBLISHED_EVENT_OWNER_NOT_IMPLEMENTED'
    );
  }
  return workspace;
}

function createSchedulingPreparationPublishedEventHandlers({ repository, query } = {}) {
  for (const method of ['getWorkspaceSnapshot','getMaterialitySnapshot','applyMaterialityDecision','auditNoop']) {
    if (typeof repository?.[method] !== 'function') {
      throw new TypeError(`PPL published-event subscriber requires repository.${method}().`);
    }
  }
  const readVersion = schedulingDependencyVersionReader(query);

  async function workspaceSeeded(event) {
    const snapshot = await repository.getWorkspaceSnapshot(event.aggregateId);
    const workspace = assertSchedulingWorkspace(snapshot,event);
    await repository.auditNoop({
      workspaceId: workspace.workspace_id,
      action: 'preparation.workspace_seeded.delivered',
      reason: 'PPL_WORKSPACE_SEEDED_DELIVERED',
      correlationId: event.correlationId || null,
      causationId: event.causationId || event.eventId || null,
      safeMetadata: {
        event_id: event.eventId,
        aggregate_version: event.aggregateVersion,
        target_ref: event.payload?.target_ref || null,
      },
    });
    return Object.freeze({ accepted:true, workspaceId:workspace.workspace_id, disposition:'DELIVERED' });
  }

  async function inputChanged(event) {
    const snapshot = await repository.getMaterialitySnapshot(event.aggregateId);
    const workspace = assertSchedulingWorkspace(snapshot,event);
    if (!workspace.current_artifact_version_ref || !snapshot.artifact) {
      await repository.auditNoop({
        workspaceId: workspace.workspace_id,
        action: 'preparation.input_changed.no_artifact',
        reason: 'PPL_INPUT_CHANGED_BEFORE_ARTIFACT',
        correlationId: event.correlationId || null,
        causationId: event.causationId || event.eventId || null,
        safeMetadata: {
          event_id: event.eventId,
          changed_dependency_refs: event.payload?.changedDependencyRefs || [],
        },
      });
      return Object.freeze({ accepted:true, workspaceId:workspace.workspace_id, disposition:'NO_ARTIFACT_YET' });
    }

    const currentVersions = {};
    for (const dependency of snapshot.dependencies || []) {
      currentVersions[dependency.aggregate_ref] = await readVersion(dependency);
    }
    const decision = reconcileMaterialityAndStaleness({
      completionCapturedVersions: null,
      currentVersions,
      changedDependencyRefs: event.payload?.changedDependencyRefs || [],
      componentDependencies: snapshot.componentDependencies || [],
      allComponentIds: snapshot.componentIds || [],
    });

    if (!decision.material) {
      await repository.auditNoop({
        workspaceId: workspace.workspace_id,
        action: 'preparation.materiality.noop',
        reason: decision.disposition,
        correlationId: event.correlationId || null,
        causationId: event.causationId || event.eventId || null,
        safeMetadata: {
          event_id: event.eventId,
          changed_dependency_refs: event.payload?.changedDependencyRefs || [],
        },
      });
      return Object.freeze({ accepted:true, workspaceId:workspace.workspace_id, ...decision });
    }

    const committed = await repository.applyMaterialityDecision({
      workspaceId: workspace.workspace_id,
      artifactVersionId: workspace.current_artifact_version_ref,
      expectedStateVersion: workspace.state_version,
      decision,
      correlationId: event.correlationId || null,
      causationId: event.causationId || event.eventId || null,
    });
    return Object.freeze({ accepted:true, workspaceId:workspace.workspace_id, ...decision, committed });
  }

  return Object.freeze({ workspaceSeeded, inputChanged });
}

function registerSchedulingPreparationPublishedEventSubscribers({ registry, repository, query } = {}) {
  if (!registry || typeof registry.register !== 'function') {
    throw new TypeError('PPL published-event integration requires subscriber registry.');
  }
  const handlers = createSchedulingPreparationPublishedEventHandlers({ repository, query });
  const unregisterSeeded = registry.register(TEACHING_EVENTS.PREPARATION_WORKSPACE_SEEDED,{
    subscriberId:'ppl-scheduling-workspace-seeded',
    handle:handlers.workspaceSeeded,
  });
  const unregisterChanged = registry.register(TEACHING_EVENTS.PREPARATION_INPUT_CHANGED,{
    subscriberId:'ppl-scheduling-input-materiality',
    handle:handlers.inputChanged,
  });
  return () => { unregisterSeeded(); unregisterChanged(); };
}

module.exports={
  schedulingDependencyVersionReader,
  createSchedulingPreparationPublishedEventHandlers,
  registerSchedulingPreparationPublishedEventSubscribers,
};
