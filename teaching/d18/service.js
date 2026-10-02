'use strict';

const core = require('../../public/assessment-shell-core');
const { fail } = require('../d17/contracts');

function createD18AssessmentShellService({ repository, clock = () => new Date() } = {}) {
  if (!repository || typeof repository.requireAttempt !== 'function' || typeof repository.packageById !== 'function') {
    throw new TypeError('D18 Assessment Shell service requires the accepted D17 Assessment repository.');
  }

  const now = () => {
    const value = clock();
    return value instanceof Date ? value : new Date(value);
  };

  function userId(user) {
    if (!user?.id) throw fail('Authenticated student is required.', 'TEACHING_D18_AUTH_REQUIRED', 401);
    return String(user.id);
  }

  async function safePackageProjection(studentId, packageId) {
    const pack = await repository.packageById(studentId, packageId);
    if (!pack) throw fail('Assessment Package not found.', 'TEACHING_D18_PACKAGE_NOT_FOUND', 404);
    if (String(pack.package_state) !== 'LOCKED') {
      throw fail('Assessment Shell only renders a locked Assessment Package.', 'TEACHING_D18_LOCKED_PACKAGE_REQUIRED', 409);
    }

    const rows = await repository.packageItems(studentId, packageId);
    const items = [];
    for (const row of rows) {
      let choiceSetContract = {};
      if (row.candidate_version_id && typeof repository.candidateVersion === 'function') {
        const candidate = await repository.candidateVersion(studentId, row.candidate_version_id);
        choiceSetContract = candidate?.choice_set_contract || {};
      }
      const safeItem = {
        package_item_id: row.package_item_id,
        ordinal: Number(row.ordinal || 0),
        response_family: row.response_family,
        intended_marks: Number(row.intended_marks || 0),
        public_item_payload: row.public_item_payload || {},
        choice_set_contract: choiceSetContract,
        item_state: row.item_state,
        answer_exposed: row.answer_exposed === true,
      };
      const renderer = core.describeRenderer(safeItem, pack);
      const projected = Object.freeze({ ...safeItem, renderer });
      core.assertBrowserSafe(projected);
      items.push(projected);
    }

    const packageProjection = Object.freeze({
      assessment_package_id: pack.assessment_package_id,
      assessment_id: pack.assessment_id,
      version_no: Number(pack.version_no || 0),
      package_state: pack.package_state,
      package_hash: pack.package_hash,
      duration_minutes: Number(pack.duration_minutes || 0),
      timer_model: pack.timer_model,
      response_form_architecture: pack.response_form_architecture || {},
      resource_policy: pack.resource_policy || {},
      accommodation_policy: pack.accommodation_policy || {},
      locked_at: pack.locked_at,
      navigation: core.navigationPolicy(pack),
      allowed_tools: core.allowedTools(pack),
    });
    core.assertBrowserSafe(packageProjection);
    return Object.freeze({ package: packageProjection, items: Object.freeze(items) });
  }

  function attemptProjection(row, requestedDeviceId) {
    const requested = requestedDeviceId == null ? null : String(requestedDeviceId);
    const active = row.active_device_id == null ? null : String(row.active_device_id);
    const deviceAuthority = !requested ? 'UNDECLARED' : (!active || requested === active ? 'MATCH' : 'MISMATCH');
    return Object.freeze({
      assessment_attempt_id: row.assessment_attempt_id,
      assessment_id: row.assessment_id,
      assessment_package_id: row.assessment_package_id,
      attempt_no: Number(row.attempt_no || 0),
      attempt_state: row.attempt_state,
      result_state: row.result_state,
      started_at: row.started_at,
      expires_at: row.expires_at,
      finalized_at: row.finalized_at,
      state_version: Number(row.state_version || 0),
      finalization_version: Number(row.finalization_version || 0),
      policy_version_at_start: row.policy_version_at_start,
      device_authority: deviceAuthority,
      read_only: core.isTerminalAttempt(row.attempt_state),
    });
  }

  function responseProjection(row) {
    const projected = Object.freeze({
      assessment_response_id: row.assessment_response_id,
      package_item_id: row.package_item_id,
      response_version: Number(row.response_version || 0),
      renderer_payload: row.renderer_payload || {},
      response_state: row.response_state,
      accepted_at: row.accepted_at,
      client_occurred_at: row.client_occurred_at,
    });
    core.assertBrowserSafe(projected);
    return projected;
  }

  async function getPackage(user, packageId) {
    const projection = await safePackageProjection(userId(user), String(packageId));
    return Object.freeze({ ...projection, serverNow: now().toISOString(), contractVersion: 'd18.v1' });
  }

  async function getAttemptWorkspace(user, attemptId, { deviceId = null } = {}) {
    const sid = userId(user);
    const attempt = await repository.requireAttempt(sid, String(attemptId));
    const projection = await safePackageProjection(sid, attempt.assessment_package_id);
    const latest = await repository.latestResponses(sid, attempt.assessment_attempt_id);
    const responses = Object.freeze(latest.map(responseProjection));
    const result = Object.freeze({
      contractVersion: 'd18.v1',
      serverNow: now().toISOString(),
      attempt: attemptProjection(attempt, deviceId),
      package: projection.package,
      items: projection.items,
      responses,
    });
    core.assertBrowserSafe(result);
    return result;
  }

  return Object.freeze({ getPackage, getAttemptWorkspace });
}

module.exports = { createD18AssessmentShellService };
