'use strict';
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const {listCapabilities,integrity}=require('../teaching/capability-registry');
const {getCapabilityContract}=require('../teaching/prompt-runtime/contracts');
const root=path.resolve(__dirname,'..');
const targets={
 targeted_placement_prior_knowledge_diagnostic_design:['design_check'],
 fresh_verification_task_selection_after_answer_exposure:['design_check'],
 makeup_re_entry_diagnostic_design:['design_check'],
 response_correctness_quality_evaluation:['interpret_response'],response_error_taxonomy_classification:['interpret_response'],
 correct_but_insufficient_evidence_detection:['interpret_response'],partial_response_decomposition:['interpret_response'],
 procedural_slip_detection:['interpret_response'],misconception_detection:['interpret_response'],prerequisite_failure_detection:['interpret_response'],
 next_pedagogical_action_recommendation:['coordinate_lesson','interpret_response'],hint_level_selection:['coordinate_lesson'],
 productive_struggle_intervention_decision:['coordinate_lesson'],representation_change_strategy:['coordinate_lesson','prepare_guidance'],
 blocked_diagnosis_proposal:['interpret_response','coordinate_lesson'],pedagogical_profile_classification:['prepare_guidance'],
 subject_sensitive_instructional_strategy:['prepare_guidance','coordinate_lesson'],worked_example_scaffolding_design:['prepare_guidance'],
 conceptual_conflict_misconception_repair:['interpret_response','coordinate_lesson'],surgical_micro_remediation_design:['coordinate_lesson'],
 subject_appropriate_evidence_task_design:['design_check','guide_assessment'],knowledge_type_sensitive_review_strategy:['prepare_guidance','prepare_continuity','guide_assessment'],
};
function buildInventory(){
 const files=cp.execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean)
  .filter(f=>!f.includes('classroom-remodel')&&!f.startsWith('docs/teaching/classroom-remodel/')&&!f.startsWith('teaching/classroom-remodel/')&&f!=='scripts/build-classroom-remodel-inventory.js')
  .filter(f=>/\.(js|json|md|sql|yml|yaml|b64)$/.test(f));
 const texts=files.map(file=>({file,text:fs.readFileSync(path.join(root,file),'utf8')}));
 const all=listCapabilities();
 const migrated=all.filter(c=>['TPF-04','TPF-06','TPF-07'].includes(c.prompt_family_id));
 const counts=Object.fromEntries(['TPF-04','TPF-06','TPF-07'].map(f=>[f,migrated.filter(c=>c.prompt_family_id===f).length]));
 if(migrated.length!==Object.keys(targets).length||counts['TPF-04']!==3||counts['TPF-06']!==7||counts['TPF-07']!==12)throw Error('Migration census mismatch');
 const entries=all.filter(c=>['TPF-04','TPF-05','TPF-06','TPF-07','TPF-08','TPF-20'].includes(c.prompt_family_id)).map(c=>{
  const target=targets[c.id.split('.').at(-1)];
  if(migrated.includes(c)&&!target)throw Error('Unknown destination '+c.id);
  const matches=[];
  for(const {file,text} of texts){const lines=text.split(/\r?\n/);lines.forEach((line,i)=>{const identities=[c.id,...c.legacy_aliases].filter(id=>line.includes(id));if(identities.length)matches.push({file,line:i+1,identities});});}
  const runtime=matches.filter(m=>/^(teaching\/|services\/|teaching-backend\.js)/.test(m.file)&&!m.file.includes('/frozen/'));
  return {capability:c,contract:getCapabilityContract(c.id),targetModes:target||null,activeBinding:'RETAINED_LEGACY',replacementQualification:'NOT_QUALIFIED',
   directRuntimeReferences:runtime,references:matches,consumerStatus:runtime.length?'EXPLICIT_REFERENCES_REQUIRE_ADAPTER_QUALIFICATION':'NO_LITERAL_RUNTIME_CALLER_FOUND_GENERIC_OR_EXTERNAL_CALLERS_REQUIRE_REVIEW',
   requiredExtension:c.id.endsWith('pedagogical_profile_classification')?'pedagogical_profile':c.id.endsWith('worked_example_scaffolding_design')?'scaffolding':null};
 });
 return {version:'classroom-migration-inventory.v1',baselineCommit:'a77aec6fbd49b89a4538610e434151e2f5fb8cde',registry:integrity,counts,migratedCapabilityCount:migrated.length,entries,
  searchMethod:'Tracked UTF-8 source exact canonical and legacy alias references; compiled registry decoded through its verified reader. Absence of literal references is not proof of no dynamic/external caller.',
  searchFilesSha256:crypto.createHash('sha256').update(JSON.stringify(texts.map(({file,text})=>[file,crypto.createHash('sha256').update(text).digest('hex')]))).digest('hex')};
}
if(require.main===module){const json=JSON.stringify(buildInventory(),null,2)+'\n';const file=path.join(root,'docs/teaching/classroom-remodel/migration-inventory.v1.json');if(process.argv.includes('--check')){if(fs.readFileSync(file,'utf8')!==json)throw Error('Generated inventory drift');}else fs.writeFileSync(file,json);console.log('Classroom inventory: 22 migrations; 3/7/12 census; legacy bindings retained.');}
module.exports={buildInventory};
