'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {projectHistoryArtifacts}=require('../../../teaching/classroom-remodel/history-artifacts');
const base={closure_fact_id:'closure',controller_version:3,record_id:'record',content_hash:'latest'};
test('student history never includes private summary or TPF-20 content and binds source refs',()=>{
 const value=projectHistoryArtifacts({...base,summary_state:'TRANSLATED',summary_version:2,summary_provenance:{classroom_record_hash:'latest',translation_only:true,private_prompt:'never'},note_state:'VALIDATED_PRIVATE',note_version:4,note_payload:{private_note:'never'}});
 assert.equal(value.summary.available,true);
 assert.equal(value.study_notes.state,'PRIVATE_AWAITING_D27');
 assert.equal(value.study_notes.published,false);
 assert.deepEqual(value.summary.source_refs,['class-closure:closure@3','classroom-record:record@latest']);
 assert.equal(JSON.stringify(value).includes('never'),false);
});
test('older summary is not treated as current after a late-evaluation record version',()=>{
 const value=projectHistoryArtifacts({...base,summary_state:'TRANSLATED',summary_version:1,summary_provenance:{classroom_record_hash:'older'}});
 assert.equal(value.summary.state,'STALE_RECONCILIATION');
 assert.equal(value.summary.available,false);
});
test('missing and unqualified historical artifacts remain truthful holds',()=>{
 const unknown=projectHistoryArtifacts({});
 assert.equal(unknown.summary.state,'NOT_AVAILABLE');
 assert.equal(unknown.study_notes.state,'NOT_AVAILABLE');
 const held=projectHistoryArtifacts({...base,summary_state:'ROUTE_HELD',note_state:'RECONCILIATION_HELD'});
 assert.equal(held.summary.available,false);
 assert.equal(held.study_notes.published,false);
});
