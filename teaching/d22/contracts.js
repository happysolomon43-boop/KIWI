'use strict';

const TPF08 = Object.freeze({
  family:'TPF-08',
  version:'1.2',
  sha256:'b6c65e2f152c5260f822a06348de016eb6cfb61e1b8695dd4f936c014a99fb77',
  styleEnvelopeVersion:'tpf08.teacher-style-envelope.v1',
});
const TPF18 = Object.freeze({
  family:'TPF-18',
  version:'1.0',
  sha256:'1ea28ec7d84ded6092949bd0656f83450178386d5990077f02d033208feec7d5',
});

const STYLE_FIELDS = Object.freeze([
  'teacher_identity_ref','warmth','directness','formality','expressiveness','humor_frequency',
  'encouragement_intensity','challenge_style','accountability_style','conversationality','familiarity_level',
]);
const THREE = Object.freeze(['low','moderate','high']);
const STYLE_ENUMS = Object.freeze({
  warmth:THREE,directness:THREE,formality:THREE,expressiveness:THREE,
  humor_frequency:Object.freeze(['none','low','moderate']),encouragement_intensity:THREE,
  challenge_style:Object.freeze(['gentle','balanced','direct']),
  accountability_style:Object.freeze(['soft','balanced','firm']),conversationality:THREE,
  familiarity_level:Object.freeze(['new','established','familiar']),
});
const BROAD_STYLE_PREFERENCES = Object.freeze(['surprise_me','more_direct','more_relaxed','more_formal','more_energetic']);

// Product policy, not a model interpretation. Labels always map to the same coherent
// profile independent of Course subject, student performance, demographics or gender.
const SAFE_PROFILE_LIBRARY = Object.freeze({
  BALANCED:Object.freeze({
    warmth:'moderate',directness:'moderate',formality:'moderate',expressiveness:'moderate',humor_frequency:'low',
    encouragement_intensity:'moderate',challenge_style:'balanced',accountability_style:'balanced',conversationality:'moderate',
  }),
  DIRECT:Object.freeze({
    warmth:'moderate',directness:'high',formality:'moderate',expressiveness:'low',humor_frequency:'low',
    encouragement_intensity:'moderate',challenge_style:'direct',accountability_style:'firm',conversationality:'low',
  }),
  RELAXED:Object.freeze({
    warmth:'high',directness:'moderate',formality:'low',expressiveness:'moderate',humor_frequency:'moderate',
    encouragement_intensity:'high',challenge_style:'balanced',accountability_style:'balanced',conversationality:'high',
  }),
  FORMAL:Object.freeze({
    warmth:'moderate',directness:'high',formality:'high',expressiveness:'low',humor_frequency:'none',
    encouragement_intensity:'low',challenge_style:'balanced',accountability_style:'firm',conversationality:'low',
  }),
  ENERGETIC:Object.freeze({
    warmth:'high',directness:'moderate',formality:'moderate',expressiveness:'high',humor_frequency:'moderate',
    encouragement_intensity:'high',challenge_style:'balanced',accountability_style:'balanced',conversationality:'high',
  }),
});
const PREFERENCE_PROFILE = Object.freeze({
  more_direct:'DIRECT',more_relaxed:'RELAXED',more_formal:'FORMAL',more_energetic:'ENERGETIC',
});
const APPROVED_DISPLAY_NAMES = Object.freeze(['Teacher Aster','Teacher Linden','Teacher Marlow','Teacher Quinn','Teacher Rowan']);

const TEACHER_CODE = Object.freeze({
  academic_honesty:true,
  mark_manipulation_forbidden:true,
  prohibited_assessment_help_forbidden:true,
  humiliation_forbidden:true,
  emotional_manipulation_forbidden:true,
  admit_and_correct_errors:true,
  accommodations_respected:true,
  arbitrary_punishment_forbidden:true,
  relationship_manipulation_forbidden:true,
});

const HIGH_STAKES_REGISTERS = new Set([
  'FAILURE','INTEGRITY','EMERGENCY','HIGH_STAKES','SERIOUS_WARNING','CONTROLLED_ASSESSMENT','EXAMINATION',
]);
const ACADEMIC_TRUTH_FIELDS = new Set([
  'official_mark','official_marks','official_grade','grade','marks','rubric_credit','difficulty','assessment_difficulty',
  'attendance','attendance_outcome','deadline','resit_eligibility','progression','progression_outcome','mastery_state','skm_state',
  'course_scope','exit_standard','accommodation_decision','integrity_outcome','gradebook_write','authoritative_commit',
]);

