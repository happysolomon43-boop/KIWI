'use strict';

const crypto = require('node:crypto');

const SKM_ALGORITHM_ID = 'EVIDENCE_QUALITY_STATE_MACHINE_V1';
const SKM_ALGORITHM_VERSION = 'skm-evidence-state-machine.v1';

const BASE_STATES = Object.freeze([
  'UNSEEN','INTRODUCED','ASSISTED','EMERGING','INDEPENDENT','SECURE','TRANSFERABLE',
]);
const OVERLAYS = Object.freeze(['FRAGILE','BLOCKED','REGRESSED']);
const STATE_RANK = Object.freeze(Object.fromEntries(BASE_STATES.map((state,index)=>[state,index])));
const QUALITY_CLASSES = Object.freeze(new Set(['STRONG','MODERATE','WEAK','UNUSABLE','INDETERMINATE']));
const INFO_GAIN = Object.freeze(new Set(['LOW','MODERATE','HIGH','UNKNOWN']));

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
}
function asObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function asArray(value) { return Array.isArray(value) ? value : []; }
function asIso(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
function normalizedText(value) {
  return String(value == null ? '' : value).trim().toLowerCase().replace(/\s+/g,' ');
}
function misconceptionRecordId(studentId,hypothesis) {
  return 'mis_' + crypto.createHash('sha256').update(String(studentId)+'|'+normalizedText(hypothesis)).digest('hex').slice(0,28);
}
function eventId(event) { return String(event.evidence_event_id || event.evidenceEventId || event.id || ''); }
function occurredAt(event) { return asIso(event.occurred_at || event.occurredAt || event.created_at || event.createdAt); }
function quality(event) { return asObject(event.response_quality || event.responseQuality); }
function demand(event) { return asObject(event.demand_vector || event.demandVector); }
function confidence(event) { return asObject(event.confidence_sample || event.confidenceSample); }
function misconception(event) { return asObject(event.misconception_context || event.misconceptionContext); }
function prerequisite(event) { return asObject(event.prerequisite_context || event.prerequisiteContext); }
function pathContext(event) { return asObject(event.path_context || event.pathContext); }

function correctness(event) {
  return String(quality(event).final_result_correctness || quality(event).correctness || '').toLowerCase();
}
function isCorrect(event) { return correctness(event) === 'correct'; }
function isPartial(event) { return correctness(event) === 'partially_correct'; }
function isIncorrect(event) { return correctness(event) === 'incorrect'; }
function isIndependent(event) { return event.independent_performance === true || event.independentPerformance === true; }
function validity(event) { return String(event.evidence_validity || event.evidenceValidity || 'VALID').toUpperCase(); }
function evidenceStrength(event) {
  const value=String(event.evidential_strength || event.evidentialStrength || event.evidence_strength || '').toUpperCase();
  return QUALITY_CLASSES.has(value) ? value : 'INDETERMINATE';
}
function informationGain(event) {
  const value=String(event.information_gain || event.informationGain || 'UNKNOWN').toUpperCase();
  return INFO_GAIN.has(value) ? value : 'UNKNOWN';
}
function isContaminated(event) {
  return Boolean(event.answer_or_method_exposed || event.answerOrMethodExposed) ||
    validity(event)==='CONTAMINATED' || evidenceStrength(event)==='UNUSABLE';
}
function hasMaterialError(event) {
  return asArray(event.observed_errors || event.observedErrors).some((item)=>{
    const severity=String(item?.severity_for_target_competence || item?.severity || '').toLowerCase();
    return severity==='material' || severity==='blocking';
  });
}
function sufficient(event) {
  const value=String(quality(event).evidence_sufficiency || '').toLowerCase();
  return ['sufficient_for_requested_inference','sufficient','partially_sufficient'].includes(value);
}
function usable(event) {
  return !['INVALID'].includes(validity(event)) && !isContaminated(event);
}
function successfulIndependent(event) {
  return usable(event) && isIndependent(event) && isCorrect(event) && sufficient(event) &&
    ['STRONG','MODERATE'].includes(evidenceStrength(event));
}
function successfulAssisted(event) {
  return validity(event)!=='INVALID' && (isCorrect(event) || isPartial(event)) && !isIndependent(event) &&
    evidenceStrength(event)!=='UNUSABLE';
}
function substantiveNegative(event) {
  if (!usable(event) || !isIndependent(event)) return false;
  if (!['STRONG','MODERATE'].includes(evidenceStrength(event))) return false;
  if (!(isIncorrect(event) || (isPartial(event) && hasMaterialError(event)))) return false;
  const claim=String(event.evidence_claim || event.evidenceClaim || 'other').toLowerCase();
  return ['independent_performance','select_method','retain_after_delay','adapt_to_variation','integrate_or_transfer'].includes(claim);
}
function transferQualified(event) {
  if (!successfulIndependent(event)) return false;
  const claim=String(event.evidence_claim || '').toLowerCase();
  const d=demand(event);
  if (!['adapt_to_variation','integrate_or_transfer'].includes(claim)) return false;
  if (String(d.method_cueing || '').toLowerCase() !== 'none') return false;
  const familiar=String(d.familiarity || '').toLowerCase();
  const representation=String(d.representation_demand || '').toLowerCase();
  const integration=String(d.integration_demand || '').toLowerCase();
  return ['new_representation','new_context_same_construct','integrated'].includes(familiar) ||
    ['new_legitimate_representation','cross_representation_connection'].includes(representation) ||
    ['combine_eligible_constructs','embedded_in_broader_problem'].includes(integration);
}
function delayedQualified(event) {
  if (!successfulIndependent(event)) return false;
  const d=demand(event);
  return String(event.evidence_claim || '').toLowerCase()==='retain_after_delay' ||
    ['spaced','delayed'].includes(String(d.retention_timing || '').toLowerCase());
}
function independentKey(event) {
  const redundancy=String(event.redundancy || '').toLowerCase();
  if (redundancy==='highly_redundant') {
    return 'redundant:' + String(event.comparability_group || event.comparabilityGroup || event.evidence_claim || 'same');
  }
  return 'event:' + eventId(event);
}
function distinctIndependentSuccesses(events) {
  const seen=new Set(); const out=[];
  for (const event of events) {
    if (!successfulIndependent(event)) continue;
    const key=independentKey(event);
    if (seen.has(key)) continue;
    seen.add(key); out.push(event);
  }
  return out;
}
function strongestClaim(baseState) {
  return ({
    UNSEEN:'no meaningful learning evidence yet',
    INTRODUCED:'instruction/exposure is present; independent capability is not yet established',
    ASSISTED:'successful performance is currently supported by material assistance',
    EMERGING:'at least one credible independent success exists, but evidence is still thin or mixed',
    INDEPENDENT:'repeated independent performance is supported in the tested context',
    SECURE:'independent performance has survived meaningful delayed retrieval',
    TRANSFERABLE:'independent performance includes legitimate varied/integrated application',
  })[baseState] || 'uncertain';
}
function dimension(status,basisRefs=[],note=null) {
  return freezeDeep({status,basis_refs:[...new Set(basisRefs.map(String))],note});
}
function mostRecent(events,predicate) {
  for(let i=events.length-1;i>=0;i-=1) if(predicate(events[i])) return events[i];
  return null;
}
function positiveConceptual(event) {
  const v=String(quality(event).conceptual_support || '').toLowerCase();
  return successfulIndependent(event) && ['strong','partial'].includes(v);
}
function positiveProcedural(event) {
  const v=String(quality(event).reasoning_or_method || '').toLowerCase();
  return successfulIndependent(event) && ['valid','mostly_valid','partially_valid'].includes(v);
}
function summarizeDimensions(events,baseState) {
  const conceptualGood=events.filter(positiveConceptual);
  const conceptualBad=events.filter((e)=>substantiveNegative(e) && ['weak','unsupported'].includes(String(quality(e).conceptual_support||'').toLowerCase()));
  const proceduralGood=events.filter(positiveProcedural);
  const proceduralBad=events.filter((e)=>substantiveNegative(e) && ['invalid'].includes(String(quality(e).reasoning_or_method||'').toLowerCase()));
  const delayedGood=events.filter(delayedQualified);
  const delayedBad=events.filter((e)=>substantiveNegative(e) && ['spaced','delayed'].includes(String(demand(e).retention_timing||'').toLowerCase()));
  const transferGood=events.filter(transferQualified);
  const transferBad=events.filter((e)=>substantiveNegative(e) && ['adapt_to_variation','integrate_or_transfer'].includes(String(e.evidence_claim||'').toLowerCase()));
  const fluency=events.filter((e)=>Boolean(asObject(e.difficulty_context).fluency_observed));
  return freezeDeep({
    conceptual_understanding: conceptualBad.length ? dimension('CONCERN',conceptualBad.map(eventId),'Recent material conceptual errors exist.') :
      conceptualGood.length ? dimension(conceptualGood.length>1?'STRONG':'SUPPORTED',conceptualGood.map(eventId)) : dimension('NOT_ASSESSED'),
    procedural_ability: proceduralBad.length ? dimension('CONCERN',proceduralBad.map(eventId),'Recent material method/procedure errors exist.') :
      proceduralGood.length ? dimension(proceduralGood.length>1?'STRONG':'SUPPORTED',proceduralGood.map(eventId)) : dimension('NOT_ASSESSED'),
    independence: dimension(
      STATE_RANK[baseState]>=STATE_RANK.INDEPENDENT?'SUPPORTED':baseState==='EMERGING'?'PARTIAL':baseState==='ASSISTED'?'ASSISTANCE_DEPENDENT':'NOT_ASSESSED',
      distinctIndependentSuccesses(events).map(eventId)
    ),
    retention: delayedBad.length ? dimension('CONCERN',delayedBad.map(eventId)) :
      delayedGood.length ? dimension('SUPPORTED',delayedGood.map(eventId)) : dimension('NOT_ASSESSED'),
    transfer: transferBad.length && !transferGood.length ? dimension('CONCERN',transferBad.map(eventId)) :
      transferGood.length ? dimension('SUPPORTED',transferGood.map(eventId)) : dimension('NOT_ASSESSED'),
    fluency: fluency.length ? dimension('SUPPORTED',fluency.map(eventId)) : dimension('NOT_ASSESSED'),
    confidence_calibration: dimension('NOT_ASSESSED'),
  });
}
function confidenceCalibration(events) {
  const samples=events.filter((event)=>confidence(event).provided===true && validity(event)!=='INVALID' && evidenceStrength(event)!=='UNUSABLE');
  if (!samples.length) return freezeDeep({status:'NOT_ASSESSED',pattern:null,basis_refs:[],note:'Missing confidence is missing evidence, not low confidence.'});
  const highWrong=samples.filter((event)=>String(confidence(event).band||confidence(event).value_or_band||'').toLowerCase()==='high' && isIncorrect(event));
  const lowCorrect=samples.filter((event)=>String(confidence(event).band||confidence(event).value_or_band||'').toLowerCase()==='low' && isCorrect(event));
  let pattern='MIXED'; let status='ISOLATED_SIGNAL'; let refs=[];
  if(highWrong.length){pattern=highWrong.length>1?'OVERCONFIDENCE_PATTERN':'HIGH_CONFIDENCE_WRONG';refs=highWrong.map(eventId);status=highWrong.length>1?'PATTERN_SUPPORTED':'ISOLATED_SIGNAL';}
  else if(lowCorrect.length){pattern=lowCorrect.length>1?'UNDERCONFIDENCE_PATTERN':'LOW_CONFIDENCE_CORRECT';refs=lowCorrect.map(eventId);status=lowCorrect.length>1?'PATTERN_SUPPORTED':'ISOLATED_SIGNAL';}
  else {pattern='WELL_CALIBRATED_OR_MIXED';refs=samples.map(eventId);status=samples.length>1?'PATTERN_SUPPORTED':'ISOLATED_SIGNAL';}
  return freezeDeep({status,pattern,basis_refs:[...new Set(refs)],note:'Confidence is instructional evidence only and has no grade effect.'});
}
function retentionContext(events) {
  let lastPositive=null; let horizon=0; const delayedRefs=[];
  for(const event of events){
    const at=occurredAt(event); const ms=at ? new Date(at).getTime() : NaN;
    if(delayedQualified(event) && lastPositive && Number.isFinite(ms)){
      const previousMs=new Date(lastPositive).getTime();
      if(Number.isFinite(previousMs) && ms>previousMs){
        horizon=Math.max(horizon,Math.floor((ms-previousMs)/1000));
        delayedRefs.push(eventId(event));
      }
    }
    if(successfulIndependent(event) && at) lastPositive=at;
  }
  const latestSupport=mostRecent(events,(e)=>successfulIndependent(e));
  return freezeDeep({
    demonstrated_horizon_seconds:horizon || null,
    delayed_success_refs:[...new Set(delayedRefs)],
    last_supporting_evidence_at:latestSupport?occurredAt(latestSupport):null,
    policy:'Time may reduce certainty after the evidence-derived retention horizon; it never decrees knowledge loss.',
  });
}
function pathToSuccess(events) {
  const helpful=new Map(); const errors=new Map(); const prereqs=new Map();
  let assistedSuccess=false;
  for(const event of events){
    if(validity(event)==='INVALID' || evidenceStrength(event)==='UNUSABLE') continue;
    const ref=eventId(event); const path=pathContext(event); const pre=prerequisite(event);
    if(successfulAssisted(event)) assistedSuccess=true;
    for(const err of asArray(event.observed_errors || event.observedErrors)){
      const type=String(err?.type || 'other');
      if(!errors.has(type)) errors.set(type,[]);
      errors.get(type).push(ref);
    }
    if(pre.prerequisite_ref && ['candidate_failure','investigation_needed'].includes(String(pre.status||''))){
      const key=String(pre.prerequisite_ref); if(!prereqs.has(key)) prereqs.set(key,[]); prereqs.get(key).push(ref);
    }
    if(isCorrect(event)){
      for(const strategy of asArray(path.prior_strategy_classes)){
        const key='strategy:'+String(strategy); if(!helpful.has(key)) helpful.set(key,{strategy_or_representation:String(strategy),context:'success followed a prior bounded pedagogy strategy',evidence_refs:[]});
        helpful.get(key).evidence_refs.push(ref);
      }
      if(path.representation){
        const key='representation:'+String(path.representation); if(!helpful.has(key)) helpful.set(key,{strategy_or_representation:String(path.representation),context:'success observed with this representation',evidence_refs:[]});
        helpful.get(key).evidence_refs.push(ref);
      }
    }
  }
  return freezeDeep({
    helpful_strategies:[...helpful.values()].map((item)=>({...item,evidence_refs:[...new Set(item.evidence_refs)],support:item.evidence_refs.length>1?'REPEATED':'PRELIMINARY',limits:'Context-specific instructional memory; not a permanent learning-style claim.'})),
    recurring_errors:[...errors.entries()].filter(([,refs])=>new Set(refs).size>1).map(([type,refs])=>({type,evidence_refs:[...new Set(refs)]})),
    hint_dependence:assistedSuccess?'OBSERVED':'NOT_ESTABLISHED',
    prerequisite_weaknesses:[...prereqs.entries()].map(([learning_unit_ref,refs])=>({learning_unit_ref,evidence_refs:[...new Set(refs)]})),
  });
}
function synthesizeMisconceptions(events,studentId,learningUnitId) {
  const groups=new Map();
  for(const event of events){
    if(validity(event)==='INVALID' || evidenceStrength(event)==='UNUSABLE') continue;
    const m=misconception(event);
    const hypothesis=String(m.hypothesis || '').trim();
    if(!hypothesis || !['candidate','recurring_supported','recurring'].includes(String(m.status||''))) continue;
    const key=normalizedText(hypothesis);
    if(!groups.has(key)) groups.set(key,{hypothesis,support:[],affected:new Set(),repair:new Set(),confidence:'LOW'});
    const g=groups.get(key); g.support.push(event);
    for(const ref of asArray(m.affected_competence_refs || m.affected_learning_unit_refs)) g.affected.add(String(ref));
    for(const ref of asArray(m.repair_attempt_refs)) g.repair.add(String(ref));
    for(const ref of asArray(pathContext(event).prior_pedagogy_refs)) g.repair.add(String(ref));
    if(String(m.confidence||'').toLowerCase()==='high' || (confidence(event).provided===true && String(confidence(event).band||confidence(event).value_or_band||'').toLowerCase()==='high' && isIncorrect(event))) g.confidence='HIGH';
    else if(g.confidence!=='HIGH' && String(m.confidence||'').toLowerCase()==='medium') g.confidence='MEDIUM';
  }
  const out=[];
  for(const g of groups.values()){
    const lastSupport=g.support[g.support.length-1];
    const lastAt=new Date(occurredAt(lastSupport)||0).getTime();
    const later=events.filter((e)=>new Date(occurredAt(e)||0).getTime()>lastAt && successfulIndependent(e) && String(misconception(e).status||'')==='none_supported');
    const independent=later.filter((e)=>!delayedQualified(e));
    const delayed=later.filter(delayedQualified);
    let status=g.support.length>=2?'RECURRING':'CANDIDATE';
    if(independent.length || delayed.length) status='RESOLUTION_SUPPORTED';
    if((independent.length && delayed.length) || delayed.length>=2) status='RESOLVED';
    const affected=[...g.affected]; if(!affected.length) affected.push(String(learningUnitId));
    out.push(freezeDeep({
      misconception_record_id:misconceptionRecordId(studentId,g.hypothesis),
      normalized_hypothesis:normalizedText(g.hypothesis),
      hypothesis:g.hypothesis,
      status,
      affected_learning_unit_refs:affected,
      supporting_evidence_refs:g.support.map(eventId),
      repair_attempt_refs:[...g.repair],
      independent_verification_refs:independent.map(eventId),
      delayed_verification_refs:delayed.map(eventId),
      confidence:g.confidence,
    }));
  }
  return freezeDeep(out);
}
function blockOverlay(events) {
  const failures=events.filter((e)=>['candidate_failure','investigation_needed'].includes(String(prerequisite(e).status||'')));
  if(failures.length<2) return false;
  const strategies=new Set();
  for(const e of failures) for(const s of asArray(pathContext(e).prior_strategy_classes)) strategies.add(String(s));
  return strategies.size>=2;
}
function unresolvedMaterialContradiction(events) {
  let lastNegative=-1;
  for(let i=0;i<events.length;i+=1) if(substantiveNegative(events[i])) lastNegative=i;
  if(lastNegative<0)return false;
  // A material contradiction is resolved only by repeated, distinct later
  // independent success. Quantity of weak/repetitive evidence cannot erase it.
  return distinctIndependentSuccesses(events.slice(lastNegative+1)).length<2;
}
function baseStateFor(events) {
  if(!events.length) return 'UNSEEN';
  const meaningful=events.filter((event)=>validity(event)!=='INVALID');
  if(!meaningful.length) return 'UNSEEN';
  const independent=distinctIndependentSuccesses(meaningful);
  const unresolved=unresolvedMaterialContradiction(meaningful);
  const delayed=meaningful.some(delayedQualified);
  const transfer=meaningful.some(transferQualified);
  if(independent.length>=2 && !unresolved && transfer) return 'TRANSFERABLE';
  if(independent.length>=2 && !unresolved && delayed) return 'SECURE';
  if(independent.length>=2 && !unresolved) return 'INDEPENDENT';
  if(independent.length>=1) return 'EMERGING';
  if(meaningful.some(successfulAssisted)) return 'ASSISTED';
  return 'INTRODUCED';
}
function competenceEstablishedAt(events) {
  const seen=new Set();
  for(const event of events){
    if(successfulIndependent(event)) seen.add(independentKey(event));
    if(seen.size>=2) return occurredAt(event);
  }
  return null;
}
function regressionOverlays(events,baseState) {
  // Overlays describe later evidence relative to previously demonstrated
  // competence, so they must not depend on the newly recomputed base state.
  const established=competenceEstablishedAt(events);
  if(!established) return [];
  const establishedMs=new Date(established).getTime();
  const later=events.filter((event)=>new Date(occurredAt(event)||0).getTime()>=establishedMs);
  const negative= later.filter(substantiveNegative);
  if(!negative.length)return [];
  const lastNegative=events.map((event,index)=>({event,index})).filter(({event})=>substantiveNegative(event)).at(-1);
  const recovery=lastNegative?distinctIndependentSuccesses(events.slice(lastNegative.index+1)):[];
  if(recovery.length>=2)return [];
  const distinctNegativeKeys=new Set(negative.map(independentKey));
  if(distinctNegativeKeys.size>=2)return ['REGRESSED'];
  return ['FRAGILE'];
}
function certaintyAtEvidence(baseState,overlays,retention) {
  if(overlays.includes('REGRESSED') || overlays.includes('FRAGILE')) return 'LOW';
  if(baseState==='SECURE') return 'HIGH';
  if(baseState==='TRANSFERABLE' && retention.delayed_success_refs.length) return 'HIGH';
  if(['INDEPENDENT','TRANSFERABLE'].includes(baseState)) return 'MEDIUM';
  if(baseState==='UNSEEN') return 'UNKNOWN';
  return 'LOW';
}
function computeKnowledgeState(rawEvents,{studentId,learningUnitId}={}) {
  const events=[...rawEvents].sort((a,b)=>{
    const ta=new Date(occurredAt(a)||0).getTime(); const tb=new Date(occurredAt(b)||0).getTime();
    return ta-tb || eventId(a).localeCompare(eventId(b));
  });
  const baseState=baseStateFor(events);
  const overlays=[...regressionOverlays(events,baseState)];
  if(blockOverlay(events)) overlays.push('BLOCKED');
  const uniqueOverlays=[...new Set(overlays)].filter((v)=>OVERLAYS.includes(v));
  const retention=retentionContext(events);
  const calibration=confidenceCalibration(events);
  const dimensions={...summarizeDimensions(events,baseState),confidence_calibration:dimension(calibration.status==='PATTERN_SUPPORTED'?'SUPPORTED':calibration.status==='ISOLATED_SIGNAL'?'PARTIAL':'NOT_ASSESSED',calibration.basis_refs,calibration.pattern)};
  const latest=events[events.length-1] || null;
  const contradictions=unresolvedMaterialContradiction(events) && events.filter(successfulIndependent).length>0;
  return freezeDeep({
    algorithm_id:SKM_ALGORITHM_ID,
    algorithm_version:SKM_ALGORITHM_VERSION,
    base_state:baseState,
    overlays:uniqueOverlays,
    dimensions,
    certainty_band:certaintyAtEvidence(baseState,uniqueOverlays,retention),
    certainty_basis:{
      as_of_evidence_at:latest?occurredAt(latest):null,
      retention_context:retention,
      rule:'certainty may age; base knowledge state does not decay from time alone',
    },
    retention_context:retention,
    strongest_supported_claim:strongestClaim(baseState),
    contradiction_state:contradictions,
    evidence_event_count:events.length,
    evidence_cutoff_at:latest?occurredAt(latest):null,
    path_to_success:pathToSuccess(events),
    confidence_calibration:calibration,
    misconceptions:synthesizeMisconceptions(events,studentId,learningUnitId),
  });
}
function projectEffectiveCertainty(state,{asOf=new Date()}={}) {
  if(!state) return freezeDeep({band:'UNKNOWN',reason:'NO_DURABLE_STATE'});
  const overlays=asArray(state.overlays);
  const base=String(state.base_state||'UNSEEN');
  if(overlays.includes('REGRESSED')||overlays.includes('FRAGILE')) return freezeDeep({band:'LOW',reason:'CURRENT_EVIDENCE_CONCERN'});
  const context=asObject(state.retention_context || asObject(state.certainty_basis).retention_context);
  const horizon=Number(context.demonstrated_horizon_seconds);
  const last=context.last_supporting_evidence_at || state.evidence_cutoff_at;
  if(Number.isFinite(horizon) && horizon>0 && last){
    const age=Math.max(0,(new Date(asOf).getTime()-new Date(last).getTime())/1000);
    if(age>horizon && ['SECURE','TRANSFERABLE'].includes(base)){
      return freezeDeep({band:'MEDIUM',reason:'BEYOND_DEMONSTRATED_RETENTION_HORIZON',retention_check_recommended:true});
    }
  }
  if(['SECURE'].includes(base) || (base==='TRANSFERABLE' && asArray(context.delayed_success_refs).length)) return freezeDeep({band:'HIGH',reason:'DELAYED_RETENTION_SUPPORTED',retention_check_recommended:false});
  if(['INDEPENDENT','TRANSFERABLE'].includes(base)) return freezeDeep({band:'MEDIUM',reason:'RETENTION_NOT_YET_STRONGLY_ESTABLISHED',retention_check_recommended:false});
  if(base==='UNSEEN') return freezeDeep({band:'UNKNOWN',reason:'NO_MEANINGFUL_EVIDENCE',retention_check_recommended:false});
  return freezeDeep({band:'LOW',reason:'CAPABILITY_STILL_DEVELOPING',retention_check_recommended:false});
}
function learningAnalysisProjection(state,{history=[],asOf=new Date(),misconceptions=[]}={}) {
  const current=state || {base_state:'UNSEEN',overlays:[],dimensions:{},strongest_supported_claim:'no meaningful learning evidence yet',retention_context:{}};
  const effective=projectEffectiveCertainty(current,{asOf});
  const overlays=asArray(current.overlays);
  let label='needs_verification';
  if(overlays.includes('REGRESSED')||overlays.includes('BLOCKED')) label='needs_reinforcement';
  else if(overlays.includes('FRAGILE')) label='fragile';
  else if(effective.band==='MEDIUM' && ['SECURE','TRANSFERABLE'].includes(current.base_state) && effective.retention_check_recommended) label='needs_verification';
  else if(['SECURE','TRANSFERABLE','INDEPENDENT'].includes(current.base_state)) label='strong';
  else if(current.base_state==='EMERGING') label='improving';
  else if(['INTRODUCED','ASSISTED'].includes(current.base_state)) label='needs_reinforcement';
  const previous=history.length>1?history[history.length-2]:null;
  if(previous && STATE_RANK[current.base_state]>STATE_RANK[previous.base_state] && !overlays.length && ['EMERGING','INDEPENDENT'].includes(current.base_state)) label='improving';
  const activeMisconceptions=misconceptions.filter((m)=>!['RESOLVED'].includes(String(m.status||'')));
  return freezeDeep({
    label,
    summary:current.strongest_supported_claim || strongestClaim(current.base_state),
    certainty:effective.band,
    needs_retention_verification:Boolean(effective.retention_check_recommended),
    active_misconception_count:activeMisconceptions.length,
    cautions:[
      ...(overlays.includes('FRAGILE')?['Recent evidence makes retention or reliability uncertain.']:[]),
      ...(overlays.includes('REGRESSED')?['Repeated later evidence indicates meaningful loss of previously demonstrated capability.']:[]),
      ...(overlays.includes('BLOCKED')?['Normal progression needs planning investigation before relying on this Learning Unit.']:[]),
      ...(current.contradiction_state?['Evidence is contradictory; targeted verification is appropriate.']:[]),
    ],
    raw_probabilities_exposed:false,
    raw_weights_exposed:false,
    hidden_reasoning_exposed:false,
  });
}

module.exports={
  SKM_ALGORITHM_ID,SKM_ALGORITHM_VERSION,BASE_STATES,OVERLAYS,STATE_RANK,
  computeKnowledgeState,projectEffectiveCertainty,learningAnalysisProjection,
  misconceptionRecordId,successfulIndependent,substantiveNegative,transferQualified,delayedQualified,unresolvedMaterialContradiction,
};
