'use strict';

const KIWI_EXAM_INTERFACE_VERSION = '1.2';
const SHARED_ASSESSMENT_SHELL_CONTRACT_VERSION = 'd18.v1';

function createKiwiExamInterface() {
  return Object.freeze({
    version: KIWI_EXAM_INTERFACE_VERSION,
    owner: 'kiwi-exam',
    surface: 'existing-cbt-interface',
    mainAppPath: '/',
    configurationRoute: 'exam-config',
    activeExamRoute: 'exam',
    assessmentShell: Object.freeze({
      contractVersion: SHARED_ASSESSMENT_SHELL_CONTRACT_VERSION,
      owner: 'assessment-domain',
      rendererOwner: 'shared-assessment-shell',
      shellPath: '/assessment-shell.html',
      supportedArchitectures: Object.freeze(['mcq_only','constructed_only','mixed']),
      supportedRenderers: Object.freeze(['mcq','short','extended','multi_part','math_working','numeric_unit','essay','source_layout','code','visual_reserved']),
      responsePayload: Object.freeze({ format:'typed-renderer-json', serverAutosaveRequired:true, localDraftRequired:true, localDraftAuthoritative:false }),
      timing: Object.freeze({ serverTimestampsAuthoritative:true, browserTimerProjectionOnly:true }),
      package: Object.freeze({ lockedBeforeExposure:true, browserMayNotChangeScope:true, browserMayNotChangeResponseArchitecture:true }),
      device: Object.freeze({ oneAuthoritativeWriter:true, explicitTransferRequired:true }),
      compatibility: Object.freeze({ existingKiwiExamDataRewritten:false, legacyExamOwnerPreserved:true, d18RendererImplementationDeferred:false }),
    }),
    buildAssessmentShellHandoff({ assessmentId, packageId, attemptId = null, returnPath = '/teaching.html' } = {}) {
      if (!assessmentId || !packageId) throw new TypeError('Assessment Shell handoff requires assessmentId and packageId.');
      const query = new URLSearchParams({ assessmentId:String(assessmentId), packageId:String(packageId), returnPath:String(returnPath) });
      if (attemptId != null) query.set('attemptId', String(attemptId));
      return Object.freeze({
        interfaceVersion:KIWI_EXAM_INTERFACE_VERSION,
        contractVersion:SHARED_ASSESSMENT_SHELL_CONTRACT_VERSION,
        owner:'assessment-domain',
        targetAppPath:`/assessment-shell.html?${query.toString()}`,
        targetRoute:'assessment-shell',
        assessmentId:String(assessmentId),
        packageId:String(packageId),
        attemptId:attemptId==null?null:String(attemptId),
        returnPath:String(returnPath),
      });
    },
    buildHandoff({ subjectId = null, returnPath = '/teaching.html', contextRef = null } = {}) {
      return Object.freeze({
        interfaceVersion: KIWI_EXAM_INTERFACE_VERSION,
        owner: 'kiwi-exam',
        targetAppPath: '/',
        targetRoute: 'exam-config',
        subjectId: subjectId == null ? null : String(subjectId),
        returnPath: String(returnPath),
        contextRef: contextRef == null ? null : String(contextRef),
      });
    },
  });
}

module.exports = {
  KIWI_EXAM_INTERFACE_VERSION,
  SHARED_ASSESSMENT_SHELL_CONTRACT_VERSION,
  createKiwiExamInterface,
};
