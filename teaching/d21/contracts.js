'use strict';

const OUTCOMES=Object.freeze({
  INCOMPLETE:'INCOMPLETE',CLEAN_PASS:'CLEAN_PASS',PASS_REMEDIATION_REQUIRED:'PASS_REMEDIATION_REQUIRED',
  RESIT_REQUIRED:'RESIT_REQUIRED',RECOVERY_REQUIRED:'RECOVERY_PROGRAMME_REQUIRED',REPEAT_REQUIRED:'REPEAT_REQUIRED',
  FAILED_AFTER_RESIT_RECOVERY:'FAILED_AFTER_RESIT_OR_RECOVERY',
});
const PATHWAY_TYPES=Object.freeze({REMEDIATION:'REMEDIATION',RESIT_PREPARATION:'RESIT_PREPARATION',TARGETED_VERIFICATION:'TARGETED_VERIFICATION',RECOVERY:'RECOVERY',REPEAT:'REPEAT'});
const PATHWAY_STATES=Object.freeze({DRAFT:'DRAFT',ACTIVE:'ACTIVE',READY_FOR_VERIFICATION:'READY_FOR_VERIFICATION',VERIFIED:'VERIFIED',FAILED:'FAILED',SUPERSEDED:'SUPERSEDED',CANCELLED:'CANCELLED'});
const TPF17=Object.freeze({family:'TPF-17',version:'1.1',sha256:'e297d3cc7e0f4c7febb1e13fcde2752a772f4a0bd61aea58170ed7dcc916674e'});
const TPF19=Object.freeze({family:'TPF-19',version:'1.0',sha256:'abb79225448de4a2350dc7366b2e7ca4088212e7e32991a58dce7199d8cd8831'});
const PASS_STATES=Object.freeze(new Set(['INDEPENDENT','SECURE','TRANSFERABLE']));

function fail(message,code='TEACHING_D21_CONTRACT_INVALID',status=409,details=null){const e=new Error(message);e.code=code;e.status=status;if(details)e.details=details;return e;}
function asArray(v){return Array.isArray(v)?v:[];}
function asObject(v){return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}
function upper(v){return String(v||'').trim().toUpperCase();}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function stableUnique(values){return [...new Set(asArray(values).map(String).filter(Boolean))].sort();}
function stableValue(value){if(value instanceof Date)return value.toISOString();if(Array.isArray(value))return value.map(stableValue);if(value&&typeof value==='object')return Object.keys(value).sort().reduce((o,k)=>{o[k]=stableValue(value[k]);return o;},{});return value;}

function normalizeProgressionPolicy(policy={}){
  const c=asObject(policy.certification_rules||policy.certificationRules),p=asObject(policy.pathway_rules||policy.pathwayRules),r=asObject(policy.resit_policy||policy.resitPolicy),repeat=asObject(policy.repeat_policy||policy.repeatPolicy),g=asObject(policy.gpa_policy||policy.gpaPolicy);
  const passThreshold=finite(c.pass_threshold??c.passThreshold);
  const terminalFloor=finite(c.terminal_floor??c.terminalFloor);
  const maxStandardResits=Number.isInteger(Number(r.max_standard_resits??r.maxStandardResits))?Math.max(0,Number(r.max_standard_resits??r.maxStandardResits)):1;
  return Object.freeze({
    policyId:policy.progression_policy_id||policy.policyId||null,versionNo:Number(policy.version_no||policy.versionNo||1),state:upper(policy.policy_state||policy.state||'LOCKED'),academicCredits:finite(policy.academic_credits??policy.academicCredits),
    certification:Object.freeze({passThreshold,terminalFloor,requiredAssessmentTypes:Object.freeze(stableUnique(c.required_assessment_types||c.requiredAssessmentTypes).map(upper)),requireAllRequiredLearningUnits:c.require_all_required_learning_units!==false,requireFinalizedRequiredAssessments:c.require_finalized_required_assessments!==false,requireTrustworthyTopicEvidence:c.require_trustworthy_topic_evidence!==false}),
    pathways:Object.freeze({narrowGapMaxUnits:Math.max(1,Number(p.narrow_gap_max_units??p.narrowGapMaxUnits??2)),distributedGapMinUnits:Math.max(2,Number(p.distributed_gap_min_units??p.distributedGapMinUnits??3)),systemicGapRatio:Math.max(0,Math.min(1,Number(p.systemic_gap_ratio??p.systemicGapRatio??0.5))),prerequisiteDestinationRemediation:p.prerequisite_destination_remediation!==false}),
    resit:Object.freeze({maxStandardResits,componentTreatment:upper(r.component_treatment||r.componentTreatment||'REPLACE_FAILED_COMPONENT'),passedAfterResitStatus:String(r.passed_after_resit_status||r.passedAfterResitStatus||'PASSED_AFTER_RESIT')}),
    repeat:Object.freeze({gpaTreatment:upper(repeat.gpa_treatment||repeat.gpaTreatment||'' )||null,gradeTreatment:upper(repeat.grade_treatment||repeat.gradeTreatment||'PRESERVE_ALL_ATTEMPTS')||null}),
    gpa:Object.freeze({weightingMode:upper(g.weighting_mode||g.weightingMode||''),creditSource:upper(g.credit_source||g.creditSource||'ACADEMIC_CREDITS'),decimalPlaces:Math.max(0,Math.min(4,Number(g.decimal_places??g.decimalPlaces??2)))}),
  });
}

