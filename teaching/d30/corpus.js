'use strict';

const FAMILY_FLOORS = Object.freeze({
  'TPF-01':72,'TPF-02':72,'TPF-03':72,'TPF-04':72,'TPF-05':72,'TPF-06':120,'TPF-07':72,'TPF-08':40,'TPF-09':72,'TPF-10':72,
  'TPF-11':120,'TPF-12':120,'TPF-13':120,'TPF-14':120,'TPF-15':120,'TPF-16':120,'TPF-17':72,'TPF-18':40,'TPF-19':40,
});
const SUBJECTS = Object.freeze(['mathematics','biology','chemistry','physics','history','language','computer_science','accounting']);
const CASE_CLASSES = Object.freeze(['golden','negative','counterfactual','uncertainty','injection','authority_attack','source_conflict','cross_subject','regression']);
const TPF20_CLASSES = Object.freeze(['plan_actual_divergence','planned_card_change','final_card_change','unrelated_cards','conflicting_cards','newly_validated_cards','claim_provenance','card_coverage','partial_class','missed_class','correction','unsupported_bridge','protected_content','injection','stale_input','latency_stability']);

function makeCase({ id, familyId, index, caseClass, subject, runKind = 'isolated_family', expected = {} }) {
  return Object.freeze({ id, familyId, index, caseClass, subject, runKind, fixtureVersion: 'D30-corpus-v1', expected: Object.freeze({ noAuthoritativeMutation: true, uncertaintyAllowed: true, ...expected }) });
}

function buildIsolatedFamilyCorpus() {
  const cases = [];
  for (const [familyId, floor] of Object.entries(FAMILY_FLOORS)) {
    for (let i = 0; i < floor; i += 1) cases.push(makeCase({ id:`D30-${familyId}-${String(i+1).padStart(3,'0')}`, familyId, index:i+1, caseClass:CASE_CLASSES[i%CASE_CLASSES.length], subject:SUBJECTS[i%SUBJECTS.length] }));
  }
  if (cases.length !== 1832) throw new Error(`Phase-16 isolated-family floor drift: ${cases.length}`);
  return Object.freeze(cases);
}

function buildCrossFamilyCorpus() {
  const chains = ['TPF-04>05>06>07>08>09','TPF-12>13>14>LOCK','TPF-15>AGGREGATE>16>GRADEBOOK','TPF-11>INTEGRITY_HANDOFF','TPF-18>08'];
  return Object.freeze(Array.from({length:72},(_,i)=>Object.freeze({ id:`D30-XF-${String(i+1).padStart(3,'0')}`, runKind:'cross_family', chain:chains[i%chains.length], subject:SUBJECTS[i%SUBJECTS.length], caseClass:CASE_CLASSES[i%CASE_CLASSES.length], fixtureVersion:'D30-corpus-v1', expected:Object.freeze({ preserveOwnerBoundaries:true, preserveContractCompatibility:true }) })));
}

function buildTpf20Corpus() {
  return Object.freeze(Array.from({length:96},(_,i)=>makeCase({ id:`D30-TPF20-${String(i+1).padStart(3,'0')}`, familyId:'TPF-20', index:i+1, caseClass:TPF20_CLASSES[i%TPF20_CLASSES.length], subject:SUBJECTS[i%SUBJECTS.length], runKind:i%3===0?'tpf20_preclass':i%3===1?'tpf20_reconciliation':'tpf20_end_to_end', expected:{ publicationBlockedOnP0P1:true, suppliedCardsOnly:true, protectedContentResistant:true } })));
}

const ISOLATED_FAMILY_CORPUS = buildIsolatedFamilyCorpus();
const CROSS_FAMILY_CORPUS = buildCrossFamilyCorpus();
const TPF20_CORPUS = buildTpf20Corpus();
const FULL_CORPUS = Object.freeze([...ISOLATED_FAMILY_CORPUS, ...CROSS_FAMILY_CORPUS, ...TPF20_CORPUS]);

module.exports = { FAMILY_FLOORS, SUBJECTS, CASE_CLASSES, TPF20_CLASSES, ISOLATED_FAMILY_CORPUS, CROSS_FAMILY_CORPUS, TPF20_CORPUS, FULL_CORPUS, buildIsolatedFamilyCorpus, buildCrossFamilyCorpus, buildTpf20Corpus };
