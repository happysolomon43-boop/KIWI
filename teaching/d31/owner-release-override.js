'use strict';

const RELEASE_MODE_ENV = 'TEACHING_D31_AI_RELEASE_MODE';
const OWNER_OVERRIDE_MODE = 'OWNER_OVERRIDE_V1';
const OWNER_OVERRIDE_ID = 'KIWI_TEACHING_D31_OWNER_AI_RELEASE_AUTHORIZATION_V1';

const OWNER_OVERRIDE = Object.freeze({
  id: OWNER_OVERRIDE_ID,
  version: '1.0',
  authorizedAt: '2026-10-05',
  authorizedBy: 'PRODUCT_OWNER',
  changeControlDisposition: 'D31_OWNER_RELEASE_AUTHORIZATION_EXCEPTION',
  requestedAction: 'ENABLE_ALL_EXISTING_PRODUCTION_MOUNTED_TEACHING_AI_ROUTES_AND_FEATURES',
  qualificationAtAuthorization: 'INSUFFICIENT_EVIDENCE',
  releaseAuthorization: 'OWNER_OVERRIDE_ENABLED',
  productionQualifiedByOverride: false,
  preservesD30EvidenceTruth: true,
  preservesAcademicOwnerBoundaries: true,
  preservesCentralOrchestratorBoundary: true,
  preservesD28ExecutionControls: true,
  releaseModeEnv: RELEASE_MODE_ENV,
  releaseModeValue: OWNER_OVERRIDE_MODE,
});

function resolveOwnerReleaseAuthorization(env = process.env) {
  const configuredMode = String(env?.[RELEASE_MODE_ENV] || '').trim();
  const enabled = configuredMode === OWNER_OVERRIDE_MODE;
  return Object.freeze({
    amendmentId: OWNER_OVERRIDE_ID,
    enabled,
    configuredMode: configuredMode || null,
    releaseAuthorization: enabled ? 'OWNER_OVERRIDE_ENABLED' : 'HELD_FAIL_CLOSED',
    qualificationDisposition: 'PRESERVE_D30_EVIDENCE_STATE',
    productionQualifiedByOverride: false,
    rollback: `Unset ${RELEASE_MODE_ENV} or set it to any value other than ${OWNER_OVERRIDE_MODE}.`,
  });
}

module.exports = Object.freeze({
  RELEASE_MODE_ENV,
  OWNER_OVERRIDE_MODE,
  OWNER_OVERRIDE_ID,
  OWNER_OVERRIDE,
  resolveOwnerReleaseAuthorization,
});
