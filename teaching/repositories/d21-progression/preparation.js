'use strict';

const { authoritativeVersionDigest, gradeScaleOutcome, asArray, upper } = require('../../d21/contracts');

function install(proto) {
  proto.createPreparationWorkspace = async function createPreparationWorkspace({ studentId, pathwayRow, authoritativeRefs = [], preconditions = {}, idempotencyKey = null }) {
    const { query, withTransaction, randomUUID, clock, json, q, sha, fail, assertReady, course, requireCourse, requireSemester, attemptForCourse, ensureInitialAttempt, currentPolicy, policyComparable, lockPolicy, latestPlanBundle, latestCourseResult, latestTopicScores, latestKnowledgeForUnits, unresolvedAssignmentIntegrity, loadProgressionSnapshot, stateDigest, progressionHistory, commitOutcome, pathway, createPathway, preparationSnapshot, appendPreparationArtifact, pathwaySteps, addPathwayStep, updatePathwayState, createRepeatAttempt, destinationPrerequisites, semesterCourses, commitGpaSnapshot, semesterRecord } = this;
    return withTransaction(async (tx) => {
      const p = await pathway(studentId, pathwayRow.pathway_id, tx);
      if (!p) fail('Progression pathway not found.', 'TEACHING_D21_PATHWAY_NOT_FOUND', 404);
      if (p.preparation_workspace_ref) {
        const existing = await q(tx,
          'select * from teaching_preparation.workspaces where student_id=$1 and workspace_id=$2 limit 1',
          [studentId, p.preparation_workspace_ref],
        );
        if (existing.rows?.[0]) {
          const bundle = await q(tx,
            'select * from teaching_preparation.authoritative_input_bundles where student_id=$1 and workspace_id=$2 order by bundle_version desc limit 1',
            [studentId, existing.rows[0].workspace_id],
          );
          return Object.freeze({ workspace: existing.rows[0], bundle: bundle.rows?.[0] || null, idempotent: true });
        }
      }
      const byTarget = await q(tx, `select * from teaching_preparation.workspaces
        where student_id=$1 and target_kind='PROGRESSION_PATHWAY' and target_ref=$2 limit 1`,
      [studentId, p.pathway_id]);
      if (byTarget.rows?.[0]) {
        const bundle = await q(tx,
          'select * from teaching_preparation.authoritative_input_bundles where student_id=$1 and workspace_id=$2 order by bundle_version desc limit 1',
          [studentId, byTarget.rows[0].workspace_id],
        );
        await q(tx, 'update public.teaching_progression_pathways set preparation_workspace_ref=$3,state_version=state_version+1,updated_at=now() where student_id=$1 and pathway_id=$2 and preparation_workspace_ref is null', [studentId, p.pathway_id, byTarget.rows[0].workspace_id]);
        return Object.freeze({ workspace: byTarget.rows[0], bundle: bundle.rows?.[0] || null, idempotent: true });
      }

      const workspaceId = randomUUID();
      const bundleId = randomUUID();
      const now = clock();
      const refs = authoritativeRefs.map((ref) => ({ ...ref }));
      const bundleDigest = sha({ refs, preconditions, pathwayId: p.pathway_id });
      const workspaceInsert = await q(tx, `
        insert into teaching_preparation.workspaces(
          workspace_id,student_id,workspace_type,target_kind,target_ref,authoritative_owner_ref,preparation_profile_ref,
          lifecycle_state,maturity_stage,state_version,current_authoritative_input_bundle_ref,protected_content_class,
          trigger_policy_ref,created_at,updated_at
        ) values($1,$2,'D21_PATHWAY','PROGRESSION_PATHWAY',$3,'D21 Progression Engine','PPL:D21:PROGRESSION_REPAIR:v1',
                 'ACTIVE','SKELETON',0,null,'D21_PATHWAY_PLAN','D21:TCH-0890',$4,$4)
        returning *`,
      [workspaceId, studentId, p.pathway_id, now]);
      const bundleInsert = await q(tx, `
        insert into teaching_preparation.authoritative_input_bundles(
          input_bundle_id,workspace_id,student_id,bundle_version,captured_at,authoritative_refs,preconditions,
          material_delta_summary,content_digest
        ) values($1,$2,$3,1,$4,$5::jsonb,$6::jsonb,'{}'::jsonb,$7)
        returning *`,
      [bundleId, workspaceId, studentId, now, json(refs), json({ ...preconditions, idempotency_key: idempotencyKey }), bundleDigest]);
      for (const ref of refs) {
        await q(tx, `insert into teaching_preparation.input_bundle_dependencies(
          input_dependency_id,input_bundle_id,student_id,dependency_kind,authoritative_owner_ref,aggregate_ref,version_ref,component_scope_key
        ) values($1,$2,$3,$4,$5,$6,$7,$8)`,
        [randomUUID(), bundleId, studentId, String(ref.kind || 'AUTHORITATIVE_STATE'), String(ref.owner || 'UNKNOWN_OWNER'), String(ref.ref), String(ref.version ?? '0'), ref.component_scope_key ?? null]);
      }
      const workspaceUpdated = await q(tx, `update teaching_preparation.workspaces
        set current_authoritative_input_bundle_ref=$3,state_version=state_version+1,updated_at=now()
        where student_id=$1 and workspace_id=$2 returning *`,
      [studentId, workspaceId, bundleId]);
      await q(tx, `update public.teaching_progression_pathways
        set preparation_workspace_ref=$3,state_version=state_version+1,updated_at=now()
        where student_id=$1 and pathway_id=$2`,
      [studentId, p.pathway_id, workspaceId]);
      return Object.freeze({ workspace: workspaceUpdated.rows[0] || workspaceInsert.rows[0], bundle: bundleInsert.rows[0], idempotent: false });
    });
  };

  proto.preparationSnapshot = async function preparationSnapshot(studentId, pathwayId, runner = null) {
    const { query, withTransaction, randomUUID, clock, json, q, sha, fail, assertReady, course, requireCourse, requireSemester, attemptForCourse, ensureInitialAttempt, currentPolicy, policyComparable, lockPolicy, latestPlanBundle, latestCourseResult, latestTopicScores, latestKnowledgeForUnits, unresolvedAssignmentIntegrity, loadProgressionSnapshot, stateDigest, progressionHistory, commitOutcome, pathway, createPathway, createPreparationWorkspace, appendPreparationArtifact, pathwaySteps, addPathwayStep, updatePathwayState, createRepeatAttempt, destinationPrerequisites, semesterCourses, commitGpaSnapshot, semesterRecord } = this;
    const p = await pathway(studentId, pathwayId, runner);
    if (!p) return null;
    const { rows: workspaces = [] } = await q(runner, `select * from teaching_preparation.workspaces
      where student_id=$1 and ((workspace_id=$2) or (target_kind='PROGRESSION_PATHWAY' and target_ref=$3))
      order by created_at desc limit 1`,
    [studentId, p.preparation_workspace_ref || '', pathwayId]);
    const workspace = workspaces[0] || null;
    if (!workspace) return null;
    const bundle = workspace.current_authoritative_input_bundle_ref
      ? (await q(runner, 'select * from teaching_preparation.authoritative_input_bundles where student_id=$1 and input_bundle_id=$2 limit 1', [studentId, workspace.current_authoritative_input_bundle_ref])).rows?.[0] || null
      : null;
    const artifact = workspace.current_artifact_version_ref
      ? (await q(runner, 'select * from teaching_preparation.artifact_versions where student_id=$1 and artifact_version_id=$2 limit 1', [studentId, workspace.current_artifact_version_ref])).rows?.[0] || null
      : null;
    return Object.freeze({ pathway: p, workspace, bundle, artifact });
  };

  proto.appendPreparationArtifact = async function appendPreparationArtifact({
    studentId, pathwayId, workspaceId, expectedWorkspaceVersion, inputBundleId,
    capabilityId, promptFamilyRef, artifactPayload, conciseRationale,
  }) {
    const { query, withTransaction, randomUUID, clock, json, q, sha, fail, assertReady, course, requireCourse, requireSemester, attemptForCourse, ensureInitialAttempt, currentPolicy, policyComparable, lockPolicy, latestPlanBundle, latestCourseResult, latestTopicScores, latestKnowledgeForUnits, unresolvedAssignmentIntegrity, loadProgressionSnapshot, stateDigest, progressionHistory, commitOutcome, pathway, createPathway, createPreparationWorkspace, preparationSnapshot, pathwaySteps, addPathwayStep, updatePathwayState, createRepeatAttempt, destinationPrerequisites, semesterCourses, commitGpaSnapshot, semesterRecord } = this;
    return withTransaction(async (tx) => {
      const prep = await preparationSnapshot(studentId, pathwayId, tx);
      if (!prep || String(prep.workspace.workspace_id) !== String(workspaceId)) {
        fail('D21 PPL Workspace is missing.', 'TEACHING_D21_PPL_WORKSPACE_REQUIRED', 409);
      }
      if (Number(prep.workspace.state_version) !== Number(expectedWorkspaceVersion)) {
        fail('PPL Workspace changed before plan commit.', 'TEACHING_D21_PPL_STALE_WORKSPACE');
      }
      if (String(prep.bundle?.input_bundle_id || '') !== String(inputBundleId || '')) {
        fail('PPL authoritative input bundle changed before plan commit.', 'TEACHING_D21_PPL_STALE_INPUT_BUNDLE');
      }
      const live = await loadProgressionSnapshot(studentId, prep.pathway.course_id, tx);
      if (stateDigest(live) !== String(prep.pathway.source_state_versions?.source_state_digest || '')) {
        fail('Authoritative state changed before PPL artifact commit.', 'TEACHING_D21_STALE_MODEL_OUTPUT');
      }

      const versionResult = await q(tx,
        'select coalesce(max(version_no),0)::bigint as version from teaching_preparation.artifact_versions where workspace_id=$1',
        [workspaceId],
      );
      const version = Number(versionResult.rows?.[0]?.version || 0) + 1;
      const artifactId = randomUUID();
      const digest = sha(artifactPayload || {});
      await q(tx, `insert into teaching_preparation.artifact_versions(
        artifact_version_id,workspace_id,student_id,artifact_kind,version_no,input_bundle_id,parent_artifact_version_id,
        created_by_capability_id,prompt_family_ref,schema_version,artifact_digest,protected_content_class,validity_state,concise_rationale
      ) values($1,$2,$3,'D21_PATHWAY_PLAN',$4,$5,$6,$7,$8,'d21.pathway-plan.v1',$9,'D21_PATHWAY_PLAN','CURRENT',$10)`,
      [artifactId, workspaceId, studentId, version, inputBundleId, prep.artifact?.artifact_version_id || null, capabilityId, promptFamilyRef, digest, conciseRationale || null]);
      await q(tx, `insert into teaching_protected.prepared_artifact_payloads(
        artifact_version_id,student_id,protected_content_class,payload_schema_version,payload,payload_digest
      ) values($1,$2,'D21_PATHWAY_PLAN','d21.pathway-plan.v1',$3::jsonb,$4)`,
      [artifactId, studentId, json(artifactPayload || {}), digest]);

      const dependencies = await q(tx,
        'select * from teaching_preparation.input_bundle_dependencies where student_id=$1 and input_bundle_id=$2 order by input_dependency_id',
        [studentId, inputBundleId],
      );
      const unitRefs = asArray(prep.pathway.required_learning_unit_refs).map(String);
      const componentSpecs = [{ key: 'plan-core', kind: 'PATHWAY_PLAN_CORE', scope: null }, ...unitRefs.map((ref) => ({ key: `learning-unit:${ref}`, kind: 'LEARNING_UNIT_REPAIR_PLAN', scope: ref }))];
      for (const component of componentSpecs) {
        const componentId = randomUUID();
        await q(tx, `insert into teaching_preparation.artifact_components(
          artifact_component_id,artifact_version_id,student_id,component_key,component_kind,component_digest,stale,stale_reason
        ) values($1,$2,$3,$4,$5,$6,false,null)`,
        [componentId, artifactId, studentId, component.key, component.kind, sha({ component: component.key, payload: artifactPayload || {} })]);
        const relevant = (dependencies.rows || []).filter((dep) => component.scope == null
          ? dep.component_scope_key == null
          : dep.component_scope_key == null || String(dep.component_scope_key) === component.scope);
        for (const dep of relevant) {
          await q(tx, `insert into teaching_preparation.component_dependencies(
            component_dependency_id,artifact_component_id,input_dependency_id,student_id,dependency_role
          ) values($1,$2,$3,$4,'AUTHORITATIVE_INPUT')`,
          [randomUUID(), componentId, dep.input_dependency_id, studentId]);
        }
      }

      const ws = await q(tx, `update teaching_preparation.workspaces
        set current_artifact_version_ref=$3,maturity_stage='CANDIDATE',state_version=state_version+1,updated_at=now()
        where student_id=$1 and workspace_id=$2 and state_version=$4 returning *`,
      [studentId, workspaceId, artifactId, Number(expectedWorkspaceVersion)]);
      if (!ws.rows?.[0]) fail('PPL Workspace changed before plan commit.', 'TEACHING_D21_PPL_STALE_WORKSPACE');
      const path = await q(tx, `update public.teaching_progression_pathways
        set plan_payload=$3::jsonb,state_version=state_version+1,updated_at=now()
        where student_id=$1 and pathway_id=$2 returning *`,
      [studentId, pathwayId, json(artifactPayload || {})]);
      return Object.freeze({ artifactVersionId: artifactId, artifactVersion: version, workspace: ws.rows[0], pathway: path.rows?.[0] || prep.pathway, planAuthority: 'NON_AUTHORITATIVE_PPL' });
    });
  };
}

module.exports = { install };
