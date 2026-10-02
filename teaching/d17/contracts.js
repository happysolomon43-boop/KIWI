'use strict';

const crypto = require('node:crypto');

const ASSESSMENT_TYPES = Object.freeze(['DIAGNOSTIC','CLASSWORK','IMPROMPTU_TEST','SCHEDULED_TEST','MID_SEMESTER','FINAL_EXAMINATION','MAKE_UP','RESIT','VERIFICATION']);
const DEFINITION_STATES = Object.freeze(['DRAFT','PLANNED','READY','CANCELLED','SUPERSEDED']);
const BLUEPRINT_LANES = Object.freeze(['FORECAST_PLANNING','ELIGIBLE_CANDIDATE']);
const BLUEPRINT_MATURITY = Object.freeze(['SKELETON','STRUCTURED','CANDIDATE','PRE_LOCK_READY']);
const RESPONSE_ARCHITECTURES = Object.freeze(['mcq_only','constructed_only','mixed']);
const TIMER_MODELS = Object.freeze(['OVERALL','PER_QUESTION_EXPLICIT_SKILL']);
const PACKAGE_STATES = Object.freeze(['ASSEMBLING','VALIDATED','LOCKED','INVALIDATED','SUPERSEDED']);
const ATTEMPT_STATES = Object.freeze(['CREATED','ACTIVE','SUBMITTED','EXPIRED','INVALIDATED','CANCELLED']);
const RESULT_STATES = Object.freeze(['NOT_FINAL','AWAITING_MARKING','INVALIDATED','VOID']);
const CANDIDATE_STATES = Object.freeze(['GENERATED','VALIDATION_PENDING','VALIDATED','REPAIR_REQUIRED','REJECTED','RETIRED','CONTAMINATED']);
const ELIGIBILITY_BASES = Object.freeze(['TAUGHT','VALIDATED_PRIOR_KNOWLEDGE','EXPLICIT_ASSUMED_PREREQUISITE']);
const RESOURCE_KEYS = Object.freeze(['notes','formula_sheet','calculator','documentation','sources','code_runner']);
const ASSESSMENT_ALLOWED_ACTIONS = Object.freeze(['SAVE_RESPONSE','SUBMIT_ATTEMPT','FLAG_ITEM','REQUEST_PROCEDURAL_CLARIFICATION','REQUEST_DEVICE_TRANSFER']);
const PROMPT_BINDINGS = Object.freeze({
  planning: Object.freeze({ family:'TPF-12', version:'1.3' }),
  generation: Object.freeze({ family:'TPF-13', version:'1.3' }),
  validation: Object.freeze({ family:'TPF-14', version:'1.4' }),
});

