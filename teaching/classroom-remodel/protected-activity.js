'use strict';

const blocked = (code) => Object.assign(new Error('Protected activity requires an authoritative current owner binding.'), {code, status:409});
async function resolveProtectedActivity({query, studentId, classId, courseId, sessionId, mode, reference, lock=false}) {
  if (!reference || !['D16','D17'].includes(reference.owner) || typeof reference.id !== 'string' || !reference.id || !Number.isSafeInteger(reference.version) || reference.version < 1) throw blocked('CLASSROOM_PROTECTED_ACTIVITY_REQUIRED');
  if (!['CLASSWORK','ASSESSMENT'].includes(mode) || (mode === 'ASSESSMENT' && reference.owner !== 'D17')) throw blocked('CLASSROOM_PROTECTED_ACTIVITY_OWNER_MISMATCH');
  const assignment = reference.owner === 'D16';
  const table = assignment ? 'teaching_assignments' : 'teaching_assessments';
  const key = assignment ? 'assignment_id' : 'assessment_id';
  const {rows} = await query(`select * from public.${table} where student_id=$1 and ${key}=$2 and course_id=$3 ${lock?'for update':''}`, [studentId,reference.id,courseId]);
  const row=rows?.[0];
  const ownerClass=assignment?row?.source_class_id:row?.source_lineage?.d19_measurement?.intended_class_id;
  if (!row || String(ownerClass) !== String(classId) || Number(row.state_version) !== reference.version) throw blocked('CLASSROOM_PROTECTED_ACTIVITY_STALE');
  if (assignment ? !['OPEN','STARTED'].includes(row.lifecycle_state) || (row.orthogonal_conditions||[]).some(x=>['INVALIDATED','REPLACED','EXPIRED','PAUSED'].includes(x)) : row.definition_state !== 'READY' || (mode==='CLASSWORK' && row.assessment_type !== 'CLASSWORK')) throw blocked('CLASSROOM_PROTECTED_ACTIVITY_UNAVAILABLE');
  return Object.freeze({owner:reference.owner,id:reference.id,version:reference.version,classId,courseId,sessionId,mode});
}
module.exports={resolveProtectedActivity};
