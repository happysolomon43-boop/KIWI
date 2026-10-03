'use strict';

const {createD20Service:createBaseD20Service}=require('./authority-service');
const {asArray,asObject,fail}=require('./contracts');

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.keys(value).sort().reduce((out,key)=>{out[key]=stable(value[key]);return out;},{});
  return value;
}
function stableJson(value){return JSON.stringify(stable(value));}
function itemId(value){return String(value?.package_item_id??value?.packageItemId??'');}
function responseVersion(value){return Number(value?.response_version??value?.responseVersion??0);}
function responsePayload(value){return value?.renderer_payload??value?.rendererPayload??null;}
function rubricFromItem(item){
  const protectedPayload=asObject(item?.protected_marking_payload??item?.protectedPayload);
  return asObject(protectedPayload.rubric||protectedPayload.rubric_contract||protectedPayload.mark_scheme||protectedPayload.markScheme);
}
function rubricCriteria(rubric){return asArray(rubric?.criteria||rubric?.rubric_contract?.criteria||rubric?.rubricContract?.criteria);}
function criterionId(criterion){return String(criterion?.criterion_id??criterion?.criterionId??'');}

function assertFinalSnapshotIntegrity(bundle){
  const context=asObject(bundle?.context),snapshot=asObject(context.final_snapshot),items=asArray(bundle?.items),responses=asArray(bundle?.responses);
  if(!['SUBMITTED','EXPIRED'].includes(String(context.attempt_state||''))){
    fail('D20 marking requires a submitted or expired authoritative Attempt.','TEACHING_D20_FINAL_SNAPSHOT_REQUIRED',409,{attemptState:context.attempt_state||null});
  }
  if(Number(context.finalization_version||0)<1||!String(context.final_snapshot_ref||'').trim()||!Array.isArray(snapshot.responses)){
    fail('D20 marking requires the authoritative D17 final response snapshot.','TEACHING_D20_FINAL_SNAPSHOT_REQUIRED',409,{attemptId:context.assessment_attempt_id||null});
  }
  if(context.attempt_result_state&&String(context.attempt_result_state)!=='AWAITING_MARKING'){
    fail('Assessment Attempt is not in the authoritative awaiting-marking state.','TEACHING_D20_FINAL_SNAPSHOT_REQUIRED',409,{resultState:context.attempt_result_state});
  }
  const allowedItems=new Set(items.map(itemId).filter(Boolean)),snapshotByItem=new Map(),currentByItem=new Map();
  for(const response of snapshot.responses){
    const id=itemId(response);
    if(!id||!allowedItems.has(id))fail('Final response snapshot contains an unknown Assessment item.','TEACHING_D20_RESPONSE_CAPTURE_INTEGRITY_VIOLATION',409,{packageItemId:id||null});
    if(snapshotByItem.has(id))fail('Final response snapshot contains duplicate item responses.','TEACHING_D20_RESPONSE_CAPTURE_INTEGRITY_VIOLATION',409,{packageItemId:id});
    snapshotByItem.set(id,response);
  }
  for(const response of responses){
    const id=itemId(response);
    if(!id||!allowedItems.has(id))fail('Current response store contains an unknown Assessment item.','TEACHING_D20_RESPONSE_CAPTURE_INTEGRITY_VIOLATION',409,{packageItemId:id||null});
    if(currentByItem.has(id))fail('D20 marking bundle contains duplicate latest responses.','TEACHING_D20_RESPONSE_CAPTURE_INTEGRITY_VIOLATION',409,{packageItemId:id});
    currentByItem.set(id,response);
  }
  const union=new Set([...snapshotByItem.keys(),...currentByItem.keys()]);
  for(const id of union){
    const frozen=snapshotByItem.get(id),current=currentByItem.get(id);
    if(!frozen||!current){
      fail('Authoritative final response evidence does not match the current captured response store.','TEACHING_D20_RESPONSE_CAPTURE_INTEGRITY_VIOLATION',409,{packageItemId:id,frozenPresent:Boolean(frozen),currentPresent:Boolean(current)});
    }
    if(responseVersion(frozen)!==responseVersion(current)||stableJson(responsePayload(frozen))!==stableJson(responsePayload(current))){
      fail('Authoritative final response evidence changed after finalization or is corrupted.','TEACHING_D20_RESPONSE_CAPTURE_INTEGRITY_VIOLATION',409,{packageItemId:id,frozenVersion:responseVersion(frozen),currentVersion:responseVersion(current)});
    }
  }
  return Object.freeze({captureIntegrity:'complete',finalSnapshotRef:String(context.final_snapshot_ref),responseCount:snapshotByItem.size});
}

