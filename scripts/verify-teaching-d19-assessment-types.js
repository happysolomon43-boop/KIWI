'use strict';

const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const contracts=require('../teaching/d19/contracts');
const {createD19AssessmentTypeService}=require('../teaching/d19/service');
const policy=require('../teaching/policy');

const root=path.join(__dirname,'..');
const required=[
  'teaching/d19/contracts.js','teaching/d19/service.js','teaching/d19/index.js',
  'tests/teaching/unit/d19-assessment-types.test.js','tests/teaching/integration/d19-assessment-types-schema.test.js',
  'docs/teaching/d19-assessment-types.md','docs/teaching/d19-source-resolution.md',
  '.github/workflows/teaching-d19-assessment-types.yml',
];
for(const file of required)assert.equal(fs.existsSync(path.join(root,file)),true,`missing ${file}`);
assert.equal(contracts.D19_CONTRACT_VERSION,'d19.measurement.v1');
assert.deepEqual(Object.keys(contracts.TYPE_PROFILES).sort(),['CLASSWORK','DIAGNOSTIC','FINAL_EXAMINATION','IMPROMPTU_TEST','MAKE_UP','MID_SEMESTER','RESIT','SCHEDULED_TEST','VERIFICATION'].sort());
assert.equal(contracts.TYPE_PROFILES.DIAGNOSTIC.gradebookPosture,'PROHIBITED');
assert.equal(contracts.TYPE_PROFILES.IMPROMPTU_TEST.announced,false);
assert.equal(contracts.TYPE_PROFILES.FINAL_EXAMINATION.scopeMode,'WHOLE_ELIGIBLE_COURSE_STRATEGIC_SAMPLE');
const imp=policy.getTeachingDecision('TCH-0079'),elig=policy.getTeachingDecision('TCH-0694');
assert.equal(imp.policy_version,'impromptu-budget.v1');assert.equal(imp.decision.maximum_class_time_ratio,0.20);assert.equal(imp.decision.default_course_grade_weight_cap,0.10);assert.equal(imp.decision.package_must_be_ready_and_validated_before_class,true);
assert.deepEqual(elig.decision.graded_content_must_be,['TAUGHT','VALIDATED_PRIOR_KNOWLEDGE']);assert.equal(elig.decision.explicit_prerequisite_must_be_validated_before_graded_use,true);
const routes=fs.readFileSync(path.join(root,'teaching/d17/routes.js'),'utf8');
assert.match(routes,/createD19AssessmentTypeService/);assert.match(routes,/measurement-policy/);assert.match(routes,/mountD18Routes/);
const service=fs.readFileSync(path.join(root,'teaching/d19/service.js'),'utf8');
for(const marker of ['assertImpromptuBudget','classTimeContract','createMakeUp','markReviewHandoff','retentionEvidenceHandoff','UNQUALIFIED_UNTIL_D30'])assert.match(service,new RegExp(marker));
for(const prohibited of ['openai','anthropic','gemini','groq','providerApiKey','service_role'])assert.doesNotMatch(service,new RegExp(prohibited,'i'));
assert.throws(()=>createD19AssessmentTypeService({}),/accepted D17 Assessment service/);
console.log('KIWI Teaching D19 Assessment Types verification passed.');
