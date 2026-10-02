'use strict';

const KIWI_EXAM_INTERFACE_VERSION = '1.1';
const SHARED_ASSESSMENT_SHELL_CONTRACT_VERSION = 'd17.v1';

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
      supportedArchitectures: Object.freeze(['mcq_only','constructed_only','mixed']),
      responsePayload: Object.freeze({ format:'typed-renderer-json', serverAutosaveRequired:true, localDraftRequired:true, localDraftAuthoritative:false }),
      timing: Object.freeze({ serverTimestampsAuthoritative:true, browserTimerProjectionOnly:true }),
      package: Object.freeze({ lockedBeforeExposure:true, browserMayNotChangeScope:true, browserMayNotChangeResponseArchitecture:true }),
      compatibility: Object.freeze({ existingKiwiExamDataRewritten:false, legacyExamOwnerPreserved:true, d18RendererImplementationDeferred:true }),
    }),
    buildAssessmentShellHandoff({ assessmentId, packageId, attemptId = null, returnPath = '/teaching.html' } = {}) {
      if (!assessmentId || !packageId) throw new TypeError('Assessment Shell handoff requires assessmentId and packageId.');
      return Object.freeze({ interfaceVersion:KIWI_EXAM_INTERFACE_VERSION, contractVersion:SHARED_ASSESSMENT_SHELL_CONTRACT_VERSION, owner:'assessment-domain', targetAppPath:'/', targetRoute:'assessment-shell', assessmentId:String(assessmentId), packageId:String(packageId), attemptId:attemptId==null?null:String(attemptId), returnPath:String(returnPath) });
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
