'use strict';

const {createD20Service:createCoreD20Service}=require('./service');
const {
  deterministicAggregateCriteria,calculateCourseScore,roundConfigured,
  asObject,upper,stableUnique,fail,
}=require('./contracts');

const OBJECTIVE_FAMILIES=new Set(['MCQ','MULTIPLE_CHOICE','SINGLE_CHOICE','NUMERIC','NUMBER','NUMERIC_RESPONSE','SYMBOLIC','SYMBOLIC_RESPONSE','STRUCTURED_OBJECTIVE','STRUCTURED','CODE_TESTS','CODE_OBJECTIVE','PROGRAMMING_TESTS']);

function stableValue(value){if(Array.isArray(value))return value.map(stableValue);if(value&&typeof value==='object')return Object.keys(value).sort().reduce((out,key)=>{out[key]=stableValue(value[key]);return out;},{});return value;}
function samePayload(a,b){return JSON.stringify(stableValue(a))===JSON.stringify(stableValue(b));}
function assertAuthoritativeResponseCapture(bundle={}){
  const context=asObject(bundle.context),attemptState=upper(context.attempt_state),resultState=upper(context.attempt_result_state);
  if(!['SUBMITTED','EXPIRED'].includes(attemptState))fail('Formal marking requires a finalized authoritative Assessment Attempt.','TEACHING_D20_RESPONSE_CAPTURE_STATE_INVALID',409,{attemptState});
  if(resultState!=='AWAITING_MARKING')fail('Assessment Attempt is not in the authoritative awaiting-marking state.','TEACHING_D20_RESPONSE_CAPTURE_STATE_INVALID',409,{resultState});
  if(String(context.attempt_invalidation_reason||'').trim())fail('An invalidated Assessment Attempt cannot be treated as complete response evidence.','TEACHING_D20_RESPONSE_CAPTURE_COMPROMISED',409,{reason:context.attempt_invalidation_reason,handoffOwner:'D17_ASSESSMENT_VALIDITY'});
  const finalizationVersion=Number(context.finalization_version||0),snapshotRef=String(context.final_snapshot_ref||'').trim(),snapshot=asObject(context.final_snapshot);
  if(!Number.isInteger(finalizationVersion)||finalizationVersion<1||!snapshotRef||!Array.isArray(snapshot.responses))fail('Authoritative final-response snapshot is missing or unresolved.','TEACHING_D20_RESPONSE_CAPTURE_UNRESOLVED',409,{finalizationVersion,snapshotRef:snapshotRef||null,handoffOwner:'D17_ASSESSMENT_VALIDITY'});
  const finalizedBy=upper(snapshot.finalized_by);if(finalizedBy&&finalizedBy!==attemptState)fail('Final-response snapshot finalization mode does not match the authoritative Attempt state.','TEACHING_D20_RESPONSE_CAPTURE_CORRUPTED',409,{attemptState,finalizedBy,handoffOwner:'D17_ASSESSMENT_VALIDITY'});
  const items=Array.isArray(bundle.items)?bundle.items:[],itemIds=new Set(items.map(item=>String(item.package_item_id))),responses=Array.isArray(bundle.responses)?bundle.responses:[],latest=new Map();
  for(const response of responses){const itemId=String(response.package_item_id||'');if(!itemIds.has(itemId))fail('A persisted response points outside the locked Assessment Package.','TEACHING_D20_RESPONSE_CAPTURE_CORRUPTED',409,{packageItemId:itemId,handoffOwner:'D17_ASSESSMENT_VALIDITY'});latest.set(itemId,response);}
  const snapByItem=new Map();
  for(const entry of snapshot.responses){const itemId=String(entry?.package_item_id||'');if(!itemId||!itemIds.has(itemId))fail('Final-response snapshot contains an unknown Assessment item.','TEACHING_D20_RESPONSE_CAPTURE_CORRUPTED',409,{packageItemId:itemId||null,handoffOwner:'D17_ASSESSMENT_VALIDITY'});if(snapByItem.has(itemId))fail('Final-response snapshot contains duplicate item evidence.','TEACHING_D20_RESPONSE_CAPTURE_CORRUPTED',409,{packageItemId:itemId,handoffOwner:'D17_ASSESSMENT_VALIDITY'});const response=latest.get(itemId);if(!response)fail('Final-response snapshot references response evidence that is not durably present.','TEACHING_D20_RESPONSE_CAPTURE_CORRUPTED',409,{packageItemId:itemId,handoffOwner:'D17_ASSESSMENT_VALIDITY'});if(Number(entry.response_version)!==Number(response.response_version)||!samePayload(entry.renderer_payload,response.renderer_payload))fail('Durable response evidence does not match the authoritative final-response snapshot.','TEACHING_D20_RESPONSE_CAPTURE_CORRUPTED',409,{packageItemId:itemId,snapshotVersion:Number(entry.response_version),durableVersion:Number(response.response_version),handoffOwner:'D17_ASSESSMENT_VALIDITY'});snapByItem.set(itemId,entry);}
  for(const [itemId,response] of latest){const entry=snapByItem.get(itemId);if(!entry)fail('A durable response was omitted from the authoritative final-response snapshot.','TEACHING_D20_RESPONSE_CAPTURE_CORRUPTED',409,{packageItemId:itemId,responseVersion:Number(response.response_version),handoffOwner:'D17_ASSESSMENT_VALIDITY'});}
  const blankItemIds=items.filter(item=>String(item.item_state)==='ACTIVE'&&!latest.has(String(item.package_item_id))).map(item=>String(item.package_item_id));
  return Object.freeze({state:'complete',responseState:attemptState==='EXPIRED'?'auto_finalized_on_expiry':'final_submitted',finalSnapshotRef:snapshotRef,finalizationVersion,blankItemIds:Object.freeze(blankItemIds),capturedItemIds:Object.freeze([...latest.keys()].sort())});
}