function fail(message, code, status=400, details=null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  return error;
}
function assertEnum(value, allowed, code, label) {
  const normalized = String(value || '').toUpperCase();
  if (!allowed.includes(normalized)) throw fail(`${label} is invalid.`, code, 400, { value });
  return normalized;
}
function iso(value, label='time') {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw fail(`${label} is invalid.`, 'TEACHING_D17_TIME_INVALID', 400, { label });
  return parsed.toISOString();
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((out,key)=>{ out[key]=stable(value[key]); return out; },{});
  return value;
}
function stableStringify(value) { return JSON.stringify(stable(value)); }
function sha256(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : stableStringify(value)).digest('hex'); }
function normalizeIdList(value) { return Object.freeze([...new Set((Array.isArray(value) ? value : []).map(String).filter(Boolean))].sort()); }
function normalizeResponseArchitecture(value={}) {
  const mode = String(value.mode || value.architecture || 'mixed').toLowerCase();
  if (!RESPONSE_ARCHITECTURES.includes(mode)) throw fail('Assessment response-form architecture is invalid.', 'TEACHING_D17_RESPONSE_ARCHITECTURE_INVALID', 400);
  return Object.freeze({ mode, families:normalizeIdList(value.families || []), locked:Boolean(value.locked) });
}
function normalizeResources(value={}) {
  const source = value && typeof value === 'object' ? value : {};
  const out = {};
  for (const key of RESOURCE_KEYS) out[key] = Boolean(source[key]);
  if (source.other) out.other = normalizeIdList(source.other);
  return Object.freeze(out);
}
function normalizeAccommodation(value={}) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.freeze({
    extra_time_percent: Math.max(0, Math.min(300, Number(source.extra_time_percent) || 0)),
    breaks_allowed: Boolean(source.breaks_allowed),
    assistive_technology: normalizeIdList(source.assistive_technology || []),
    presentation_adjustments: normalizeIdList(source.presentation_adjustments || []),
    standard_unchanged: true,
  });
}
function normalizeDefinition(input={}) {
  return Object.freeze({
    courseId:String(input.courseId || ''),
    assessmentType:assertEnum(input.assessmentType, ASSESSMENT_TYPES, 'TEACHING_D17_ASSESSMENT_TYPE_INVALID', 'Assessment type'),
    purpose:String(input.purpose || '').trim(),
    title:String(input.title || '').trim(),
    graded:Boolean(input.graded),
    definitionState:assertEnum(input.definitionState || 'DRAFT', DEFINITION_STATES, 'TEACHING_D17_DEFINITION_STATE_INVALID', 'Definition state'),
    announcedScope:input.announcedScope && typeof input.announcedScope === 'object' ? input.announcedScope : {},
    policyVersion:String(input.policyVersion || 'assessment-policy.v1'),
    sourceLineage:input.sourceLineage && typeof input.sourceLineage === 'object' ? input.sourceLineage : {},
  });
}
function isEligibleBasis(value) { return ELIGIBILITY_BASES.includes(String(value || '').toUpperCase()); }
function assertEligibleUnits(requiredIds, eligibilityRows, {allowDiagnostic=false}={}) {
  const required = normalizeIdList(requiredIds);
  const map = new Map((eligibilityRows || []).map(row=>[String(row.learning_unit_id),row]));
  const failures = [];
  for (const id of required) {
    const row = map.get(id);
    if (!row || !isEligibleBasis(row.eligibility_basis)) failures.push({learningUnitId:id, reason:row?.eligibility_basis || 'NOT_ELIGIBLE'});
  }
  if (failures.length && !allowDiagnostic) throw fail('Formal Assessment scope contains untaught or otherwise ineligible content.', 'TEACHING_D17_INELIGIBLE_SCOPE', 409, {failures});
  return Object.freeze({eligible:failures.length === 0, required, failures:Object.freeze(failures)});
}
function buildEligibilityHash(rows=[]) {
  const canonical = (rows || []).map(row=>({
    learning_unit_id:String(row.learning_unit_id),
    basis:String(row.eligibility_basis),
    course_plan_id:String(row.course_plan_id),
    coverage_version:Number(row.coverage_version || 0),
    owner_ref:String(row.owner_ref || ''),
    policy_version:String(row.policy_version || ''),
  })).sort((a,b)=>a.learning_unit_id.localeCompare(b.learning_unit_id));
  return sha256(canonical);
}
function deterministicChoiceSet({slotId,optionCount=4,responseFamily='MCQ'}={}) {
  const count = Math.max(2, Math.min(8, Number(optionCount) || 4));
  return Object.freeze({
    response_family:String(responseFamily).toUpperCase(),
    option_count:count,
    stable_option_ids:Object.freeze(Array.from({length:count},(_,i)=>`${String(slotId || 'slot')}:opt:${i+1}`)),
    ordering_authority:'DETERMINISTIC_PACKAGE_ASSEMBLER',
    model_may_change_option_count:false,
  });
}
function normalizeRubricContract(value, slotLearningUnitIds) {
  if (!value) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw fail('Rubric contract must be structured.', 'TEACHING_D17_RUBRIC_CONTRACT_INVALID', 400);
  const criteria = Array.isArray(value.criteria) ? value.criteria.map((criterion,index)=>{
    const marks = Number(criterion.marks);
    const learningUnits = normalizeIdList(criterion.learning_unit_ids || criterion.learningUnitIds || []);
    if (!(marks > 0)) throw fail('Every rubric criterion needs positive marks.', 'TEACHING_D17_RUBRIC_MARKS_INVALID', 400, {index});
    if (!learningUnits.length) throw fail('Every rubric criterion must preserve mark lineage to Learning Units/skills.', 'TEACHING_D17_RUBRIC_LINEAGE_REQUIRED', 400, {index});
    const allowed = new Set(slotLearningUnitIds);
    if (learningUnits.some(id=>!allowed.has(id))) throw fail('Rubric criterion lineage cannot expand Blueprint scope.', 'TEACHING_D17_RUBRIC_SCOPE_EXPANSION', 400, {index});
    return Object.freeze({...criterion, marks, learning_unit_ids:learningUnits});
  }) : [];
  return Object.freeze({...value, criteria:Object.freeze(criteria)});
}
function resolveCandidatePoolLimit(slot={}) {
  const raw = slot.candidate_pool_limit ?? slot.candidatePoolLimit ?? 1;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw fail('Blueprint candidate-pool limit must be an integer from 1 to 10.', 'TEACHING_D17_CANDIDATE_POOL_LIMIT_INVALID', 400);
  if (limit > 1 && !String(slot.candidate_pool_risk_reason || slot.candidatePoolRiskReason || '').trim()) {
    throw fail('Additional protected candidates require a Blueprint risk/importance reason.', 'TEACHING_D17_CANDIDATE_POOL_REASON_REQUIRED', 400);
  }
  return limit;
}
function normalizeBlueprint(input={}) {
  const lane = assertEnum(input.lane || 'ELIGIBLE_CANDIDATE', BLUEPRINT_LANES, 'TEACHING_D17_BLUEPRINT_LANE_INVALID', 'Blueprint lane');
  const maturity = assertEnum(input.maturity || 'STRUCTURED', BLUEPRINT_MATURITY, 'TEACHING_D17_BLUEPRINT_MATURITY_INVALID', 'Blueprint maturity');
  const totalMarks = Number(input.totalMarks);
  if (!(totalMarks > 0)) throw fail('Blueprint total marks must be positive.', 'TEACHING_D17_BLUEPRINT_QUANTITIES_INVALID', 400);
  const slots = (Array.isArray(input.slots) ? input.slots : []).map((slot,index)=>{
    const intended = Number(slot.intended_marks ?? slot.intendedMarks);
    if (!(intended > 0)) throw fail('Each Blueprint slot needs positive intended marks.', 'TEACHING_D17_SLOT_MARKS_INVALID', 400, {index});
    const slotId = String(slot.slot_id || slot.slotId || `slot-${index+1}`);
    const learningUnits = normalizeIdList(slot.learning_unit_ids || slot.learningUnitIds);
    const responseFamily = String(slot.response_family || slot.responseFamily || 'CONSTRUCTED').toUpperCase();
    const estimatedResponseMinutes = Number(slot.estimated_response_minutes ?? slot.estimatedResponseMinutes ?? 0);
    if (estimatedResponseMinutes < 0) throw fail('Estimated response time cannot be negative.', 'TEACHING_D17_SLOT_TIMING_INVALID', 400, {index});
    return Object.freeze({
      slot_id:slotId,
      learning_unit_ids:learningUnits,
      intended_marks:intended,
      response_family:responseFamily,
      measurement_demand:slot.measurement_demand || slot.measurementDemand || {},
      variation_requirements:slot.variation_requirements || slot.variationRequirements || {},
      rubric_contract:normalizeRubricContract(slot.rubric_contract || slot.rubricContract || null, learningUnits),
      choice_set_contract:responseFamily === 'MCQ' ? deterministicChoiceSet({slotId, optionCount:slot.option_count || slot.optionCount || 4}) : {},
      estimated_response_minutes:estimatedResponseMinutes,
      candidate_pool_limit:resolveCandidatePoolLimit(slot),
      candidate_pool_risk_reason:String(slot.candidate_pool_risk_reason || slot.candidatePoolRiskReason || '').trim() || null,
    });
  });
  const slotMarks = slots.reduce((sum,slot)=>sum+slot.intended_marks,0);
  if (slots.length && Math.abs(slotMarks-totalMarks) > 1e-6) throw fail('Blueprint slot marks must equal total marks.', 'TEACHING_D17_MARK_TOTAL_MISMATCH', 400, {totalMarks,slotMarks});
  const estimatedWorkMinutes = slots.reduce((sum,slot)=>sum+slot.estimated_response_minutes,0);
  const minimumReviewMinutes = Math.max(0, Number(input.minimumReviewMinutes ?? input.minimum_review_minutes ?? 0));
  const durationMinutes = Number(input.durationMinutes ?? input.duration_minutes ?? (estimatedWorkMinutes + minimumReviewMinutes));
  if (!(durationMinutes > 0)) throw fail('Blueprint duration must be positive.', 'TEACHING_D17_BLUEPRINT_QUANTITIES_INVALID', 400);
  if (estimatedWorkMinutes > 0 && durationMinutes < estimatedWorkMinutes + minimumReviewMinutes) throw fail('Assessment duration must cover predicted workload plus declared review capacity.', 'TEACHING_D17_TIMING_BUDGET_TOO_SMALL', 409, {durationMinutes,estimatedWorkMinutes,minimumReviewMinutes});
  const architecture = normalizeResponseArchitecture(input.responseFormArchitecture || input.response_form_architecture || {});
  const major = ['MID_SEMESTER','FINAL_EXAMINATION'].includes(String(input.assessmentType || '').toUpperCase());
  if (major && architecture.mode !== 'mixed' && !String(input.singleModeJustification || '').trim()) throw fail('A major cumulative/terminal single-mode design needs an explicit academic justification.', 'TEACHING_D17_SINGLE_MODE_JUSTIFICATION_REQUIRED', 409);
  return Object.freeze({
    lane,maturity,slots:Object.freeze(slots),responseFormArchitecture:architecture,totalMarks,durationMinutes,
    timerModel:assertEnum(input.timerModel || 'OVERALL', TIMER_MODELS, 'TEACHING_D17_TIMER_MODEL_INVALID', 'Timer model'),
    resourcePolicy:normalizeResources(input.resourcePolicy),
    accommodationPolicy:normalizeAccommodation(input.accommodationPolicy),
    singleModeJustification:String(input.singleModeJustification || '').trim() || null,
    sourceStateVersions:input.sourceStateVersions && typeof input.sourceStateVersions === 'object' ? input.sourceStateVersions : {},
    provenanceRefs:normalizeIdList(input.provenanceRefs || []),
    timingBudget:Object.freeze({estimated_work_minutes:estimatedWorkMinutes,minimum_review_minutes:minimumReviewMinutes,duration_minutes:durationMinutes}),
  });
}
function validateCandidate(candidate,{slot,eligibilityRows,allowDiagnostic=false}={}) {
  if (!candidate || typeof candidate !== 'object') throw fail('Generated Assessment candidate is invalid.', 'TEACHING_D17_CANDIDATE_INVALID', 422);
  const required = normalizeIdList(candidate.required_learning_unit_ids || candidate.requiredLearningUnitIds || slot?.learning_unit_ids || []);
  assertEligibleUnits(required, eligibilityRows, {allowDiagnostic});
  const family = String(candidate.response_family || candidate.responseFamily || slot?.response_family || '').toUpperCase();
  if (!family) throw fail('Candidate response family is required.', 'TEACHING_D17_RESPONSE_FAMILY_REQUIRED', 422);
  if (slot && family !== String(slot.response_family).toUpperCase()) throw fail('Generator changed the Blueprint response family.', 'TEACHING_D17_GENERATOR_SCOPE_EXPANSION', 422);
  if (Number(candidate.intended_marks ?? slot?.intended_marks) !== Number(slot?.intended_marks)) throw fail('Generator changed intended marks.', 'TEACHING_D17_GENERATOR_MARK_EXPANSION', 422);
  return Object.freeze({...candidate,response_family:family,required_learning_unit_ids:required,intended_marks:Number(slot?.intended_marks || candidate.intended_marks)});
}
function packageHash({blueprint,items,policySnapshot={}}) {
  return sha256({
    blueprint_id:blueprint.assessment_blueprint_id || blueprint.assessmentBlueprintId,
    blueprint_version:Number(blueprint.version_no || blueprint.versionNo || 0),
    items:(items || []).map(item=>({ordinal:Number(item.ordinal),candidate_version_id:item.candidate_version_id || item.candidateVersionId,item_hash:item.item_hash || item.itemHash})),
    response_form_architecture:blueprint.response_form_architecture || blueprint.responseFormArchitecture,
    resource_policy:blueprint.resource_policy || blueprint.resourcePolicy,
    accommodation_policy:blueprint.accommodation_policy || blueprint.accommodationPolicy,
    policy_snapshot:policySnapshot,
  });
}
function finalizationReadiness({blueprint,currentEligibilityRows=[],candidateVersions=[],itemValidations=[],wholePackageValidation=null,contaminationEvents=[],sourceVersionsCurrent=true}={}) {
  const reasons = [];
  if (!blueprint) reasons.push('BLUEPRINT_MISSING');
  else if (String(blueprint.lane) !== 'ELIGIBLE_CANDIDATE') reasons.push('FORECAST_SCOPE_NOT_ELIGIBLE');
  else if (String(blueprint.maturity) !== 'PRE_LOCK_READY') reasons.push('BLUEPRINT_NOT_PRE_LOCK_READY');
  if (!sourceVersionsCurrent) reasons.push('AUTHORITATIVE_INPUT_STALE');
  try {
    const required = (candidateVersions || []).flatMap(candidate=>candidate.required_learning_unit_ids || []);
    assertEligibleUnits(required,currentEligibilityRows);
  } catch (_) { reasons.push('CURRENT_ELIGIBILITY_FAILED'); }
  const validated = new Set((itemValidations || []).filter(v=>v.outcome === 'PASS').map(v=>String(v.candidate_version_id)));
  for (const candidate of candidateVersions || []) {
    if (!validated.has(String(candidate.candidate_version_id))) reasons.push(`ITEM_NOT_VALIDATED:${candidate.candidate_version_id}`);
    if (candidate.protection_state === 'CONTAMINATED' || ['RETIRED','CONTAMINATED','REJECTED','REPAIR_REQUIRED'].includes(String(candidate.candidate_state || ''))) reasons.push(`CANDIDATE_NOT_USABLE:${candidate.candidate_version_id}`);
  }
  if (!wholePackageValidation || wholePackageValidation.outcome !== 'PASS') reasons.push('WHOLE_PACKAGE_NOT_VALIDATED');
  if ((contaminationEvents || []).some(event=>event.selective_recheck_required !== false)) reasons.push('UNRESOLVED_CONTAMINATION');
  return Object.freeze({ready:reasons.length === 0,reasons:Object.freeze([...new Set(reasons)])});
}
function classifyClarification(text='') {
  const value = String(text).trim();
  const procedural = /\b(time|timer|save|submit|navigation|next question|previous question|calculator|formula sheet|allowed resource|resource|technical|connection|device|instructions? mean|format|where|how do i enter|flag this question|do i (?:answer|attempt|complete) (?:both|all|every|this|these)(?: parts?| questions?)?|can i (?:change|edit|save) (?:my |this )?answer)\b/i.test(value);
  const content = /\b(which (?:option|answer)|what(?:'s| is) the (?:answer|solution)|give me (?:the )?(?:answer|solution)|tell me (?:the )?(?:answer|solution)|solve(?: this| it)?|hint|correct answer|is (?:option [a-z0-9]+|this|my answer) correct|check my answer|which method|method should|which formula|formula should|explain the concept)\b/i.test(value);
  return content ? 'CONTENT_HELP_PROHIBITED' : procedural ? 'PROCEDURAL_CLARIFICATION' : 'REVIEW_REQUIRED';
}
function assertAssessmentAction(action) {
  const normalized = String(action || '').toUpperCase();
  if (!ASSESSMENT_ALLOWED_ACTIONS.includes(normalized)) throw fail('Action is prohibited during Assessment Mode.', 'TEACHING_D17_ASSESSMENT_ACTION_PROHIBITED', 403, {action:normalized});
  return normalized;
}
function attemptExpiry(startedAt,durationMinutes,extraTimePercent=0) {
  const start = new Date(startedAt);
  if (!Number.isFinite(start.getTime())) throw fail('Attempt start time is invalid.', 'TEACHING_D17_TIME_INVALID', 400);
  const minutes = Number(durationMinutes) * (1 + Math.max(0,Number(extraTimePercent)||0)/100);
  return new Date(start.getTime()+minutes*60000).toISOString();
}
function missedAssessmentPathway(assessmentType,{systemFailure=false,excused=false,policy={}}={}) {
  const type = assertEnum(assessmentType, ASSESSMENT_TYPES, 'TEACHING_D17_ASSESSMENT_TYPE_INVALID', 'Assessment type');
  if (systemFailure) return Object.freeze({outcome:'SYSTEM_PROTECTED',next_action:'RESCHEDULE_OR_RECOVER',academic_failure:false});
  if (type === 'CLASSWORK') return Object.freeze({outcome:excused?'EXCUSED_MISSED':'MISSED_CLASSWORK',next_action:policy.classwork_makeup_required?'MAKE_UP':'INCOMPLETE_OR_POLICY_REVIEW',academic_failure:false});
  if (type === 'SCHEDULED_TEST') return Object.freeze({outcome:excused?'EXCUSED_MISSED':'MISSED_SCHEDULED_TEST',next_action:'MAKE_UP_OR_INCOMPLETE',academic_failure:false});
  if (type === 'IMPROMPTU_TEST') return Object.freeze({outcome:excused?'EXCUSED_MISSED':'MISSED_IMPROMPTU_TEST',next_action:policy.impromptu_makeup_required?'MAKE_UP':'NO_RETROACTIVE_FAILURE',academic_failure:false});
  if (type === 'FINAL_EXAMINATION') return Object.freeze({outcome:excused?'EXCUSED_MISSED':'INCOMPLETE_FINAL',next_action:'MAKE_UP_OR_INCOMPLETE',academic_failure:false});
  return Object.freeze({outcome:'MISSED_ASSESSMENT',next_action:'POLICY_REVIEW',academic_failure:false});
}

module.exports = {
  ASSESSMENT_TYPES,DEFINITION_STATES,BLUEPRINT_LANES,BLUEPRINT_MATURITY,RESPONSE_ARCHITECTURES,TIMER_MODELS,
  PACKAGE_STATES,ATTEMPT_STATES,RESULT_STATES,CANDIDATE_STATES,ELIGIBILITY_BASES,RESOURCE_KEYS,
  ASSESSMENT_ALLOWED_ACTIONS,PROMPT_BINDINGS,fail,iso,sha256,stableStringify,normalizeIdList,
  normalizeResponseArchitecture,normalizeResources,normalizeAccommodation,normalizeDefinition,isEligibleBasis,
  assertEligibleUnits,buildEligibilityHash,deterministicChoiceSet,normalizeRubricContract,resolveCandidatePoolLimit,
  normalizeBlueprint,validateCandidate,packageHash,finalizationReadiness,classifyClarification,assertAssessmentAction,
  attemptExpiry,missedAssessmentPathway,
};