function assertCoursePolicyComplete(policy){const p=normalizeProgressionPolicy(policy);if(p.state!=='LOCKED')throw fail('A locked Progression Policy is required.','TEACHING_D21_PROGRESSION_POLICY_NOT_LOCKED');if(p.certification.passThreshold==null)throw fail('Course Progression Policy must explicitly configure a pass threshold; KIWI has no hidden global pass mark.','TEACHING_D21_PASS_THRESHOLD_POLICY_REQUIRED');if(p.certification.passThreshold<0||p.certification.passThreshold>100)throw fail('Progression pass threshold must be within 0-100.','TEACHING_D21_PASS_THRESHOLD_INVALID',400);if(p.certification.terminalFloor!=null&&(p.certification.terminalFloor<0||p.certification.terminalFloor>100))throw fail('Progression pass threshold must be within 0-100.','TEACHING_D21_TERMINAL_FLOOR_INVALID',400);return p;}
function assertSemesterGpaPolicyComplete(policy){const p=normalizeProgressionPolicy(policy);if(p.state!=='LOCKED')throw fail('A locked Semester GPA Policy is required.','TEACHING_D21_GPA_POLICY_NOT_LOCKED');if(!p.gpa.weightingMode)throw fail('Semester GPA weighting mode must be explicitly configured.','TEACHING_D21_GPA_POLICY_REQUIRED');if(p.gpa.creditSource.includes('STUDY')||p.gpa.creditSource.includes('HOUR'))throw fail('Study hours are not academic credits and cannot weight GPA.','TEACHING_D21_STUDY_HOURS_NOT_CREDITS');if(['EQUAL_WEIGHT','EQUAL_WEIGHT_NO_CREDIT_SYSTEM'].includes(p.gpa.weightingMode)&&p.gpa.creditSource!=='NO_CREDIT_SYSTEM')throw fail('Equal-weight GPA is permitted only under an explicit no-credit-system policy.','TEACHING_D21_EQUAL_WEIGHT_REQUIRES_NO_CREDIT_POLICY');return p;}

function gradeScaleOutcome(score,gradeScalePolicy={}){
  const n=finite(score);if(n==null)return null;const raw=asArray(gradeScalePolicy.bands||gradeScalePolicy.grade_bands||gradeScalePolicy.scale);
  const bands=raw.map(b=>({min:finite(b.min??b.minimum??b.min_percentage),max:finite(b.max??b.maximum??b.max_percentage),grade:b.grade??b.label??null,gradePoint:finite(b.grade_point??b.gradePoint??b.points)})).filter(b=>b.min!=null&&b.grade!=null).sort((a,b)=>b.min-a.min);
  const match=bands.find(b=>n>=b.min&&(b.max==null||n<=b.max));if(!match)return null;return Object.freeze({grade:String(match.grade),gradePoint:match.gradePoint,score:n});
}