function createD20Service(options={}){
  const {repository}=options;
  if(!repository||typeof repository.loadMarkingBundle!=='function')throw new TypeError('D20 authority service requires the D20 Gradebook repository.');
  const core=createCoreD20Service(options);
  const studentIdFor=(user)=>{if(!user?.id)fail('Authenticated student is required.','TEACHING_D20_AUTH_REQUIRED',401);return String(user.id);};

  function normalizePolicyInput(input={}){
    const raw=asObject(input.appealPolicy||input.appeal_policy),direction=String(raw.default_review_direction??raw.defaultReviewDirection??'').trim(),authorityRef=String(raw.authority_ref??raw.authorityRef??raw.policy_ref??raw.policyRef??'').trim();
    if(direction&&!authorityRef)fail('Appeal review direction requires an explicit versioned Course or institution authority reference.','TEACHING_D20_APPEAL_DIRECTION_AUTHORITY_REQUIRED',409);
    const appealPolicy={...raw,default_review_direction:direction||null};
    if(authorityRef)appealPolicy.authority_ref=authorityRef;
    delete appealPolicy.defaultReviewDirection;delete appealPolicy.authorityRef;delete appealPolicy.policyRef;
    const normalized={...input,appealPolicy};delete normalized.appeal_policy;return normalized;
  }

  async function ensurePolicy(user,courseId,input={}){
    return core.ensurePolicy(user,courseId,normalizePolicyInput(input));
  }

  async function verifiedBundleForAttempt(user,attemptId){const studentId=studentIdFor(user),bundle=await repository.loadMarkingBundle(studentId,attemptId);assertAuthoritativeResponseCapture(bundle);return bundle;}
  async function markAttempt(user,attemptId,input={}){await verifiedBundleForAttempt(user,attemptId);return core.markAttempt(user,attemptId,input);}
  async function moderateResult(user,resultId,input={}){const studentId=studentIdFor(user),result=await repository.resultById(studentId,resultId);if(!result)fail('Assessment Result not found.','TEACHING_D20_RESULT_NOT_FOUND',404);const bundle=await repository.loadMarkingBundle(studentId,result.assessment_attempt_id);assertAuthoritativeResponseCapture(bundle);return core.moderateResult(user,resultId,input);}
  async function transitionResult(user,resultId,input={}){const studentId=studentIdFor(user),result=await repository.resultById(studentId,resultId);if(!result)fail('Assessment Result not found.','TEACHING_D20_RESULT_NOT_FOUND',404);const bundle=await repository.loadMarkingBundle(studentId,result.assessment_attempt_id);assertAuthoritativeResponseCapture(bundle);return core.transitionResult(user,resultId,input);}

  async function createAppeal(user,resultId,input={}){
    if(Object.prototype.hasOwnProperty.call(input,'reviewDirectionPolicy'))fail('Appeal review direction is policy-owned and cannot be selected by an appeal request.','TEACHING_D20_APPEAL_DIRECTION_REQUEST_FORBIDDEN',400);
    const studentId=studentIdFor(user),result=await repository.resultById(studentId,resultId);
    if(!result)fail('Assessment Result not found.','TEACHING_D20_RESULT_NOT_FOUND',404);
    const bundle=await repository.loadMarkingBundle(studentId,result.assessment_attempt_id),appealPolicy=asObject(bundle.policy?.appeal_policy),direction=String(appealPolicy.default_review_direction||'').trim(),authorityRef=String(appealPolicy.authority_ref||appealPolicy.policy_ref||'').trim();
    if(!direction||!authorityRef)fail('Appeal review direction is not configured by an explicit versioned Course or institution policy.','TEACHING_D20_APPEAL_DIRECTION_UNCONFIGURED',409,{gradingPolicyId:bundle.policy?.grading_policy_id||null});
    return core.createAppeal(user,resultId,{...input,reviewDirectionPolicy:direction});
  }

  async function reviewAppeal(user,appealId,input={}){
    const studentId=studentIdFor(user),appeal=await repository.appealById(studentId,appealId);
    if(!appeal)fail('Grade appeal not found.','TEACHING_D20_APPEAL_NOT_FOUND',404);
    const result=await repository.resultById(studentId,appeal.assessment_result_id);if(!result)fail('Assessment Result not found.','TEACHING_D20_RESULT_NOT_FOUND',404);
    const bundle=await repository.loadMarkingBundle(studentId,result.assessment_attempt_id);
    try{assertAuthoritativeResponseCapture(bundle);}catch(error){if(String(error?.code||'').startsWith('TEACHING_D20_RESPONSE_CAPTURE_')){await repository.updateAppeal({studentId,appealId,patch:{appeal_state:'EXTERNAL_HANDOFF'}});return Object.freeze({state:'EXTERNAL_HANDOFF',appealId,finalizationBlocked:true,reason:'RESPONSE_CAPTURE_INTEGRITY',code:error.code,handoffOwner:'D17_ASSESSMENT_VALIDITY'});}throw error;}
    return core.reviewAppeal(user,appealId,input);
  }

  function rubricFromItem(item){const p=asObject(item?.protected_marking_payload);return asObject(p.rubric||p.rubric_contract||p.mark_scheme||p.markScheme);}
  function responseFamilyConstructed(item){return !OBJECTIVE_FAMILIES.has(upper(item?.response_family));}

  async function selectedJudgments(studentId,resultId){
    const runs=await repository.runsForResult(studentId,resultId),byItem=new Map();
    for(const kind of ['AUTHORIZED_CORRECTION','TPF15_INITIAL','DETERMINISTIC']){
      for(const run of runs.filter(r=>r.run_kind===kind&&r.run_status==='ACCEPTED')){
        const itemId=String(run.package_item_id||'');if(!itemId||byItem.has(itemId))continue;
        byItem.set(itemId,{run,judgments:await repository.judgmentsForRun(studentId,run.marking_run_id)});
      }
    }
    return byItem;
  }

  async function aggregateAfterInvalidation(studentId,result,bundle){
    const selected=await selectedJudgments(studentId,result.assessment_result_id),activeItems=bundle.items.filter(i=>String(i.item_state)==='ACTIVE'),originalMax=bundle.items.reduce((sum,item)=>sum+Number(item.intended_marks||0),0);
    let activeEarned=0,activeMax=0,currentRunId=null;
    for(const item of activeItems){
      const picked=selected.get(String(item.package_item_id));
      if(!picked)fail('Assessment result has unresolved active marking items after invalidation.','TEACHING_D20_MARKING_INCOMPLETE',409,{packageItemId:item.package_item_id});
      currentRunId=picked.run.marking_run_id;
      const rubric=responseFamilyConstructed(item)?rubricFromItem(item):{criteria:[{criterion_id:'OBJECTIVE_KEY',criterion_max_marks:Number(item.intended_marks)}]};
      const aggregate=deterministicAggregateCriteria(picked.judgments.map(j=>({criterion_id:j.criterion_id,criterion_max_marks:Number(j.criterion_max_marks),proposed_credit:j.proposed_credit})),rubric,{roundingPolicy:bundle.policy.rounding_policy});
      activeEarned+=Number(aggregate.earned);activeMax+=Number(aggregate.max);
    }
    if(activeMax<=0||originalMax<=0)fail('No active markable Assessment items remain after invalidation.','TEACHING_D20_NO_MARKABLE_ITEMS',409);
    const factor=originalMax/activeMax,reweightedEarned=Math.min(originalMax,activeEarned*factor),rawEarned=roundConfigured(reweightedEarned,bundle.policy.rounding_policy),rawMax=roundConfigured(originalMax,bundle.policy.rounding_policy),percentage=roundConfigured(reweightedEarned/originalMax*100,bundle.policy.rounding_policy);
    return {rawEarned,rawMax,percentage,currentRunId,invalidationReweightFactor:factor,activeEarned,activeMax};
  }

  async function rebalanceCategory(studentId,courseId,policyRow,categoryKey,{reason,idempotencyPrefix}){
    const current=await repository.activeGradebookEntries(studentId,courseId),rows=current.filter(e=>upper(e.category_key)===upper(categoryKey));if(!rows.length)return [];
    const within=1/rows.length,budget=Number(policyRow.category_weights[categoryKey]||0),out=[];
    for(const row of rows){
      const contribution=Number(row.raw_percentage)*budget*within;
      if(Math.abs(Number(row.within_category_weight)-within)<1e-12&&Math.abs(Number(row.course_contribution)-contribution)<1e-9){out.push(row);continue;}
      const saved=await repository.upsertGradebookVersion({studentId,courseId,policyId:policyRow.grading_policy_id,sourceKind:row.source_kind,sourceRef:row.source_ref,sourceResultId:row.source_result_id,sourceAssignmentEvaluationId:row.source_assignment_evaluation_id,categoryKey,categoryWeight:budget,withinCategoryWeight:within,rawEarnedMarks:Number(row.raw_earned_marks),rawMaxMarks:Number(row.raw_max_marks),rawPercentage:Number(row.raw_percentage),courseContribution:contribution,entryState:row.entry_state,learningUnitIds:row.learning_unit_ids||[],topicIds:row.topic_ids||[],changeReason:`CATEGORY_REBALANCE:${reason}`,idempotencyKey:`${idempotencyPrefix}:rebalance:${row.source_kind}:${row.source_ref}:${rows.length}:${row.version_no}`});
      out.push(saved.entry);
    }
    return out;
  }

  function topicAggregate(entries,policyRow,topicId){
    const rows=entries.filter(e=>(e.topic_ids||[]).map(String).includes(String(topicId))),ep=policyRow.topic_evidence_policy||{},contexts=new Set(rows.map(e=>String(e.category_key))),occasions=new Set(rows.map(e=>String(e.source_ref))),controlled=rows.some(e=>e.source_kind==='ASSESSMENT');
    const sufficient=rows.length>=Number(ep.minimum_grade_contributing_events||0)&&contexts.size>=Number(ep.minimum_distinct_assessment_contexts||0)&&occasions.size>=Number(ep.minimum_separate_academic_occasions||0)&&(!ep.controlled_independent_evidence_required||controlled),grouped=new Map();
    for(const entry of rows){const key=upper(entry.category_key);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(entry);}
    let weighted=0,weightSum=0;const breakdown={};
    for(const [key,items] of grouped){const average=items.reduce((sum,item)=>sum+Number(item.raw_percentage),0)/items.length,weight=Number(policyRow.category_weights[key]||0);weighted+=average*weight;weightSum+=weight;breakdown[key]={category_percentage:roundConfigured(average,policyRow.rounding_policy),configured_weight:weight,evidence_count:items.length};}
    const score=weightSum>0?roundConfigured(weighted/weightSum,policyRow.rounding_policy):null,thresholds=asObject(policyRow.essential_outcome_policy),flags=Object.entries(thresholds).filter(([,v])=>Number.isFinite(Number(v))).map(([key,value])=>({outcome_ref:key,threshold:Number(value),met:score==null?null:score>=Number(value)}));
    return {score_percentage:score,score_state:sufficient?'FINALIZED':'PROVISIONAL_INSUFFICIENT_EVIDENCE',evidence_count:rows.length,distinct_context_count:contexts.size,distinct_occasion_count:occasions.size,controlled_independent_present:controlled,category_breakdown:breakdown,essential_outcome_flags:flags,source_gradebook_entry_ids:rows.map(e=>e.gradebook_entry_id)};
  }

  async function recalculateCourse(studentId,courseId,policyRow,{reason,sourceRef}){
    const entries=await repository.activeGradebookEntries(studentId,courseId),topics=await repository.courseTopics(studentId,courseId),topicSnapshots=[];
    for(const topic of topics){const snapshot=topicAggregate(entries,policyRow,topic.topic_id);topicSnapshots.push(await repository.appendTopicSnapshot({studentId,courseId,topicId:topic.topic_id,policyId:policyRow.grading_policy_id,snapshot,idempotencyKey:`d20-topic:${courseId}:${topic.topic_id}:${reason}:${sourceRef}:${entries.map(e=>e.gradebook_entry_id).sort().join('.')}`}));}
    const course=calculateCourseScore(entries,{category_weights:policyRow.category_weights,rounding_policy:policyRow.rounding_policy,grade_scale_policy:policyRow.grade_scale_policy,topic_evidence_policy:policyRow.topic_evidence_policy,essential_outcome_policy:policyRow.essential_outcome_policy,moderation_policy:policyRow.moderation_policy,appeal_policy:policyRow.appeal_policy});
    const courseSnapshot=await repository.appendCourseSnapshot({studentId,courseId,policyId:policyRow.grading_policy_id,snapshot:{score_percentage:course.score_percentage,result_state:'PROVISIONAL',category_breakdown:course.category_breakdown,grade_scale_outcome:{scale:policyRow.grade_scale_policy?.scale||'KIWI_PERCENTAGE_100_V1',percentage:course.score_percentage},essential_outcome_flags:topicSnapshots.flatMap(s=>s.essential_outcome_flags||[]),source_gradebook_entry_ids:entries.map(e=>e.gradebook_entry_id)},idempotencyKey:`d20-course:${courseId}:${reason}:${sourceRef}:${entries.map(e=>e.gradebook_entry_id).sort().join('.')}`});
    return {topicSnapshots,courseSnapshot};
  }

  async function commitInvalidationReflow(studentId,result,bundle,{reason,idempotencyPrefix,invalidatedItemIds}){
    const activeItems=bundle.items.filter(i=>String(i.item_state)==='ACTIVE'),learningUnitIds=stableUnique(activeItems.flatMap(i=>i.learning_unit_ids||[])),topicIds=await repository.topicsForLearningUnits(studentId,learningUnitIds),budget=Number(bundle.policy.category_weights[result.category_key]||0),existing=(await repository.activeGradebookEntries(studentId,result.course_id)).filter(e=>upper(e.category_key)===upper(result.category_key)),within=1/(existing.some(e=>String(e.source_ref)===String(result.assessment_attempt_id))?existing.length:existing.length+1);
    const entryState=result.release_state==='FINALIZED'?'FINALIZED':result.release_state==='APPEALABLE'?'APPEALABLE':result.release_state==='RELEASED'?'RELEASED':result.marking_state==='MODERATED'?'MODERATED':'PROVISIONAL';
    const saved=await repository.upsertGradebookVersion({studentId,courseId:result.course_id,policyId:bundle.policy.grading_policy_id,sourceKind:'ASSESSMENT',sourceRef:result.assessment_attempt_id,sourceResultId:result.assessment_result_id,categoryKey:result.category_key,categoryWeight:budget,withinCategoryWeight:within,rawEarnedMarks:Number(result.raw_earned_marks),rawMaxMarks:Number(result.raw_max_marks),rawPercentage:Number(result.raw_percentage),courseContribution:Number(result.raw_percentage)*budget*within,entryState,learningUnitIds,topicIds,changeReason:reason,idempotencyKey:`${idempotencyPrefix}:entry`});
    await rebalanceCategory(studentId,result.course_id,bundle.policy,result.category_key,{reason,idempotencyPrefix});
    const snapshots=await recalculateCourse(studentId,result.course_id,bundle.policy,{reason,sourceRef:result.assessment_result_id});
    if(saved.previous&&String(saved.previous.gradebook_entry_id)!==String(saved.entry.gradebook_entry_id))await repository.appendAudit({studentId,courseId:result.course_id,sourceKind:'ASSESSMENT',sourceRef:result.assessment_attempt_id,originalEntryId:saved.previous.gradebook_entry_id,newEntryId:saved.entry.gradebook_entry_id,reasonCode:reason,beforeSnapshot:saved.previous,afterSnapshot:saved.entry,boundedReasonRefs:invalidatedItemIds.map(id=>`invalidated-item:${id}`),downstreamHandoffs:[{owner:'D21',type:'PROGRESSION_GPA_INPUT_CHANGED',course_id:result.course_id}],idempotencyKey:`${idempotencyPrefix}:audit`});
    return Object.freeze({entry:saved.entry,topicSnapshots:snapshots.topicSnapshots,courseSnapshot:snapshots.courseSnapshot,downstreamHandoff:Object.freeze({owner:'D21',type:'GRADE_TRUTH_UPDATED',gpaMutationByD20:false})});
  }

  async function recalculateAfterItemInvalidation(user,resultId,{packageItemId=null,idempotencyKey=null}={}){
    const studentId=studentIdFor(user),result=await repository.resultById(studentId,resultId);
    if(!result)fail('Assessment Result not found.','TEACHING_D20_RESULT_NOT_FOUND',404);
    if(result.raw_percentage==null||!['PROVISIONAL','MODERATED'].includes(String(result.marking_state)))fail('Only an already-marked Assessment Result can be recalculated after item invalidation.','TEACHING_D20_INVALIDATION_REFLOW_STATE_INVALID',409,{markingState:result.marking_state});
    const bundle=await repository.loadMarkingBundle(studentId,result.assessment_attempt_id);assertAuthoritativeResponseCapture(bundle);const invalidated=bundle.items.filter(item=>String(item.item_state)==='INVALIDATED');
    if(packageItemId&&!invalidated.some(item=>String(item.package_item_id)===String(packageItemId)))fail('Requested Assessment item is not invalidated.','TEACHING_D20_ITEM_NOT_INVALIDATED',409,{packageItemId});
    if(!invalidated.length)fail('Assessment package contains no invalidated item requiring recalculation.','TEACHING_D20_NO_INVALIDATED_ITEMS',409);
    const aggregate=await aggregateAfterInvalidation(studentId,result,bundle),same=Math.abs(Number(result.raw_earned_marks)-aggregate.rawEarned)<1e-12&&Math.abs(Number(result.raw_max_marks)-aggregate.rawMax)<1e-12&&Math.abs(Number(result.raw_percentage)-aggregate.percentage)<1e-12;
    if(same)return Object.freeze({state:'RECALCULATED',changed:false,idempotent:true,assessmentResultId:resultId,rawMarks:Object.freeze({earned:Number(result.raw_earned_marks),max:Number(result.raw_max_marks),percentage:Number(result.raw_percentage)}),invalidatedItemIds:Object.freeze(invalidated.map(i=>String(i.package_item_id))),invalidationReweightFactor:aggregate.invalidationReweightFactor});
    const updated=await repository.updateResult({studentId,resultId,expectedVersion:result.result_version,patch:{marking_state:result.marking_state,review_blocked:false,current_marking_run_id:aggregate.currentRunId,raw_earned_marks:aggregate.rawEarned,raw_max_marks:aggregate.rawMax,raw_percentage:aggregate.percentage}}),prefix=String(idempotencyKey||`d20-invalidation-reflow:${resultId}:rv${updated.result_version}`),invalidatedItemIds=invalidated.map(i=>String(i.package_item_id)),gradebook=await commitInvalidationReflow(studentId,updated,bundle,{reason:'ITEM_INVALIDATION_RECALCULATION',idempotencyPrefix:prefix,invalidatedItemIds});
    return Object.freeze({state:'RECALCULATED',changed:true,idempotent:false,assessmentResultId:resultId,rawMarks:Object.freeze({earned:Number(updated.raw_earned_marks),max:Number(updated.raw_max_marks),percentage:Number(updated.raw_percentage)}),invalidatedItemIds:Object.freeze(invalidatedItemIds),invalidationReweightFactor:aggregate.invalidationReweightFactor,gradebook});
  }

  return Object.freeze({...core,ensurePolicy,markAttempt,moderateResult,transitionResult,createAppeal,reviewAppeal,recalculateAfterItemInvalidation,authorityBoundary:'D20_CANONICAL_MARKING_SAFETY_V2'});
}

module.exports={createD20Service,createD20AuthorityService:createD20Service,assertAuthoritativeResponseCapture};