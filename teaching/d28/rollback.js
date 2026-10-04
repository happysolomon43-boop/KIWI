'use strict';

const { text, freeze } = require('./contracts');

const ACADEMIC_HISTORY_CLASSES = Object.freeze(new Set(['GRADEBOOK','EVIDENCE','AUDIT','ASSESSMENT_ATTEMPT','ASSESSMENT_RESULT','ATTENDANCE','PROGRESSION']));

function rollbackDisposition({ artifactClass, studentFacing=true, academicEvidenceExists=false, requestedAction='SUPPRESS' }={}){
  const cls=text(artifactClass,'artifactClass',100).toUpperCase();
  const action=text(requestedAction,'requestedAction',100).toUpperCase();
  if (academicEvidenceExists || ACADEMIC_HISTORY_CLASSES.has(cls)) {
    return freeze({ allowed: action === 'SUPPRESS', action:'SUPPRESS', physicalDeleteAllowed:false, academicHistoryPreserved:true, studentFacingSuppressed:Boolean(studentFacing), reason:'ACADEMIC_HISTORY_MUST_BE_PRESERVED' });
  }
  if (action === 'DELETE') return freeze({ allowed:true, action:'DELETE', physicalDeleteAllowed:true, academicHistoryPreserved:true, studentFacingSuppressed:true, reason:'NON_ACADEMIC_EPHEMERAL_ARTIFACT' });
  return freeze({ allowed:true, action:'SUPPRESS', physicalDeleteAllowed:false, academicHistoryPreserved:true, studentFacingSuppressed:Boolean(studentFacing), reason:'SAFE_REVERSIBLE_ROLLBACK' });
}

module.exports={ACADEMIC_HISTORY_CLASSES,rollbackDisposition};