function fail(message,code,status=422,details=null){const e=new Error(message);e.code=code;e.status=status;if(details)e.details=details;return e;}
function cleanString(value,field,{required=true,max=120}={}){const out=String(value??'').trim();if(required&&!out)throw fail(`${field} is required.`,'TEACHING_D22_INPUT_INVALID',400);if(out.length>max)throw fail(`${field} is too long.`,'TEACHING_D22_INPUT_INVALID',400);return out||null;}
function normalizeBroadPreference(value,{allowNull=true}={}){if(value==null||String(value).trim()===''){if(allowNull)return null;return 'surprise_me';}const v=String(value).trim().toLowerCase();if(!BROAD_STYLE_PREFERENCES.includes(v))throw fail('Unsupported broad Teacher style preference.','TEACHING_D22_STYLE_PREFERENCE_INVALID',400);return v;}
function randomIndex(randomUUID,length){const raw=String(randomUUID()).replace(/-/g,'');const n=parseInt(raw.slice(0,8),16);return Number.isFinite(n)?n%length:0;}
function profileForPreference(preference,{randomUUID=()=> '00000000'}={}){
  const p=normalizeBroadPreference(preference,{allowNull:true})||'surprise_me';
  const key=p==='surprise_me'?Object.keys(SAFE_PROFILE_LIBRARY)[randomIndex(randomUUID,Object.keys(SAFE_PROFILE_LIBRARY).length)]:PREFERENCE_PROFILE[p];
  return Object.freeze({profileKey:key,traits:SAFE_PROFILE_LIBRARY[key],preference:p,fit:p==='surprise_me'?'KIWI_DEFAULTS':'EXPLICIT_BROAD_STYLE_PREFERENCE'});
}
function displayNameFromApprovedPool(randomUUID=()=> '00000000'){return APPROVED_DISPLAY_NAMES[randomIndex(randomUUID,APPROVED_DISPLAY_NAMES.length)];}
function validateTrait(field,value){const v=String(value||'');if(!STYLE_ENUMS[field]?.includes(v))throw fail(`Teacher style ${field} is invalid.`,'TEACHING_D22_STYLE_ENVELOPE_INVALID',422,{field,value});return v;}
function validateCoreTraits(input={}){
  const out={};for(const field of STYLE_FIELDS.slice(1,-1))out[field]=validateTrait(field,input[field]);return Object.freeze(out);
}
function buildStyleEnvelope({teacherIdentityRef,coreTraits,familiarityLevel}){
  const ref=cleanString(teacherIdentityRef,'teacherIdentityRef',{max:180});const traits=validateCoreTraits(coreTraits);
  const envelope={teacher_identity_ref:ref,...traits,familiarity_level:validateTrait('familiarity_level',familiarityLevel)};
  return validateStyleEnvelope(envelope);
}
function validateStyleEnvelope(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw fail('Teacher Style Envelope must be an object.','TEACHING_D22_STYLE_ENVELOPE_INVALID');
  const keys=Object.keys(value);if(keys.length!==STYLE_FIELDS.length||STYLE_FIELDS.some((field)=>!Object.prototype.hasOwnProperty.call(value,field))||keys.some((field)=>!STYLE_FIELDS.includes(field)))throw fail('Teacher Style Envelope must match the exact canonical TPF-08 field set.','TEACHING_D22_STYLE_ENVELOPE_FIELDS_INVALID',422,{expected:STYLE_FIELDS,actual:keys});
  cleanString(value.teacher_identity_ref,'teacher_identity_ref',{max:180});
  for(const field of STYLE_FIELDS.slice(1))validateTrait(field,value[field]);
  return Object.freeze({...value});
}
function assertNoAcademicTruthMutation(value,path='output'){
  if(value==null)return true;if(Array.isArray(value)){value.forEach((v,i)=>assertNoAcademicTruthMutation(v,`${path}[${i}]`));return true;}
  if(typeof value!=='object')return true;
  for(const [key,child] of Object.entries(value)){
    if(ACADEMIC_TRUTH_FIELDS.has(String(key).toLowerCase()))throw fail(`Teacher personality output may not own ${key}.`,'TEACHING_D22_ACADEMIC_AUTHORITY_EXCEEDED',409,{path:`${path}.${key}`});
    assertNoAcademicTruthMutation(child,`${path}.${key}`);
  }
  return true;
}
function contextualStyle(envelope,register='NORMAL'){
  const validated=validateStyleEnvelope(envelope);const r=String(register||'NORMAL').trim().toUpperCase();
  return Object.freeze({...validated,humor_frequency:HIGH_STAKES_REGISTERS.has(r)?'none':validated.humor_frequency,context_register:r,academic_truth_mutation_allowed:false});
}
function evidenceSpecificPraise({evidenceDescription,envelope}){
  const evidence=cleanString(evidenceDescription,'evidenceDescription',{required:false,max:500});if(!evidence)return null;
  const style=validateStyleEnvelope(envelope);const prefix=style.encouragement_intensity==='high'?'Strong work:':style.encouragement_intensity==='low'?'Noted:':'Good work:';
  return `${prefix} ${evidence}`;
}
function accountabilityMessage({authoritativeFact,requiredAction,envelope}){
  const fact=cleanString(authoritativeFact,'authoritativeFact',{max:700});const action=cleanString(requiredAction,'requiredAction',{max:500});const style=validateStyleEnvelope(envelope);
  const opening=style.accountability_style==='firm'?'This requirement still applies.':style.accountability_style==='soft'?'We still need to follow this requirement.':'This requirement remains in effect.';
  return `${opening} ${fact} Next action: ${action}`;
}
function normalizeInteractionProfile(raw={}){
  const source=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
  const explanation=source.shorter_explanations===true||source.explanation_density==='compact'?'compact':source.explanation_density==='extended'?'extended':'standard';
  const examples=source.more_examples===true||source.examples==='more'?'more':source.examples==='fewer'?'fewer':'standard';
  const filler=source.less_filler===true||source.filler_tolerance==='minimal'?'minimal':'standard';
  const register=['standard','more_formal','more_relaxed'].includes(String(source.register||''))?String(source.register):'standard';
  const formatting=['standard','stepwise','concise_blocks'].includes(String(source.formatting||''))?String(source.formatting):'standard';
  return Object.freeze({explanation_density:explanation,examples,filler_tolerance:filler,register,formatting,teacher_identity_mutation:false,academic_standard_mutation:false,pedagogy_override:false});
}
function shortStyleDescription(envelope){
  const e=validateStyleEnvelope(envelope);const pieces=[];
  if(e.directness==='high')pieces.push('direct');else if(e.warmth==='high')pieces.push('warm');else pieces.push('balanced');
  if(e.formality==='high')pieces.push('formal');else if(e.conversationality==='high')pieces.push('conversational');
  if(e.accountability_style==='firm')pieces.push('firm on commitments');else if(e.encouragement_intensity==='high')pieces.push('encouraging');
  return pieces.slice(0,3).join(', ');
}
function teacherChangeTransition({displayName,requestId}){
  const name=cleanString(displayName,'displayName',{max:120});const requestRef=cleanString(requestId,'requestId',{max:180});
  return Object.freeze({
    request_ref:requestRef,
    message:`${name} is now your AI Teacher for this Course. The existing Course record, schedule, attendance, Work, Assessment history, marks, and progression state are preserved. The new Teacher can use that authoritative record but will not pretend to personally remember Classes or events they did not conduct.`,
    preserves_all_academic_state:true,
    fabricated_shared_memory:false,
    familiarity_inference_forbidden:true,
  });
}

module.exports={TPF08,TPF18,STYLE_FIELDS,STYLE_ENUMS,BROAD_STYLE_PREFERENCES,SAFE_PROFILE_LIBRARY,PREFERENCE_PROFILE,APPROVED_DISPLAY_NAMES,TEACHER_CODE,HIGH_STAKES_REGISTERS,ACADEMIC_TRUTH_FIELDS,fail,cleanString,normalizeBroadPreference,profileForPreference,displayNameFromApprovedPool,validateCoreTraits,buildStyleEnvelope,validateStyleEnvelope,assertNoAcademicTruthMutation,contextualStyle,evidenceSpecificPraise,accountabilityMessage,normalizeInteractionProfile,shortStyleDescription,teacherChangeTransition};
