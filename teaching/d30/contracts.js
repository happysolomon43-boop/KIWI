'use strict';

const D30_TASK_IDS = Object.freeze([
  ...Array.from({ length: 14 }, (_, i) => `TCH-${String(819 + i).padStart(4, '0')}`),
  ...Array.from({ length: 22 }, (_, i) => `TCH-${String(834 + i).padStart(4, '0')}`),
  'TCH-0857',
  ...Array.from({ length: 7 }, (_, i) => `TCH-${String(860 + i).padStart(4, '0')}`),
  'TCH-0902',
  'TCH-0920',
]);

const D30_CONTRACT_VERSION = 'D30-qualification-v1';
const EVALUATION_SUITE_VERSION = 'phase16-v1.4+tpf02-v1.1+tpf20-v1.0';
const PROMPT_MANIFEST_VERSION = '1.4';
const PROMPT_MANIFEST_SHA256 = '7757b50cbf4cfb501158beeaccfbfd5776bc8ca8f7257b4855f5ed5fcdf67e3d';
const PROMPT_PACK_SHA256 = '6632f5c566fb81906c5ecf27e7d5412a330b93f63c429d46f3bee65aac91ab5d';
const PROMPT_AMENDMENT_REGISTRY_VERSION = '1.0';
const PROMPT_AMENDMENT_REGISTRY_SHA256 = '04e1d9bf020cf5fd0ad20bb4c9cf6af7c972247d87f0700463be2819d01d8a9c';
const CONSTITUTION_VERSION = 'Blueprint-11.7/Teaching-Constitution';

const CRITICALITY_FLOORS = Object.freeze({ C2: 40, C3: 72, C4: 120 });
const DEFECT_SEVERITIES = Object.freeze(['P0', 'P1', 'P2', 'P3']);
const QUALIFICATION_DECISIONS = Object.freeze(['UNQUALIFIED', 'QUALIFIED', 'BLOCKED', 'INSUFFICIENT_EVIDENCE']);
const ROUTE_ROLES = Object.freeze(['PRIMARY', 'FALLBACK', 'STAGE']);
const RUN_KINDS = Object.freeze([
  'GOLDEN', 'NEGATIVE', 'COUNTERFACTUAL', 'UNCERTAINTY', 'INJECTION', 'AUTHORITY_ATTACK',
  'SOURCE_CONFLICT', 'CROSS_SUBJECT', 'METAMORPHIC', 'CROSS_FAMILY', 'STABILITY',
  'REGRESSION', 'TPF20_PRECLASS', 'TPF20_RECONCILIATION', 'TPF20_END_TO_END', 'PPL_COMPARISON',
]);
const AUTHORING_STATES = Object.freeze([
  'NOT_STARTED', 'BEHAVIOR_BRIEF_DRAFT', 'BEHAVIOR_BRIEF_APPROVED', 'PROMPT_CANDIDATE_DRAFT',
  'EVALUATION_IN_PROGRESS', 'REVISION_REQUIRED', 'CANDIDATE_APPROVED', 'FROZEN_VERSION', 'DEPRECATED',
]);
const FAILURE_ROOT_CAUSES = Object.freeze([
  'wording', 'context', 'task_mode_separation', 'schema', 'authority_contract', 'model_limitation',
  'product_ambiguity', 'flawed_evaluation_expectation',
]);
const PROMPT_STOP_CONDITIONS = Object.freeze([
  'authority_unclear', 'safe_context_unavailable', 'uncertainty_unrepresentable',
  'deterministic_rule_missing', 'family_overlap', 'c4_policy_underspecified',
  'prohibited_context_required', 'direct_mutation_required', 'constitution_conflict',
]);
const AUTHORING_WAVES = Object.freeze([
  'Course Foundation', 'Learning Engine', 'Assessment Integrity', 'Outcomes/Translation',
]);

