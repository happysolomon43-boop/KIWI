'use strict';

const SOURCE_QUERIES = Object.freeze({
  Assessment: Object.freeze({ table:'public.teaching_assessments', id:'assessment_id', version:'state_version' }),
  StudentKnowledgeState: Object.freeze({ table:'public.teaching_student_knowledge_state_versions', id:'knowledge_state_version_id', version:'version_no' }),
  GradebookEntry: Object.freeze({ table:'public.teaching_gradebook_entries', id:'gradebook_entry_id', version:'version_no' }),
  CourseResult: Object.freeze({ table:'public.teaching_course_result_snapshots', id:'course_result_snapshot_id', version:'version_no' }),
  Course: Object.freeze({ table:'public.teaching_courses', id:'course_id', version:'state_version' }),
  Class: Object.freeze({ table:'public.teaching_classes', id:'class_id', version:'schedule_version' }),
  Assignment: Object.freeze({ table:'public.teaching_assignments', id:'assignment_id', version:'state_version' }),
});

function createD27SourceVersionReader({ query } = {}) {
  if (typeof query !== 'function') throw new TypeError('D27 source version reader requires query().');
  return async function readSourceVersion(studentId, source) {
    const contract = SOURCE_QUERIES[String(source?.entityType || '')];
    if (!contract) {
      const error = new Error(`No D27 source-version contract exists for entity type ${String(source?.entityType || '')}.`);
      error.code = 'TEACHING_D27_SOURCE_TYPE_UNSUPPORTED';
      error.status = 409;
      throw error;
    }
    const sql = `SELECT ${contract.version} AS version FROM ${contract.table} WHERE student_id=$1 AND ${contract.id}=$2 LIMIT 1`;
    const { rows = [] } = await query(sql, [String(studentId),String(source.entityId)]);
    return rows[0] ? Object.freeze({ exists:true,version:String(rows[0].version) }) : Object.freeze({ exists:false,version:null });
  };
}

module.exports = { SOURCE_QUERIES, createD27SourceVersionReader };
