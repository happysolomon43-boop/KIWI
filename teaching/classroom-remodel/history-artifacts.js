'use strict';
// Owner-scoped history only exposes publication metadata; private D11 notes
// and TPF-20 candidates are never serialized to a student response.
const safeState=(value,known)=>known.includes(value)?value:'UNAVAILABLE';
function projectHistoryArtifacts(row){
 const sourceRefs=[
  ...(row.closure_fact_id?[`class-closure:${row.closure_fact_id}@${row.controller_version}`]:[]),
  ...(row.record_id&&row.content_hash?[`classroom-record:${row.record_id}@${row.content_hash}`]:[]),
 ];
 const stale=Boolean(row.record_id&&row.content_hash&&row.summary_state&&
   row.summary_provenance?.classroom_record_hash!==row.content_hash);
 const summaryState=!row.summary_state?'NOT_AVAILABLE':stale?'STALE_RECONCILIATION':
   safeState(row.summary_state,['TRANSLATED','ROUTE_HELD','REVIEW_NEEDED']);
 // TRANSLATED is a student-summary candidate, not a claim of
 // understanding, D27 publication or a newly scheduled follow-up.
 const summary={
  state:summaryState,
  version:summaryState==='TRANSLATED'&&Number.isSafeInteger(Number(row.summary_version))?Number(row.summary_version):null,
  source_refs:sourceRefs,
  available:summaryState==='TRANSLATED'&&row.summary_provenance?.translation_only===true,
 };
 const noteState=!row.note_state?'NOT_AVAILABLE':
   row.note_state==='VALIDATED_PRIVATE'?'PRIVATE_AWAITING_D27':
   safeState(row.note_state,['PREPARED_NOT_PUBLISHABLE','ROUTE_HELD','RECONCILIATION_HELD']);
 const studyNotes={state:noteState,version:noteState==='PRIVATE_AWAITING_D27'?Number(row.note_version):null,
  published:false,source_refs:sourceRefs};
 return {summary,study_notes:studyNotes};
}
module.exports={projectHistoryArtifacts};
