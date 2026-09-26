'use strict';

const { assertProtectedPreparationAccess } = require('../security/d04-persistence-contract');

function createPreparationRuntimeRepository({ query, withTransaction, randomUUID, clock = () => new Date() } = {}) {
  if (typeof query !== 'function') throw new TypeError('Preparation runtime repository requires query().');
  if (typeof withTransaction !== 'function') throw new TypeError('Preparation runtime repository requires withTransaction().');
  if (typeof randomUUID !== 'function') throw new TypeError('Preparation runtime repository requires randomUUID().');

  async function assertReady() {
    const { rows } = await query(`
      select
        to_regclass('teaching_preparation.workspaces') as workspaces,
        to_regclass('teaching_preparation.artifact_versions') as artifact_versions,
        to_regclass('teaching_preparation.artifact_components') as artifact_components,
        to_regclass('teaching_preparation.component_dependencies') as component_dependencies,
        to_regclass('teaching_preparation.review_findings') as review_findings,
        to_regclass('teaching_protected.prepared_artifact_payloads') as protected_payloads
    `);
    if (Object.values(rows?.[0] || {}).some((value) => value == null)) {
      const error = new Error('D04 preparation persistence required by D05 is not ready.');
      error.code = 'TEACHING_D05_PREPARATION_SCHEMA_MISSING';
      throw error;
    }
    return true;
  }

  async function getWorkspace(workspaceId) {
    const { rows } = await query(
      'select * from teaching_preparation.workspaces where workspace_id=$1 limit 1',
      [workspaceId]
    );
    return rows?.[0] || null;
  }

  async function getWorkspaceSnapshot(workspaceId) {
    const workspace = await getWorkspace(workspaceId);
    if (!workspace) return null;
    const { rows: findings } = await query(
      `select finding_id,status,severity,artifact_version_id
         from teaching_preparation.review_findings
        where workspace_id=$1 and status in ('OPEN','ACCEPTED_RISK')
        order by created_at asc`,
      [workspaceId]
    );
    return Object.freeze({ workspace, findings: Object.freeze(findings || []) });
  }

  async function getFinalizationSnapshot(workspaceId) {
    const base = await getWorkspaceSnapshot(workspaceId);
    if (!base) return null;
    const workspace = base.workspace;
    let artifact = null;
    if (workspace.current_artifact_version_ref) {
      const { rows } = await query(
        'select * from teaching_preparation.artifact_versions where artifact_version_id=$1 limit 1',
        [workspace.current_artifact_version_ref]
      );
      artifact = rows?.[0] || null;
    }
    let bundle = null;
    let dependencies = [];
    if (workspace.current_authoritative_input_bundle_ref) {
      const bundleResult = await query(
        'select * from teaching_preparation.authoritative_input_bundles where input_bundle_id=$1 limit 1',
        [workspace.current_authoritative_input_bundle_ref]
      );
      bundle = bundleResult.rows?.[0] || null;
      const depResult = await query(
        `select input_dependency_id,dependency_kind,authoritative_owner_ref,aggregate_ref,version_ref,component_scope_key
           from teaching_preparation.input_bundle_dependencies
          where input_bundle_id=$1
          order by input_dependency_id`,
        [workspace.current_authoritative_input_bundle_ref]
      );
      dependencies = depResult.rows || [];
    }
    return Object.freeze({
      workspace,
      artifact,
      bundle,
      findings: base.findings,
      dependencies: Object.freeze(dependencies.map((row) => Object.freeze({ ...row }))),
    });
  }

  async function loadComponentDependencies(artifactVersionId) {
    const { rows } = await query(
      `select ac.artifact_component_id as component_id,
              ibd.aggregate_ref as dependency_ref
         from teaching_preparation.artifact_components ac
         join teaching_preparation.component_dependencies cd
           on cd.artifact_component_id=ac.artifact_component_id
         join teaching_preparation.input_bundle_dependencies ibd
           on ibd.input_dependency_id=cd.input_dependency_id
        where ac.artifact_version_id=$1`,
      [artifactVersionId]
    );
    return Object.freeze((rows || []).map((row) => Object.freeze({
      componentId: row.component_id,
      dependencyRef: row.dependency_ref,
    })));
  }

  async function getMaterialitySnapshot(workspaceId) {
    const finalization = await getFinalizationSnapshot(workspaceId);
    if (!finalization) return null;
    const artifactId = finalization.workspace.current_artifact_version_ref;
    const componentDependencies = artifactId
      ? await loadComponentDependencies(artifactId)
      : Object.freeze([]);
    return Object.freeze({ ...finalization, componentDependencies });
  }

  async function appendAudit(tx, workspace, {
    action,
    reason = null,
    correlationId = null,
    causationId = null,
    beforeRef = {},
    afterRef = {},
    safeMetadata = {},
  } = {}) {
    await tx.query(
      `insert into public.teaching_academic_audit_log (
         audit_id,student_id,occurred_at,actor_type,actor_id,action,entity_type,entity_id,
         authoritative_owner,state_version_ref,correlation_id,causation_id,reason,before_ref,after_ref,
         provenance_refs,safe_metadata
       ) values ($1,$2,$3,'SYSTEM',null,$4,'PREPARATION_WORKSPACE',$5,'Preparation Runtime',
                 $6,$7,$8,$9,$10::jsonb,$11::jsonb,'[]'::jsonb,$12::jsonb)`,
      [
        randomUUID(),workspace.student_id,clock(),action,workspace.workspace_id,
        String(workspace.state_version),correlationId,causationId,reason,
        JSON.stringify(beforeRef || {}),JSON.stringify(afterRef || {}),JSON.stringify(safeMetadata || {}),
      ]
    );
  }

  async function applyWorkspaceTransition({
    workspaceId,
    expectedStateVersion,
    decision,
    correlationId = null,
    causationId = null,
    reason = null,
  } = {}) {
    return withTransaction(async (tx) => {
      const { rows } = await tx.query(
        'select * from teaching_preparation.workspaces where workspace_id=$1 for update',
        [workspaceId]
      );
      const workspace = rows?.[0];
      if (!workspace) {
        const error = new Error(`Preparation Workspace not found: ${workspaceId}`);
        error.code = 'TEACHING_PPL_WORKSPACE_NOT_FOUND';
        throw error;
      }
      if (String(workspace.state_version) !== String(expectedStateVersion)) {
        const error = new Error('Preparation Workspace version changed before transition commit.');
        error.code = 'TEACHING_PPL_STALE_WORKSPACE_VERSION';
        throw error;
      }
      const updated = await tx.query(
        `update teaching_preparation.workspaces
            set lifecycle_state=$2,maturity_stage=$3,state_version=state_version+1,updated_at=now()
          where workspace_id=$1 and state_version=$4
          returning *`,
        [workspaceId,decision.nextLifecycle,decision.nextMaturity,Number(expectedStateVersion)]
      );
      const next = updated.rows?.[0];
      if (!next) {
        const error = new Error('Preparation Workspace transition lost an optimistic-concurrency race.');
        error.code = 'TEACHING_PPL_STALE_WORKSPACE_VERSION';
        throw error;
      }
      await appendAudit(tx, workspace, {
        action: 'preparation.workspace.transition',
        reason,
        correlationId,
        causationId,
        beforeRef: { lifecycle_state: workspace.lifecycle_state, maturity_stage: workspace.maturity_stage },
        afterRef: { lifecycle_state: next.lifecycle_state, maturity_stage: next.maturity_stage },
      });
      return Object.freeze({ decision, workspace: next });
    });
  }

  async function applyMaterialityDecision({
    workspaceId,
    artifactVersionId,
    expectedStateVersion,
    decision,
    correlationId = null,
    causationId = null,
  } = {}) {
    if (!decision?.material || decision.stale) return decision;
    return withTransaction(async (tx) => {
      const { rows } = await tx.query(
        'select * from teaching_preparation.workspaces where workspace_id=$1 for update',
        [workspaceId]
      );
      const workspace = rows?.[0];
      if (!workspace || String(workspace.state_version) !== String(expectedStateVersion)) {
        const error = new Error('Preparation Workspace version changed before materiality commit.');
        error.code = 'TEACHING_PPL_STALE_WORKSPACE_VERSION';
        throw error;
      }
      if (workspace.current_artifact_version_ref !== artifactVersionId) {
        const error = new Error('Preparation artifact changed before materiality commit.');
        error.code = 'TEACHING_PPL_STALE_ARTIFACT_VERSION';
        throw error;
      }

      await tx.query(
        `update teaching_preparation.artifact_components
            set stale=true,stale_reason='AUTHORITATIVE_DEPENDENCY_CHANGED'
          where artifact_version_id=$1 and artifact_component_id=any($2::text[])`,
        [artifactVersionId,decision.invalidatedComponentIds]
      );
      await tx.query(
        `update teaching_preparation.artifact_versions
            set validity_state=$2
          where artifact_version_id=$1`,
        [artifactVersionId,decision.artifactValidity]
      );
      const updated = await tx.query(
        `update teaching_preparation.workspaces
            set state_version=state_version+1,last_material_review_at=$2,updated_at=now()
          where workspace_id=$1 and state_version=$3 returning *`,
        [workspaceId,clock(),Number(expectedStateVersion)]
      );
      const next = updated.rows?.[0];
      if (!next) {
        const error = new Error('Preparation materiality update lost an optimistic-concurrency race.');
        error.code = 'TEACHING_PPL_STALE_WORKSPACE_VERSION';
        throw error;
      }
      await appendAudit(tx, workspace, {
        action: 'preparation.materiality.invalidate',
        correlationId,
        causationId,
        beforeRef: { artifact_version_id: artifactVersionId },
        afterRef: {
          artifact_version_id: artifactVersionId,
          validity_state: decision.artifactValidity,
          invalidated_component_ids: decision.invalidatedComponentIds,
        },
      });
      return Object.freeze({ decision, workspace: next });
    });
  }

  async function auditNoop({ workspaceId, action, reason, correlationId = null, causationId = null, safeMetadata = {} } = {}) {
    return withTransaction(async (tx) => {
      const { rows } = await tx.query(
        'select * from teaching_preparation.workspaces where workspace_id=$1 for update',
        [workspaceId]
      );
      const workspace = rows?.[0];
      if (!workspace) throw new Error(`Preparation Workspace not found: ${workspaceId}`);
      await appendAudit(tx, workspace, { action, reason, correlationId, causationId, safeMetadata });
      return Object.freeze({ noop: true, workspaceVersion: workspace.state_version });
    });
  }

  async function readProtectedPayload(context, artifactVersionId) {
    assertProtectedPreparationAccess(context);
    const { rows } = await query(
      `select artifact_version_id,student_id,protected_content_class,payload_schema_version,payload,payload_digest,created_at
         from teaching_protected.prepared_artifact_payloads
        where artifact_version_id=$1 limit 1`,
      [artifactVersionId]
    );
    return rows?.[0] || null;
  }

  return Object.freeze({
    assertReady,
    getWorkspace,
    getWorkspaceSnapshot,
    getFinalizationSnapshot,
    getMaterialitySnapshot,
    loadComponentDependencies,
    applyWorkspaceTransition,
    applyMaterialityDecision,
    auditNoop,
    readProtectedPayload,
  });
}

module.exports = { createPreparationRuntimeRepository };
