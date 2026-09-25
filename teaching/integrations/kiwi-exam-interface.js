'use strict';

const KIWI_EXAM_INTERFACE_VERSION = '1.0';

function createKiwiExamInterface() {
  return Object.freeze({
    version: KIWI_EXAM_INTERFACE_VERSION,
    owner: 'kiwi-exam',
    surface: 'existing-cbt-interface',
    mainAppPath: '/',
    configurationRoute: 'exam-config',
    activeExamRoute: 'exam',
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
  createKiwiExamInterface,
};
