'use strict';
// Construction and acceptance are deliberately different permissions.
const VERSION='classroom-ownership-visibility.v1';
const ARTIFACTS=Object.freeze({
 chapter:{producer:'TPF-05',acceptance:'D11/PPL',publicFields:['id','version','title','units'],privateFields:['scope_ref','validation','continuation','remaps','objective_refs','prerequisite_refs','designation','treatment']},
 teaching_plan:{producer:'TPF-05',acceptance:'D11',publicFields:[],privateFields:['objectives','phases','time_ledger','remediation_branches','carry_forward']},
 explanation_guides:{producer:'TPF-21.prepare_guidance',acceptance:'D11/PPL',publicFields:[],privateFields:['teaching_units','covered_refs','uncovered_refs','expand_when','stop_when']},
 directive:{producer:'delivery engine',acceptance:'D11 permissions + D12 assistance',publicFields:[],privateFields:['restrictions','assistance_ceiling','accepted_evaluation','time_constraints','response_budget']},
 portion:{producer:'TPF-08',acceptance:'delivery engine + D14 artifact validation',publicFields:['id','sequence','teacher_message','source_refs','board_refs'],privateFields:['publication_dependencies','wait_requirement','resume_at','expected_student_action','correction_of']},
 task:{producer:'TPF-21.design_check',acceptance:'D11 authorization + D12 task validation',publicFields:['id','version','question','window','source_refs'],privateFields:['criterion_ref','expected_solution','acceptable_alternatives','inference_ceiling','assistance_ceiling','evidence_intent']},
 student_message:{producer:'authenticated student',acceptance:'transactional admission engine',publicFields:['id','sequence','text','status','source_refs','occurred_at'],privateFields:['idempotency_key','allowance_ledger','immutable_context']},
 interpretation:{producer:'TPF-21.interpret_response',acceptance:'D12',publicFields:[],privateFields:['criterion_ref','judgments','hypotheses','attempt_context','supports','does_not_establish','next_evidence_need']},
 board:{producer:'TPF-08',acceptance:'D14',publicFields:['id','version','type','content','source_refs'],privateFields:['validation','publication_dependencies','private_criteria']},
 closure:{producer:'TPF-21.close_class + delivery engine',acceptance:'D11 lifecycle + respective follow-up owners',publicFields:[],privateFields:['work_labels','pending_evaluation_refs','unresolved_question_refs','confirmed_follow_up','proposed_follow_up']},
 study_note:{producer:'TPF-20',acceptance:'existing study publication service',publicFields:['published_note'],privateFields:['reconciliation_sources','validation']},
 official_outcomes:{producer:'existing academic owners',acceptance:'attendance/Classwork/assessment/SKM/grading/progression',publicFields:[],privateFields:['all']},
});
function ownershipFor(kind){const v=ARTIFACTS[kind];if(!v)throw Object.assign(new Error('Unregistered artifact'),{code:'CLASSROOM_OWNER_UNKNOWN'});return {producer:v.producer,acceptance:v.acceptance,publicFields:[...v.publicFields],privateFields:[...v.privateFields]};}
module.exports={VERSION,ARTIFACTS,ownershipFor};