function authoritativeVersionDigest(snapshot={}){
  const coverage=asArray(snapshot.coverage).map(row=>[
    String(row.coverage_entry_id||row.learning_unit_id||''),Number(row.coverage_version||0),
    row.found_at||null,row.mapped_at||null,row.planned_at||null,row.taught_at||null,
    row.validated_prior_knowledge_at||null,row.instructionally_complete_at||null,row.assessed_at||null,
    row.excluded_at||null,row.exclusion_reason||null,row.instructional_completion_basis||null,
  ]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
  const learningUnits=asArray(snapshot.learningUnits).map(row=>[
    String(row.learning_unit_id||''),String(row.topic_id||''),String(row.subtopic_id||''),
    String(row.criticality||''),row.foundational===true,
    row.metadata?.required===false?false:true,row.metadata?.optional===true,
  ]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
  const assessments=asArray(snapshot.assessments).map(row=>[
    String(row.assessment_id||''),Number(row.state_version||0),upper(row.assessment_type),
    upper(row.definition_state),row.graded===true,row.source_lineage?.required_for_completion===true,
  ]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
  const assessmentResults=asArray(snapshot.assessmentResults).map(row=>[
    String(row.assessment_result_id||''),String(row.assessment_id||''),Number(row.result_version||0),
    upper(row.marking_state),upper(row.release_state),row.review_blocked===true,
    row.raw_percentage==null?null:Number(row.raw_percentage),
  ]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
  const openAppeals=asArray(snapshot.openAppeals).map(row=>[
    String(row.grade_appeal_id||''),String(row.assessment_result_id||''),upper(row.appeal_state),
  ]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
  const invalidAttempts=asArray(snapshot.invalidAssessmentAttempts).map(row=>[
    String(row.assessment_attempt_id||''),Number(row.state_version||0),Number(row.finalization_version||0),
    upper(row.attempt_state),upper(row.result_state),String(row.invalidation_reason||''),
  ]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
  const integrity=asArray(snapshot.unresolvedIntegrityIssues).map(row=>[
    String(row.integrity_review_id||row.submission_id||''),Number(row.review_version||0),
    upper(row.rule_alignment),upper(row.capability_evidence),upper(row.verification_state),
  ]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
  return stableValue({
    course_state_version:Number(snapshot.course?.state_version||0),
    course_plan_id:snapshot.coursePlan?.course_plan_id||null,
    course_plan_version:Number(snapshot.coursePlan?.version_no||0),
    learning_units:learningUnits,
    coverage,
    course_result_id:snapshot.courseResult?.course_result_snapshot_id||null,
    course_result_version:Number(snapshot.courseResult?.version_no||0),
    gradebook_entry_ids:stableUnique(snapshot.courseResult?.source_gradebook_entry_ids||[]),
    progression_policy_id:snapshot.progressionPolicy?.progression_policy_id||null,
    progression_policy_version:Number(snapshot.progressionPolicy?.version_no||0),
    topic_versions:asArray(snapshot.topicScores).map(t=>[String(t.topic_id||''),Number(t.version_no||0)]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),
    assessment_definitions:assessments,
    assessment_results:assessmentResults,
    open_appeals:openAppeals,
    invalid_assessment_attempts:invalidAttempts,
    unresolved_integrity:integrity,
    skm_versions:asArray(snapshot.knowledgeStates).map(s=>[String(s.learning_unit_id||''),Number(s.version_no||0)]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),
  });
}

module.exports={OUTCOMES,PATHWAY_TYPES,PATHWAY_STATES,TPF17,TPF19,PASS_STATES,fail,asArray,asObject,upper,finite,stableUnique,stableValue,normalizeProgressionPolicy,assertCoursePolicyComplete,assertSemesterGpaPolicyComplete,gradeScaleOutcome,authoritativeVersionDigest};
