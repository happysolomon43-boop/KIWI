'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const contracts=require('../teaching/d17/contracts');
const {CAPABILITIES}=require('../teaching/d17/intelligence');
const {getCapability}=require('../teaching/capability-registry');

const TASKS=['TCH-0052','TCH-0053','TCH-0054','TCH-0055','TCH-0056',...Array.from({length:31},(_,i)=>`TCH-${String(326+i).padStart(4,'0')}`),'TCH-0676',...Array.from({length:9},(_,i)=>`TCH-${String(717+i).padStart(4,'0')}`),'TCH-0727','TCH-0733','TCH-0734',...Array.from({length:7},(_,i)=>`TCH-${String(891+i).padStart(4,'0')}`)];
assert.equal(TASKS.length,56,'D17 must account for exactly 56 canonical tasks');
assert.equal(new Set(TASKS).size,56,'D17 task IDs must be unique');
assert.deepEqual(contracts.PROMPT_BINDINGS,{planning:{family:'TPF-12',version:'1.3'},generation:{family:'TPF-13',version:'1.3'},validation:{family:'TPF-14',version:'1.4'}});
for(const [name,id] of Object.entries(CAPABILITIES)){
  const capability=getCapability(id);
  assert.ok(capability,`Missing capability ${name}:${id}`);
  assert.notEqual(capability.authority,'T0',`D17 AI adapter must not invoke T0 capability ${id}`);
  assert.ok(['TPF-12','TPF-13','TPF-14'].includes(capability.prompt_family_id),`Unexpected D17 prompt family for ${id}`);
}
const files=['teaching/d17/contracts.js','teaching/d17/intelligence.js','teaching/d17/service.js','teaching/d17/routes.js','teaching/d17/runtime.js','teaching/repositories/d17-assessments.js'];
const source=files.map(p=>fs.readFileSync(p,'utf8')).join('\n');
for(const forbidden of ['@google/generative-ai','GoogleGenerativeAI','openai','anthropic','gemini-','gpt-','claude-'])assert.equal(source.toLowerCase().includes(forbidden.toLowerCase()),false,`D17 may not hard-code provider/model token ${forbidden}`);
for(const required of [
  /eligibility_is_authoritative:true/,
  /package_lock_t0_only:true/,
  /generator_validator_independence:true/,
  /WHOLE_PACKAGE_NOT_VALIDATED/,
  /CURRENT_ELIGIBILITY_FAILED/,
  /TEACHING_D17_PPL_WORKSPACE_REQUIRED/,
  /candidate_pool_limit/,
  /resolveContamination/,
  /UNTAUGHT_DEPENDENCY_DETECTED/,
  /verifyObjectiveKey/,
  /verifySolution/,
  /reviewInterpretiveRubric/,
  /TEACHING_ASSESSMENT_ATTEMPT/,
  /ASSESSMENT_EXPIRY_DUE/,
  /CONTENT_HELP_PROHIBITED/,
  /student_penalty_allowed:false/,
  /protected_marking_payload/,
  /public_item_payload/,
]) assert.match(source,required);
assert.doesNotMatch(fs.readFileSync('teaching/d17/routes.js','utf8'),/protected_marking_payload|protected_payload/,'D17 browser routes must not project protected marking/candidate material');
const repositorySource=fs.readFileSync('teaching/repositories/d17-assessments.js','utf8');
assert.match(repositorySource,/values\(\$1,\$2,\$3,\$4,\$5,'ASSEMBLING',null,null,null/,'D17 Package must assemble inside the transaction before lock');
assert.match(repositorySource,/set package_state='LOCKED',package_hash=\$3/,'D17 Package lock must be an explicit final repository transition');
const assemblingAt=repositorySource.indexOf("'ASSEMBLING',null,null,null");
const itemInsertAt=repositorySource.indexOf('insert into public.teaching_assessment_package_items');
const lockAt=repositorySource.indexOf("set package_state='LOCKED'");
assert.ok(assemblingAt>=0&&itemInsertAt>assemblingAt&&lockAt>itemInsertAt,'D17 Package order must be ASSEMBLING -> item snapshot -> LOCKED');

const migration=fs.readFileSync('migrations/20261002_teaching_d17_assessment_domain.sql','utf8');
for(const table of ['teaching_assessments','teaching_assessment_blueprints','teaching_assessment_eligibility_entries','teaching_assessment_candidates','teaching_assessment_candidate_versions','teaching_assessment_validations','teaching_assessment_packages','teaching_assessment_package_items','teaching_assessment_attempts','teaching_assessment_attempt_events','teaching_assessment_responses','teaching_assessment_item_challenges','teaching_assessment_invalidations','teaching_assessment_contamination_events','teaching_assessment_ppl_workspaces'])assert.match(migration,new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
for(const required of [
  /REVOKE ALL ON TABLE public\.%I FROM anon, authenticated, public/,
  /teaching_assessment_attempts_one_active_uidx/,
  /Locked Assessment Package is immutable/,
  /Locked Assessment Package cannot return to a mutable state/,
  /Locked Assessment Package item membership is immutable/,
  /teaching_assessment_validations_independent_check/,
  /teaching_assessment_invalidations_no_penalty_check/,
  /teaching_d17_contamination_resolution_guard/,
  /resolved_at timestamptz/,
  /resolution_ref text/,
  /DROP TRIGGER IF EXISTS teaching_d17_locked_package_update_guard/,
  /DROP TRIGGER IF EXISTS teaching_d17_package_item_insert_guard/,
  /DROP TRIGGER IF EXISTS teaching_d17_package_item_update_guard/,
  /DROP TRIGGER IF EXISTS teaching_d17_package_item_delete_guard/,
  /DROP FUNCTION IF EXISTS public\.teaching_d17_guard_locked_package_update\(\)/,
  /DROP FUNCTION IF EXISTS public\.teaching_d17_guard_package_item_mutation\(\)/,
  /CREATE TRIGGER teaching_d17_locked_package_item_guard BEFORE INSERT OR UPDATE OR DELETE/,
  /RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public/,
]) assert.match(migration,required);

const integrityRepo=fs.readFileSync('services/integrity/repository.js','utf8');
assert.match(integrityRepo,/ownerType==='TEACHING_ASSESSMENT_ATTEMPT'/);
assert.doesNotMatch(integrityRepo,/KIWI_INTEGRITY_D17_OWNER_NOT_READY/);
const shell=fs.readFileSync('teaching/integrations/kiwi-exam-interface.js','utf8');
assert.match(shell,/SHARED_ASSESSMENT_SHELL_CONTRACT_VERSION = 'd17\.v1'/);
assert.match(shell,/d18RendererImplementationDeferred:true/);
assert.match(shell,/existingKiwiExamDataRewritten:false/);
assert.match(shell,/serverAutosaveRequired:true/);
assert.match(shell,/browserTimerProjectionOnly:true/);

console.log(JSON.stringify({delivery:'D17',taskCount:TASKS.length,promptBindings:contracts.PROMPT_BINDINGS,capabilities:Object.keys(CAPABILITIES).length,status:'PASS'},null,2));
