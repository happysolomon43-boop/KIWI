'use strict';

const TPF02_MERGE_COMPRESSION_PATCH_SCHEMA_ID = 'tpf02.merge-compression-patch';
const TPF02_MERGE_COMPRESSION_PATCH_SCHEMA_VERSION = '1';
const TPF02_MERGE_COMPRESSION_PATCH_FIELDS = Object.freeze([
  'input_state_reference',
  'task_mode',
  'execution_stage',
  'merge_groups',
  'unresolved_reason',
  'required_next_input_or_review',
  'review_required',
]);
const TPF02_MERGE_COMPRESSION_GROUP_FIELDS = Object.freeze([
  'type',
  'affected_unit_refs',
  'continuity_unit_ref',
  'title',
  'intended_competence',
  'dependency_type_notes',
  'criticality',
  'criticality_basis',
  'proposed_exit_evidence',
  'uncertainties',
  'reason',
]);

const CRITICALITY = new Set(['foundational','major','supporting','enrichment','unresolved']);
const MERGE_TYPES = new Set(['merge','compress']);

function isObject(value){return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function isString(value){return typeof value==='string'&&value.trim().length>0;}
function nullableString(value){return value==null||typeof value==='string';}
function bool(value){return typeof value==='boolean';}
function stringArray(value){return Array.isArray(value)&&value.every((item)=>isString(item));}
function uniqueStringArray(value){return stringArray(value)&&new Set(value).size===value.length;}
function exactObjectFields(value,fields){
  const actual=Object.keys(value||{}).sort();
  const expected=[...fields].sort();
  return actual.length===expected.length&&!actual.some((key,index)=>key!==expected[index]);
}
function valid(value){return Object.freeze({ok:true,value});}
function invalid(reason){return Object.freeze({ok:false,reason});}
function uniqueStrings(values=[]){return [...new Set((values||[]).map((item)=>String(item||'').trim()).filter(Boolean))];}
function sameStringSet(left=[],right=[]){
  const a=new Set((left||[]).map(String)),b=new Set((right||[]).map(String));
  if(a.size!==b.size)return false;
  for(const item of a)if(!b.has(item))return false;
  return true;
}
function cloneUnit(unit){
  return {
    ...unit,
    source_item_refs:[...(unit.source_item_refs||[])],
    topic_refs:[...(unit.topic_refs||[])],
    prerequisite_refs:[...(unit.prerequisite_refs||[])],
    gap_refs:[...(unit.gap_refs||[])],
    uncertainties:[...(unit.uncertainties||[])],
  };
}

function validateTpf02MergeCompressionPatchSchema(output){
  if(!isObject(output))return invalid('TPF02_MERGE_COMPRESSION_PATCH_OBJECT_REQUIRED');
  if(!exactObjectFields(output,TPF02_MERGE_COMPRESSION_PATCH_FIELDS))return invalid('TPF02_MERGE_COMPRESSION_PATCH_TOP_LEVEL_CONTRACT_MISMATCH');
  if(!isString(output.input_state_reference))return invalid('TPF02_MERGE_COMPRESSION_PATCH_STATE_REFERENCE_REQUIRED');
  if(output.task_mode!=='MERGE_OR_COMPRESS_UNITS')return invalid('TPF02_MERGE_COMPRESSION_PATCH_TASK_MODE_INVALID');
  if(output.execution_stage!=='SINGLE_PASS')return invalid('TPF02_MERGE_COMPRESSION_PATCH_STAGE_INVALID');
  if(!Array.isArray(output.merge_groups))return invalid('TPF02_MERGE_COMPRESSION_PATCH_GROUPS_REQUIRED');
  if(output.merge_groups.length>20)return invalid('TPF02_MERGE_COMPRESSION_PATCH_TOO_MANY_GROUPS');
  if(!nullableString(output.unresolved_reason)||!nullableString(output.required_next_input_or_review)||!bool(output.review_required)){
    return invalid('TPF02_MERGE_COMPRESSION_PATCH_REVIEW_STATE_INVALID');
  }

  for(const [index,group] of output.merge_groups.entries()){
    if(!isObject(group)||!exactObjectFields(group,TPF02_MERGE_COMPRESSION_GROUP_FIELDS))return invalid(`TPF02_MERGE_COMPRESSION_GROUP_CONTRACT_INVALID:${index}`);
    if(!MERGE_TYPES.has(group.type)||!uniqueStringArray(group.affected_unit_refs)||group.affected_unit_refs.length<2||group.affected_unit_refs.length>8){
      return invalid(`TPF02_MERGE_COMPRESSION_GROUP_SCOPE_INVALID:${index}`);
    }
    if(!isString(group.continuity_unit_ref)||!group.affected_unit_refs.includes(group.continuity_unit_ref)){
      return invalid(`TPF02_MERGE_COMPRESSION_GROUP_CONTINUITY_INVALID:${index}`);
    }
    if(!isString(group.title)||!isString(group.intended_competence)||!nullableString(group.dependency_type_notes)
      ||!CRITICALITY.has(group.criticality)||!isString(group.criticality_basis)||!isString(group.proposed_exit_evidence)
      ||!stringArray(group.uncertainties)||!isString(group.reason)){
      return invalid(`TPF02_MERGE_COMPRESSION_GROUP_CONTENT_INVALID:${index}`);
    }
  }

  if(output.merge_groups.length){
    if(output.unresolved_reason!==null||output.required_next_input_or_review!==null||output.review_required!==false){
      return invalid('TPF02_MERGE_COMPRESSION_PATCH_SUCCESS_REVIEW_STATE_INVALID');
    }
  }else{
    if(!isString(output.unresolved_reason)||!isString(output.required_next_input_or_review)||output.review_required!==true){
      return invalid('TPF02_MERGE_COMPRESSION_PATCH_NO_CHANGE_DETAIL_REQUIRED');
    }
  }
  return valid(output);
}

function isMergeCompressionChangeRequest(changeRequest){
  const value=String(changeRequest||'').trim().toLowerCase();
  if(!value)return false;
  if(/\b(merge|merged|merging|combine|combined|combining|consolidate|consolidated|compress|compression)\b/.test(value))return true;
  const reduction=/\b(reduce|reduced|reducing|fewer|too many|too much|less|shorter)\b/.test(value);
  const structure=/\b(learning\s*units?|units?|course\s*analysis|structure|granularity)\b/.test(value);
  return reduction&&structure;
}

function buildMergeCompressionContext({changeRequest=null,previousAudit=null}={}){
  const request=String(changeRequest||'').trim().slice(0,1500);
  const current=previousAudit?.audit_output&&typeof previousAudit.audit_output==='object'
    ? previousAudit.audit_output
    : null;
  if(!request){
    const error=new Error('A Course analysis merge/compression request is required.');
    error.code='TEACHING_D07_MERGE_COMPRESSION_REQUEST_REQUIRED';
    throw error;
  }
  if(!current){
    const error=new Error('A validated Course analysis is required before merge/compression.');
    error.code='TEACHING_D07_MERGE_COMPRESSION_REQUIRES_CURRENT';
    throw error;
  }

  return Object.freeze({
    mode:'STUDENT_DIRECTED_MERGE_COMPRESSION',
    student_request:request,
    previous_audit_id:previousAudit?.curriculum_audit_id||null,
    previous_audit_version:previousAudit?.audit_version==null?null:Number(previousAudit.audit_version),
    current_topics:Object.freeze((current.topics||[]).map((topic)=>Object.freeze({
      topic_id:String(topic.topic_id),
      title:String(topic.title),
      subtopics:Object.freeze((topic.subtopics||[]).map((subtopic)=>Object.freeze({
        subtopic_id:String(subtopic.subtopic_id),
        title:String(subtopic.title),
      }))),
    }))),
    // The model needs the academic outline to identify defensible merge
    // candidates. Full lineage, prerequisites, gaps, and uncertainty arrays
    // remain runtime-owned and are reassembled from baseOutput after the patch.
    // Keeping those fields out of the request prevents large validated audits
    // from failing the 64 KiB academic-input boundary before execution.
    current_learning_units:Object.freeze((current.learning_units||[]).map((unit)=>Object.freeze({
      learning_unit_id:String(unit.learning_unit_id),
      title:String(unit.title),
      intended_competence:String(unit.intended_competence),
      topic_refs:Object.freeze([...(unit.topic_refs||[])]),
      subtopic_id:unit.subtopic_id==null?null:String(unit.subtopic_id),
      source_ref_count:(unit.source_item_refs||[]).length,
      criticality:String(unit.criticality),
      proposed_exit_evidence:String(unit.proposed_exit_evidence),
    }))),
    source_inventory_context:Object.freeze((()=>{
      const scopeCounts={};
      const validityCounts={};
      for(const item of current.source_inventory||[]){
        const scope=String(item?.proposed_scope_classification||'unknown');
        const validity=String(item?.content_validity_status||'unknown');
        scopeCounts[scope]=(scopeCounts[scope]||0)+1;
        validityCounts[validity]=(validityCounts[validity]||0)+1;
      }
      return {
        total_source_count:(current.source_inventory||[]).length,
        scope_classification_counts:Object.freeze({...scopeCounts}),
        content_validity_counts:Object.freeze({...validityCounts}),
      };
    })()),
    existing_assumed_prerequisite_refs:Object.freeze((current.assumed_prerequisites||[]).map((item)=>String(item.assumed_prerequisite_id))),
    existing_gap_refs:Object.freeze((current.coverage_gaps||[]).map((item)=>String(item.gap_id))),
  });
}

function validateMergeCompressionPatch(output,{academicInput,baseOutput}={}){
  const schema=validateTpf02MergeCompressionPatchSchema(output);
  if(!schema.ok)return schema;
  if(output.input_state_reference!==academicInput?.input_state_reference)return invalid('TPF02_MERGE_COMPRESSION_STATE_REFERENCE_MISMATCH');
  if(!output.merge_groups.length)return invalid('TPF02_MERGE_COMPRESSION_NO_DEFENSIBLE_CHANGE');

  const unitById=new Map((baseOutput?.learning_units||[]).map((unit)=>[String(unit.learning_unit_id),unit]));
  const claimed=new Set();
  for(const group of output.merge_groups){
    const ids=group.affected_unit_refs.map(String);
    for(const id of ids){
      if(claimed.has(id))return invalid('TPF02_MERGE_COMPRESSION_OVERLAPPING_GROUPS');
      claimed.add(id);
      if(!unitById.has(id))return invalid('TPF02_MERGE_COMPRESSION_UNIT_UNKNOWN');
    }
    const units=ids.map((id)=>unitById.get(id));
    const first=units[0];
    if(units.some((unit)=>!sameStringSet(unit.topic_refs,first.topic_refs)||String(unit.subtopic_id??'')!==String(first.subtopic_id??''))){
      return invalid('TPF02_MERGE_COMPRESSION_PLACEMENT_MISMATCH');
    }
    const sourceUnion=uniqueStrings(units.flatMap((unit)=>unit.source_item_refs||[]));
    if(!sourceUnion.length)return invalid('TPF02_MERGE_COMPRESSION_SOURCE_LINEAGE_EMPTY');
    if(String(group.reason||'').trim().length<12)return invalid('TPF02_MERGE_COMPRESSION_REASON_TOO_THIN');
  }
  return valid(output);
}

function applyMergeCompressionPatch(baseOutput,patch){
  const originalUnits=(baseOutput?.learning_units||[]).map(cloneUnit);
  const unitById=new Map(originalUnits.map((unit)=>[String(unit.learning_unit_id),unit]));
  const replacedBy=new Map();
  const groupByContinuity=new Map();

  for(const group of patch.merge_groups||[]){
    const continuity=String(group.continuity_unit_ref);
    groupByContinuity.set(continuity,group);
    for(const id of group.affected_unit_refs)replacedBy.set(String(id),continuity);
  }

  const mergedUnits=[];
  const proposals=[...(baseOutput.structure_change_proposals||[])];
  for(const unit of originalUnits){
    const id=String(unit.learning_unit_id);
    const continuity=replacedBy.get(id);
    if(!continuity){
      mergedUnits.push(unit);
      continue;
    }
    if(continuity!==id)continue;

    const group=groupByContinuity.get(id);
    const members=group.affected_unit_refs.map((ref)=>unitById.get(String(ref)));
    const memberIds=new Set(group.affected_unit_refs.map(String));
    const sourceRefs=uniqueStrings(members.flatMap((item)=>item.source_item_refs||[]));
    const prereqs=uniqueStrings(members.flatMap((item)=>item.prerequisite_refs||[])).filter((ref)=>!memberIds.has(String(ref)));
    const gaps=uniqueStrings(members.flatMap((item)=>item.gap_refs||[]));
    const inheritedUncertainties=uniqueStrings(members.flatMap((item)=>item.uncertainties||[]));

    mergedUnits.push({
      learning_unit_id:id,
      title:String(group.title),
      intended_competence:String(group.intended_competence),
      source_item_refs:sourceRefs,
      topic_refs:[...(unit.topic_refs||[])],
      subtopic_id:unit.subtopic_id==null?null:String(unit.subtopic_id),
      prerequisite_refs:prereqs,
      dependency_type_notes:group.dependency_type_notes==null?null:String(group.dependency_type_notes),
      criticality:String(group.criticality),
      criticality_basis:String(group.criticality_basis),
      proposed_exit_evidence:String(group.proposed_exit_evidence),
      gap_refs:gaps,
      uncertainties:uniqueStrings([...inheritedUncertainties,...(group.uncertainties||[])]),
    });

    proposals.push({
      type:String(group.type),
      affected_unit_refs:[...group.affected_unit_refs],
      resulting_unit_refs:[id],
      source_item_refs_before:sourceRefs,
      source_item_refs_after:sourceRefs,
      proposal:`${group.type==='compress'?'Compress':'Merge'} ${group.affected_unit_refs.join(', ')} into ${id} while preserving required source lineage.`,
      reason:String(group.reason),
    });
  }

  const rewritten=mergedUnits.map((unit)=>{
    const self=String(unit.learning_unit_id);
    const prerequisite_refs=uniqueStrings((unit.prerequisite_refs||[]).map((ref)=>replacedBy.get(String(ref))||String(ref))).filter((ref)=>ref!==self);
    return {...unit,prerequisite_refs};
  });

  return {
    ...baseOutput,
    topics:(baseOutput.topics||[]).map((topic)=>({
      ...topic,
      source_item_refs:[...(topic.source_item_refs||[])],
      subtopics:(topic.subtopics||[]).map((subtopic)=>({...subtopic})),
    })),
    learning_units:rewritten,
    assumed_prerequisites:(baseOutput.assumed_prerequisites||[]).map((item)=>({...item})),
    source_conflicts:(baseOutput.source_conflicts||[]).map((item)=>({...item,source_item_refs:[...(item.source_item_refs||[])]})),
    coverage_gaps:(baseOutput.coverage_gaps||[]).map((item)=>({...item,source_item_refs:[...(item.source_item_refs||[])]})),
    structure_change_proposals:proposals,
    unresolved_items:(baseOutput.unresolved_items||[]).map((item)=>({...item,source_item_refs:[...(item.source_item_refs||[])]})),
    review_reasons:[...(baseOutput.review_reasons||[])],
    student_facing_summary_candidate:null,
  };
}

const STRING=Object.freeze({type:'string'});
const NULLABLE_STRING=Object.freeze({type:'string',nullable:true});
const BOOLEAN=Object.freeze({type:'boolean'});
const STRING_ARRAY=Object.freeze({type:'array',items:STRING});
const MERGE_GROUP_SCHEMA=Object.freeze({
  type:'object',
  properties:Object.freeze({
    type:Object.freeze({type:'string',enum:Object.freeze(['merge','compress'])}),
    affected_unit_refs:STRING_ARRAY,
    continuity_unit_ref:STRING,
    title:STRING,
    intended_competence:STRING,
    dependency_type_notes:NULLABLE_STRING,
    criticality:Object.freeze({type:'string',enum:Object.freeze(['foundational','major','supporting','enrichment','unresolved'])}),
    criticality_basis:STRING,
    proposed_exit_evidence:STRING,
    uncertainties:STRING_ARRAY,
    reason:STRING,
  }),
  required:TPF02_MERGE_COMPRESSION_GROUP_FIELDS,
  propertyOrdering:TPF02_MERGE_COMPRESSION_GROUP_FIELDS,
});
const TPF02_MERGE_COMPRESSION_PATCH_RESPONSE_SCHEMA=Object.freeze({
  type:'object',
  properties:Object.freeze({
    input_state_reference:STRING,
    task_mode:Object.freeze({type:'string',enum:Object.freeze(['MERGE_OR_COMPRESS_UNITS'])}),
    execution_stage:Object.freeze({type:'string',enum:Object.freeze(['SINGLE_PASS'])}),
    merge_groups:Object.freeze({type:'array',items:MERGE_GROUP_SCHEMA,maxItems:20}),
    unresolved_reason:NULLABLE_STRING,
    required_next_input_or_review:NULLABLE_STRING,
    review_required:BOOLEAN,
  }),
  required:TPF02_MERGE_COMPRESSION_PATCH_FIELDS,
  propertyOrdering:TPF02_MERGE_COMPRESSION_PATCH_FIELDS,
});

module.exports={
  TPF02_MERGE_COMPRESSION_PATCH_SCHEMA_ID,
  TPF02_MERGE_COMPRESSION_PATCH_SCHEMA_VERSION,
  TPF02_MERGE_COMPRESSION_PATCH_FIELDS,
  TPF02_MERGE_COMPRESSION_PATCH_RESPONSE_SCHEMA,
  validateTpf02MergeCompressionPatchSchema,
  isMergeCompressionChangeRequest,
  buildMergeCompressionContext,
  validateMergeCompressionPatch,
  applyMergeCompressionPatch,
};