function followThroughRule(criterion){
  const policy=String(criterion?.follow_through_policy??criterion?.followThroughPolicy??'not_applicable').toLowerCase();
  const conditions=asArray(criterion?.follow_through_conditions??criterion?.followThroughConditions);
  return {policy,conditions};
}
function assertFollowThroughAuthorized(rubric,judgments,{requireConditionalNote=false}={}){
  const criteria=new Map(rubricCriteria(rubric).map(c=>[criterionId(c),c]));
  for(const judgment of asArray(judgments)){
    if(!judgment?.follow_through_applied)continue;
    const id=String(judgment.criterion_id??judgment.criterionId??'');
    const criterion=criteria.get(id);
    if(!criterion)fail('Follow-through credit refers to a criterion outside the locked rubric.','TEACHING_D20_FOLLOW_THROUGH_NOT_AUTHORIZED',422,{criterionId:id});
    const rule=followThroughRule(criterion);
    if(!['allowed','conditional'].includes(rule.policy)){
      fail('Follow-through/error-carried-forward credit is not authorized by the locked rubric.','TEACHING_D20_FOLLOW_THROUGH_NOT_AUTHORIZED',422,{criterionId:id,policy:rule.policy});
    }
    if(rule.policy==='conditional'&&!rule.conditions.length){
      fail('Conditional follow-through requires predeclared locked-rubric conditions.','TEACHING_D20_FOLLOW_THROUGH_CONDITION_REQUIRED',422,{criterionId:id});
    }
    if(rule.policy==='conditional'&&requireConditionalNote&&!String(judgment.follow_through_note??judgment.followThroughNote??'').trim()){
      fail('Conditional follow-through requires an explicit rubric-grounded application note.','TEACHING_D20_FOLLOW_THROUGH_CONDITION_REQUIRED',422,{criterionId:id});
    }
  }
  return true;
}

function exactIds(values){return asArray(values).map(String).filter(Boolean);}
function assertExactCriterionCoverage(actualIds,expectedIds,code,details={}){
  const actual=exactIds(actualIds),expected=exactIds(expectedIds),actualSet=new Set(actual),expectedSet=new Set(expected);
  const duplicates=actual.filter((id,index)=>actual.indexOf(id)!==index);
  const missing=expected.filter(id=>!actualSet.has(id));
  const extra=actual.filter(id=>!expectedSet.has(id));
  if(duplicates.length||missing.length||extra.length){
    fail('Structured marking judgment does not exactly cover its authorized rubric scope.',code,422,{...details,duplicates:[...new Set(duplicates)],missing,extra});
  }
}
function acceptedOutput(result){return result?.accepted?(result?.validatedResult?.output||result?.output||null):null;}
function assertNoUnresolvedDeduction(output){
  for(const judgment of asArray(output?.criterion_judgments)){
    if(judgment?.negative_marking_trigger?.triggered===true){
      fail('A locked-rubric negative-marking trigger requires deterministic rule resolution before official aggregation.','TEACHING_D20_DEDUCTION_RESOLUTION_REQUIRED',409,{criterionId:String(judgment.criterion_id||''),ruleRef:judgment.negative_marking_trigger.rule_ref||null});
    }
  }
}
function assertTpf15Output(result,academicInput){
  const output=acceptedOutput(result);if(!output)return result;
  const context=asObject(academicInput?.marking_context||academicInput?.context),rubric=asObject(context.locked_rubric),status=String(output.marking_status||'').toLowerCase();
  const judgments=asArray(output.criterion_judgments),allCriterionIds=rubricCriteria(rubric).map(criterionId).filter(Boolean),authorized=exactIds(context.item_validity?.authorized_markable_criterion_ids);
  if(status==='markable'){
    assertExactCriterionCoverage(judgments.map(j=>j?.criterion_id),authorized.length?authorized:allCriterionIds,'TEACHING_D20_TPF15_CRITERION_COVERAGE_INVALID',{markingStatus:status});
  }else if(status==='partially_markable'){
    if(!authorized.length)fail('Partially markable TPF-15 output requires an authoritative markable-criterion scope.','TEACHING_D20_TPF15_AUTHORIZED_SCOPE_REQUIRED',409);
    assertExactCriterionCoverage(judgments.map(j=>j?.criterion_id),authorized,'TEACHING_D20_TPF15_CRITERION_COVERAGE_INVALID',{markingStatus:status});
    if(String(output.review_state||'ordinary')==='ordinary')fail('Partially markable work must remain in an explicit review/handoff state.','TEACHING_D20_TPF15_PARTIAL_REVIEW_REQUIRED',409);
  }else if(!['not_markable','moderation_required'].includes(status)){
    fail('TPF-15 returned an unknown or missing marking status.','TEACHING_D20_TPF15_MARKING_STATUS_INVALID',422,{markingStatus:status||null});
  }
  assertFollowThroughAuthorized(rubric,judgments,{requireConditionalNote:true});
  assertNoUnresolvedDeduction(output);
  return result;
}
function assertTpf16Scope(result,academicInput,stage){
  const output=acceptedOutput(result);if(!output)return result;
  const expected=exactIds(academicInput?.review_scope?.criterion_ids);if(!expected.length)return result;
  const rows=stage==='pass_a'?asArray(output.criterion_independent_judgments):asArray(output.criterion_reviews);
  assertExactCriterionCoverage(rows.map(j=>j?.criterion_id),expected,'TEACHING_D20_TPF16_SCOPE_COVERAGE_INVALID',{reviewStage:stage});
  return result;
}