const FAMILY_DEFINITIONS = Object.freeze([
  ['TPF-01','1.0','C3',2,'7ab97ec3ba8285659c40b7dc3ab149a721d8b475c14cbda89d13e73796d6d370','Student Intake Interpretation'],
  ['TPF-02','1.1','C4',14,'4272ed7051786b2c3ccc545d827ab21e85e622df628310e48e837759a33ec666','Curriculum Analysis & Structuring'],
  ['TPF-03','1.0','C4',2,'78b10efe7530fd1e84db1b284a90d15f0a2071d9dc241e5d31604b39b237ce26','Course Plan & Scope Planning'],
  ['TPF-04','1.2','C4',3,'bccf0a2f4eca30ab5259d87dc2c6640d8eda4e09b61c1e5fd41e5a39162bb453','Diagnostic & Verification Design'],
  ['TPF-05','1.3','C3',10,'7d9de1367dec90463f259de4971d091e5ddfeb7495b214e8a01274e3f9be2982','Lesson Planning, Homework & Live Replanning'],
  ['TPF-06','1.3','C4',7,'59785c0d601b8535647a86e6923414714f4320af405f8133c75a468ccd3b8173','Response Evaluation'],
  ['TPF-07','1.2','C3',12,'fc3546f686b7eb64e68147555a1bb314d587d7d919e662382c2eb20801d329fc','Pedagogy Strategy & Practice Design'],
  ['TPF-08','1.2','C3',12,'b6c65e2f152c5260f822a06348de016eb6cfb61e1b8695dd4f936c014a99fb77','AI Teacher Instruction & Interaction'],
  ['TPF-09','1.2','C4',18,'311e35a3edb67267a357b787b79c496a1660f297fc33e62776c457146946bab6','Evidence & Learning Analysis'],
  ['TPF-10','1.1','C3',10,'226a6f44cff3863ed8cc016daa50e38d9cac92f86fc205e6a5d1026d22cc8306','Scheduling & Workload Planning'],
  ['TPF-11','1.0','C4',3,'1c40d7a2b38fffe355da90933ecd47a688bff3a404fceb01d038f23659fc5994','Integrity & Authenticity Analysis'],
  ['TPF-12','1.3','C4',8,'0511b6591702748bb821f4d3b363287185ca6bf0ac52a14eb3b2ef3af3aba417','Assessment Planning & Blueprinting'],
  ['TPF-13','1.3','C4',8,'80bbaecd8f16a487c363fedc6364c3d974b1d88e1a7867473dcf2b81116128c6','Assessment Item Generation'],
  ['TPF-14','1.4','C4',13,'8468485ad602be0d3448b342e8fc111776de84d85dced7f3ca0e0c86aeee43c4','Assessment Validation, Control & Repair'],
  ['TPF-15','1.0','C4',4,'a088a74f044082abb126952939bc3fe627b273b1cfea166833fae87afbc8dcdb','Formal Rubric Marking'],
  ['TPF-16','1.0','C4',3,'278c45b97de8ceff9e6307543bea1072d51d244ccf21b7b16ca8a98d3c5daeda','Moderation & Appeal Review'],
  ['TPF-17','1.1','C3',7,'e297d3cc7e0f4c7febb1e13fcde2752a772f4a0bd61aea58170ed7dcc916674e','Progression & Recovery Planning'],
  ['TPF-18','1.0','C2',2,'1ea28ec7d84ded6092949bd0656f83450178386d5990077f02d033208feec7d5','Teacher Identity'],
  ['TPF-19','1.0','C2',9,'abb79225448de4a2350dc7366b2e7ca4088212e7e32991a58dce7199d8cd8831','Academic Translation'],
  ['TPF-20','1.0','C3',1,'d8d13f679e6817c1c02935e6581f5fc6ad512812004b59eebcf9a7d85c962e67','Class-Grounded Study Note'],
].map(([familyId, version, criticality, capabilityCount, promptSha256, name]) => Object.freeze({
  familyId, version, criticality, capabilityCount, promptSha256, name,
  constructionFloor: familyId === 'TPF-20' ? 96 : CRITICALITY_FLOORS[criticality],
  frozen: true,
  routeQualifiedAtBaseline: false,
})));

const FAMILY_BY_ID = new Map(FAMILY_DEFINITIONS.map((family) => [family.familyId, family]));

function assertD30TaskCensus() {
  if (D30_TASK_IDS.length !== 46 || new Set(D30_TASK_IDS).size !== 46) {
    throw new Error('D30 task census drift: expected exactly 46 unique assigned tasks.');
  }
  return true;
}

function getFamilyDefinition(familyId) {
  const family = FAMILY_BY_ID.get(String(familyId || '').trim());
  if (!family) throw new Error(`Unknown Teaching prompt family: ${familyId}`);
  return family;
}

function assertNoHiddenChainOfThought(value) {
  const text = JSON.stringify(value == null ? {} : value).toLowerCase();
  if (/(chain[-_ ]?of[-_ ]?thought|hidden reasoning|private reasoning|scratchpad|internal monologue)/.test(text)) {
    const error = new Error('D30 evidence must not store hidden chain-of-thought or private reasoning.');
    error.code = 'TEACHING_D30_HIDDEN_REASONING_FORBIDDEN';
    throw error;
  }
  return true;
}

function freezeRecord(record) {
  assertNoHiddenChainOfThought(record);
  return Object.freeze(record);
}

assertD30TaskCensus();

module.exports = {
  D30_TASK_IDS,
  D30_CONTRACT_VERSION,
  EVALUATION_SUITE_VERSION,
  PROMPT_MANIFEST_VERSION,
  PROMPT_MANIFEST_SHA256,
  PROMPT_PACK_SHA256,
  PROMPT_AMENDMENT_REGISTRY_VERSION,
  PROMPT_AMENDMENT_REGISTRY_SHA256,
  CONSTITUTION_VERSION,
  CRITICALITY_FLOORS,
  DEFECT_SEVERITIES,
  QUALIFICATION_DECISIONS,
  ROUTE_ROLES,
  RUN_KINDS,
  AUTHORING_STATES,
  FAILURE_ROOT_CAUSES,
  PROMPT_STOP_CONDITIONS,
  AUTHORING_WAVES,
  FAMILY_DEFINITIONS,
  getFamilyDefinition,
  assertD30TaskCensus,
  assertNoHiddenChainOfThought,
  freezeRecord,
};
