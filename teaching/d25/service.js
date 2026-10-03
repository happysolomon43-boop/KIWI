'use strict';

const { createD18AssessmentShellService } = require('../d18/service');
const {
  SYSTEM_FAILURE_KIND,
  fail,
  requireIdempotencyKey,
  packageStartReadiness,
  timerProjection,
  protectedFailureMessage,
  isTransientFailure,
  retryDelayMs,
  syncProjection,
} = require('./contracts');

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createD25ReliabilityService({
  foundation,
  sleep = defaultSleep,
  clock = () => new Date(),
} = {}) {
  if (!foundation?.d11?.service || !foundation?.d11?.repository) throw new TypeError('D25 requires the accepted D11 Class owner.');
  if (!foundation?.d14?.service) throw new TypeError('D25 requires the accepted D14 Classroom owner.');
  if (!foundation?.d16?.service) throw new TypeError('D25 requires the accepted D16 Work owner.');
  if (!foundation?.d17?.service || !foundation?.d17?.repository) throw new TypeError('D25 requires the accepted D17 Assessment owner.');

  const d18 = createD18AssessmentShellService({ repository: foundation.d17.repository, clock });
  const now = () => { const value = clock(); return value instanceof Date ? value : new Date(value); };

  async function restoreClass(user, classId) {
    const snapshot = await foundation.d14.service.snapshot(user, classId);
    return Object.freeze({
      ...snapshot,
      reliability: Object.freeze({
        sourceOfTruth: 'D11_D14_SERVER',
        recoveredFromAuthoritativeSession: Boolean(snapshot.controller),
        browserStateAuthoritative: false,
        localCacheMayOverrideServer: false,
        serverAuthoritativeTime: true,
        systemProtected: snapshot.modeKey === 'INTERRUPTED' && snapshot.interruption?.cause === 'SYSTEM',
      }),
    });
  }

  async function protectClassInterruption(user, classId, input = {}) {
    const key = requireIdempotencyKey(input.idempotencyKey || `d25-system-interruption:${classId}`, 'd25-system-interruption');
    const current = await foundation.d11.service.getClass(user, classId);
    if (!current.controller) throw fail('Class Controller has not started.', 'TEACHING_D25_CONTROLLER_NOT_STARTED', 409);
    if (current.controller.lifecycleState === 'CLOSED') return Object.freeze({ idempotent:true, protected:true, state:'CLOSED', academicPenaltyAllowed:false, message:protectedFailureMessage(input.failureKind || SYSTEM_FAILURE_KIND.SERVICE) });
    if (current.controller.instructionalSubstate === 'INTERRUPTED') return Object.freeze({ idempotent:true, protected:true, state:'INTERRUPTED', resumeState:current.controller.resumeInstructionalSubstate, academicPenaltyAllowed:false, message:protectedFailureMessage(input.failureKind || SYSTEM_FAILURE_KIND.SERVICE) });
    const expectedVersion = input.expectedVersion == null ? current.controller.stateVersion : Number(input.expectedVersion);
    if (Number(expectedVersion) !== Number(current.controller.stateVersion)) throw fail('Class state changed before protected interruption could be committed.', 'TEACHING_D25_STALE_CLASS_VERSION', 409, { expectedVersion, currentVersion:current.controller.stateVersion });
    const changed = await foundation.d11.service.transition(user, classId, { expectedVersion, toState:'INTERRUPTED', reason:`KIWI_SYSTEM_FAILURE:${String(input.failureKind || SYSTEM_FAILURE_KIND.SERVICE)}`, idempotencyKey:key });
    return Object.freeze({
      idempotent:false, protected:true, state:changed.controller?.instructionalSubstate || 'INTERRUPTED',
      resumeState:changed.controller?.resumeInstructionalSubstate || current.controller.instructionalSubstate,
      academicPenaltyAllowed:false, attendancePenaltyAllowed:false, markPenaltyAllowed:false,
      message:protectedFailureMessage(input.failureKind || SYSTEM_FAILURE_KIND.SERVICE), owner:'D11_TEACHING_CONTROLLER',
    });
  }

  async function resumeProtectedClass(user, classId, input = {}) {
    const current = await foundation.d11.service.getClass(user, classId);
    if (!current.controller) throw fail('Class Controller has not started.', 'TEACHING_D25_CONTROLLER_NOT_STARTED', 409);
    if (current.controller.instructionalSubstate !== 'INTERRUPTED') return Object.freeze({ idempotent:true, resumed:false, context:current });
    const resumeState = current.controller.resumeInstructionalSubstate;
    if (!resumeState) throw fail('Protected Class interruption has no resume state.', 'TEACHING_D25_RESUME_STATE_MISSING', 409);
    const expectedVersion = input.expectedVersion == null ? current.controller.stateVersion : Number(input.expectedVersion);
    const changed = await foundation.d11.service.transition(user, classId, { expectedVersion, toState:resumeState, reason:'KIWI_SYSTEM_RECOVERY_REVALIDATED', idempotencyKey:requireIdempotencyKey(input.idempotencyKey || `d25-system-resume:${classId}:${expectedVersion}`, 'd25-system-resume') });
    return Object.freeze({ idempotent:false, resumed:true, context:changed, owner:'D11_TEACHING_CONTROLLER' });
  }

  async function recordStudentTechnicalIssue(user, classId, input = {}) {
    const key = requireIdempotencyKey(input.idempotencyKey, 'd25-student-technical-issue');
    const recorded = await foundation.d14.service.signal(user, classId, { kind:'TECHNICAL_ISSUE', body:input.message || null, idempotencyKey:key });
    return Object.freeze({ ...recorded, protected:true, academicPenaltyAllowed:false, controllerMutation:false, message:protectedFailureMessage(SYSTEM_FAILURE_KIND.NETWORK) });
  }

  async function assessmentStartReadiness(user, assessmentId, packageId) {
    const sid = String(user?.id || '');
    if (!sid) throw fail('Authenticated student is required.', 'TEACHING_D25_AUTH_REQUIRED', 401);
    const pack = await foundation.d17.repository.packageById(sid, String(packageId || ''));
    if (!pack || String(pack.assessment_id) !== String(assessmentId)) throw fail('Assessment Package does not belong to this Assessment.', 'TEACHING_D25_PACKAGE_MISMATCH', 409);
    const items = await foundation.d17.repository.packageItems(sid, pack.assessment_package_id);
    const readiness = packageStartReadiness(pack, items);
    if (!readiness.ready) throw fail('Assessment start blocked because the locked package did not pass the D25 reliability gate.', 'TEACHING_D25_PACKAGE_START_BLOCKED', 409, { reasons:readiness.reasons, studentMessage:protectedFailureMessage(SYSTEM_FAILURE_KIND.PACKAGE_VALIDATION) });
    return Object.freeze({ ready:true, packageId:pack.assessment_package_id, packageHash:pack.package_hash, reasons:readiness.reasons });
  }

  async function startAssessmentAttempt(user, assessmentId, input = {}) {
    await assessmentStartReadiness(user, assessmentId, input.packageId);
    return foundation.d17.service.startAttempt(user, assessmentId, input);
  }

  async function saveAssessmentResponse(user, attemptId, input = {}) {
    const key = requireIdempotencyKey(input.idempotencyKey, 'd25-assessment-response');
    return foundation.d17.service.saveResponse(user, attemptId, { ...input, idempotencyKey:key });
  }

  async function submitAssessmentAttempt(user, attemptId, input = {}) {
    const key = requireIdempotencyKey(input.idempotencyKey || `d25-final-submit:${attemptId}`, 'd25-final-submit');
    return foundation.d17.service.submit(user, attemptId, { ...input, idempotencyKey:key });
  }

  async function transferAssessmentDevice(user, attemptId, input = {}) {
    const deviceId = String(input.deviceId || '').trim();
    if (!deviceId) throw fail('New device ID is required.', 'TEACHING_D25_DEVICE_REQUIRED', 400);
    const attempt = await foundation.d17.repository.requireAttempt(String(user.id), String(attemptId));
    if (attempt.attempt_state !== 'ACTIVE') throw fail('Only an active Assessment Attempt can transfer devices.', 'TEACHING_D25_DEVICE_TRANSFER_STATE_INVALID', 409);
    if (String(attempt.active_device_id || '') === deviceId) return Object.freeze({ attempt, idempotent:true, transferred:false });
    const key = requireIdempotencyKey(input.idempotencyKey || `d25-device-transfer:${attemptId}:${deviceId}`, 'd25-device-transfer');
    const result = await foundation.d17.service.transferDevice(user, attemptId, { ...input, deviceId, idempotencyKey:key });
    return Object.freeze({ ...result, idempotent:false, transferred:true });
  }

  async function assessmentRecovery(user, attemptId, { deviceId = null, connected = true, localDraftPresent = false } = {}) {
    const workspace = await d18.getAttemptWorkspace(user, attemptId, { deviceId });
    const timer = timerProjection({ expiresAt:workspace.attempt.expires_at, serverNow:workspace.serverNow, connected });
    const latestVersion = Math.max(0, ...(workspace.responses || []).map((row) => Number(row.response_version || 0)));
    const sync = syncProjection({ connected, localDraft:Boolean(localDraftPresent), serverAcknowledgedVersion:latestVersion, readOnly:workspace.attempt.read_only, conflict:workspace.attempt.device_authority === 'MISMATCH' });
    return Object.freeze({ ...workspace, recovery:Object.freeze({ timer, sync, sourceOfTruth:'D17_ASSESSMENT_ATTEMPT', localDraftAuthoritative:false, clientTimestampAuthoritative:false, protectedMessage:connected ? null : protectedFailureMessage(SYSTEM_FAILURE_KIND.NETWORK) }) });
  }

  async function restoreAssignment(user, assignmentId) {
    const assignment = await foundation.d16.service.getAssignment(user, assignmentId);
    return Object.freeze({ assignment, recovery:Object.freeze({ sourceOfTruth:'D16_WORK', authoritativeDraftVersion:assignment.submission?.kind === 'DRAFT' ? assignment.submission.version : null, browserRecoveryDraftAuthoritative:false, localDraftMayBeRestoredForEditingOnly:true }) });
  }

  async function retryOwnerOperation({ operationName, idempotencyKey, execute, revalidate = null, maxAttempts = 2, delay = {} } = {}) {
    if (typeof execute !== 'function') throw new TypeError('D25 retryOwnerOperation requires execute().');
    const key = requireIdempotencyKey(idempotencyKey, `d25-${operationName || 'owner-operation'}`);
    const limit = Math.max(1, Math.min(3, Number(maxAttempts) || 1));
    let lastError = null;
    for (let attempt = 1; attempt <= limit; attempt += 1) {
      try {
        const value = await execute({ idempotencyKey:key, attempt });
        return Object.freeze({ value, attempts:attempt, idempotencyKey:key, recovered:attempt > 1, alreadyApplied:false });
      } catch (error) {
        lastError = error;
        if (typeof revalidate === 'function') {
          const state = await revalidate({ idempotencyKey:key, error, attempt });
          if (state?.applied === true) return Object.freeze({ value:state.value ?? null, attempts:attempt, idempotencyKey:key, recovered:true, alreadyApplied:true });
        }
        if (!isTransientFailure(error) || attempt >= limit) throw error;
        await sleep(retryDelayMs(attempt, delay));
      }
    }
    throw lastError;
  }

  async function runTeacherOperationWithRecovery({ user, classId, operationName='teacher-operation', idempotencyKey, execute, simplerFallback=null, expectedVersion=null, failureKind=SYSTEM_FAILURE_KIND.AI_TIMEOUT } = {}) {
    if (typeof execute !== 'function') throw new TypeError('D25 teacher recovery requires the existing orchestrated execute() function.');
    const key = requireIdempotencyKey(idempotencyKey, `d25-${operationName}`);
    try {
      const value = await retryOwnerOperation({ operationName, idempotencyKey:key, execute, maxAttempts:2 });
      return Object.freeze({ state:'PRIMARY_COMPLETED', ...value, directProviderCall:false });
    } catch (primaryError) {
      if (!isTransientFailure(primaryError)) throw primaryError;
      if (typeof simplerFallback === 'function') {
        try {
          const fallback = await simplerFallback({ idempotencyKey:`${key}:simpler`, sourceFailureCode:primaryError.code || null });
          return Object.freeze({ state:'SIMPLER_REPRESENTATION', value:fallback, directProviderCall:false, systemProtected:false });
        } catch (fallbackError) {
          if (!isTransientFailure(fallbackError)) throw fallbackError;
        }
      }
      const protectedState = await protectClassInterruption(user, classId, { expectedVersion, idempotencyKey:`${key}:protected-interruption`, failureKind });
      return Object.freeze({ state:'PROTECTED_INTERRUPTION', protectedState, directProviderCall:false, systemProtected:true });
    }
  }

  function status() {
    return Object.freeze({ contractVersion:'d25.reliability.v1', serverNow:now().toISOString(), ownerPreserving:true, localDraftsAreNotAcademicTruth:true, centralAiOrchestratorOwnsModelRetryAndFallback:true, noStudentPenaltyForKiwiFailure:true, d26RecoveryCaseOwnershipClaimed:false });
  }

  return Object.freeze({ restoreClass, protectClassInterruption, resumeProtectedClass, recordStudentTechnicalIssue, assessmentStartReadiness, startAssessmentAttempt, saveAssessmentResponse, submitAssessmentAttempt, transferAssessmentDevice, assessmentRecovery, restoreAssignment, retryOwnerOperation, runTeacherOperationWithRecovery, status });
}

module.exports = { createD25ReliabilityService };