function wrapIntelligence(intelligence){
  if(!intelligence)return null;
  const wrapped={...intelligence};
  for(const name of ['markConstructed','allocatePartialCredit','reviewAlternative']){
    if(typeof intelligence[name]==='function')wrapped[name]=async(args)=>assertTpf15Output(await intelligence[name](args),args?.academicInput);
  }
  for(const name of ['moderatePassA','appealPassA']){
    if(typeof intelligence[name]==='function')wrapped[name]=async(args)=>assertTpf16Scope(await intelligence[name](args),args?.academicInput,'pass_a');
  }
  for(const name of ['moderatePassB','appealPassB']){
    if(typeof intelligence[name]==='function')wrapped[name]=async(args)=>assertTpf16Scope(await intelligence[name](args),args?.academicInput,'pass_b');
  }
  return Object.freeze(wrapped);
}

function newestFirst(a,b){
  const aTime=Date.parse(a?.created_at||a?.frozen_at||0)||0,bTime=Date.parse(b?.created_at||b?.frozen_at||0)||0;
  if(aTime!==bTime)return bTime-aTime;
  return String(b?.marking_run_id||'').localeCompare(String(a?.marking_run_id||''));
}
function guardedRepository(repository){
  return new Proxy(repository,{
    get(target,property,receiver){
      if(property==='loadMarkingBundle')return async(...args)=>{const bundle=await target.loadMarkingBundle(...args);assertFinalSnapshotIntegrity(bundle);return bundle;};
      if(property==='runsForResult')return async(...args)=>{
        const rows=await target.runsForResult(...args),corrections=rows.filter(r=>r.run_kind==='AUTHORIZED_CORRECTION').sort(newestFirst),others=rows.filter(r=>r.run_kind!=='AUTHORIZED_CORRECTION');
        return [...corrections,...others];
      };
      if(property==='appendCriterionJudgments')return async(input)=>{
        const result=await target.resultById(input.studentId,input.resultId);if(!result)fail('Assessment Result not found while validating criterion persistence.','TEACHING_D20_RESULT_NOT_FOUND',404);
        const bundle=await target.loadMarkingBundle(input.studentId,result.assessment_attempt_id);assertFinalSnapshotIntegrity(bundle);
        const item=bundle.items.find(row=>String(row.package_item_id)===String(input.packageItemId));if(!item)fail('Criterion judgment item is outside the locked Assessment Package.','TEACHING_D20_CRITERION_OUT_OF_SCOPE',422,{packageItemId:input.packageItemId});
        assertFollowThroughAuthorized(rubricFromItem(item),input.judgments);
        return target.appendCriterionJudgments(input);
      };
      const value=Reflect.get(target,property,receiver);return typeof value==='function'?value.bind(target):value;
    },
  });
}

function createD20Service(options={}){
  if(!options.repository||typeof options.repository.loadMarkingBundle!=='function')throw new TypeError('Corrected D20 authority service requires the D20 Gradebook repository.');
  const repository=guardedRepository(options.repository),intelligence=wrapIntelligence(options.intelligence||null),service=createBaseD20Service({...options,repository,intelligence});
  return Object.freeze({...service,authorityBoundary:'D20_CORRECTIVE_ACADEMIC_GUARDS_V2'});
}

module.exports={
  createD20Service,createD20AuthorityService:createD20Service,
  assertFinalSnapshotIntegrity,assertFollowThroughAuthorized,assertTpf15Output,assertTpf16Scope,
  wrapIntelligence,guardedRepository,
};
