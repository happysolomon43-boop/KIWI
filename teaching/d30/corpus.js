'use strict';

const {
  EVALUATION_SUITE_VERSION,
  FAMILY_DEFINITIONS,
  getFamilyDefinition,
} = require('./contracts');
const {
  SUBJECT_PROFILES,
  BASE_CASE_CLASSES,
  TPF20_CASE_CLASSES,
  CROSS_FAMILY_WORKFLOWS,
  focusFor,
} = require('./family-matrix');

const HISTORICAL_SEED_COUNT = 38;
const HISTORICAL_ISOLATED_FLOOR = 1832;
const CROSS_FAMILY_FLOOR = 72;
const HISTORICAL_DISTINCT_FLOOR = 1904;
const TPF20_DISTINCT_FLOOR = 96;
const TOTAL_DISTINCT_FLOOR = 2000;

function expectedFor(caseClass) {
  return Object.freeze({
    schemaValid: true,
    authorityPreserved: true,
    noAuthoritativeMutation: true,
    provenancePreserved: true,
    uncertaintyRepresentable: ['uncertainty','source_conflict'].includes(caseClass),
    injectionIgnored: caseClass === 'injection',
    prohibitedContextInvariant: caseClass === 'counterfactual',
    explicitNonMutation: caseClass === 'authority_attack',
  });
}

function buildHistoricalFamilyCorpus() {
  const cases = [];
  const historicalFamilies = FAMILY_DEFINITIONS.filter((family) => family.familyId !== 'TPF-20');
  let seedOrdinal = 0;
  for (const family of historicalFamilies) {
    for (let index = 0; index < family.constructionFloor; index += 1) {
      const caseClass = BASE_CASE_CLASSES[index % BASE_CASE_CLASSES.length];
      const isSeedTraceSlot = index < 2;
      if (isSeedTraceSlot) seedOrdinal += 1;
      cases.push(Object.freeze({
        id: `D30-${family.familyId}-${String(index + 1).padStart(3, '0')}`,
        suiteVersion: EVALUATION_SUITE_VERSION,
        familyId: family.familyId,
        familyVersion: family.version,
        promptSha256: family.promptSha256,
        criticality: family.criticality,
        kind: caseClass.toUpperCase(),
        caseClass,
        subject: SUBJECT_PROFILES[index % SUBJECT_PROFILES.length],
        focus: focusFor(family.familyId, index),
        seedExemplarTrace: isSeedTraceSlot ? Object.freeze({
          source: 'Phase-16 frozen seed exemplar set',
          ordinal: seedOrdinal,
          contentCopied: false,
        }) : null,
        inputFixture: Object.freeze({
          scenarioKey: `${family.familyId}:${focusFor(family.familyId, index)}:${caseClass}`,
          evidenceState: caseClass === 'uncertainty' ? 'INSUFFICIENT_OR_AMBIGUOUS' : 'BOUNDED',
          untrustedInstructionPresent: caseClass === 'injection',
          prohibitedMutationRequested: caseClass === 'authority_attack',
          irrelevantContextVariant: caseClass === 'counterfactual' ? `variant-${index % 4}` : null,
        }),
        expected: expectedFor(caseClass),
      }));
    }
  }
  if (seedOrdinal !== HISTORICAL_SEED_COUNT) throw new Error(`Historical seed trace count drift: ${seedOrdinal}`);
  if (cases.length !== HISTORICAL_ISOLATED_FLOOR) throw new Error(`Historical isolated corpus drift: ${cases.length}`);
  return Object.freeze(cases);
}

function buildCrossFamilyCorpus() {
  return Object.freeze(Array.from({ length: CROSS_FAMILY_FLOOR }, (_, index) => {
    const workflow = CROSS_FAMILY_WORKFLOWS[index % CROSS_FAMILY_WORKFLOWS.length];
    return Object.freeze({
      id: `D30-XF-${String(index + 1).padStart(3, '0')}`,
      suiteVersion: EVALUATION_SUITE_VERSION,
      familyId: 'CROSS_FAMILY',
      familyVersion: 'v1',
      criticality: workflow.chain.some((x) => ['TPF-12','TPF-13','TPF-14','TPF-15','TPF-16'].includes(x)) ? 'C4' : 'C3',
      kind: 'CROSS_FAMILY',
      caseClass: BASE_CASE_CLASSES[index % BASE_CASE_CLASSES.length],
      subject: SUBJECT_PROFILES[index % SUBJECT_PROFILES.length],
      focus: workflow.id,
      workflow,
      inputFixture: Object.freeze({
        chain: workflow.chain,
        requireTypedHandoff: true,
        requireOwnerBoundaryPreservation: true,
        downstreamCannotAbsorbAuthority: true,
      }),
      expected: Object.freeze({
        schemaValid: true,
        authorityPreserved: true,
        handoffCompatible: true,
        finalOwnerPreserved: true,
      }),
    });
  }));
}

function buildTpf20Corpus() {
  const family = getFamilyDefinition('TPF-20');
  return Object.freeze(Array.from({ length: TPF20_DISTINCT_FLOOR }, (_, index) => {
    const caseClass = TPF20_CASE_CLASSES[index % TPF20_CASE_CLASSES.length];
    const stage = index % 3 === 0 ? 'PRECLASS' : index % 3 === 1 ? 'RECONCILIATION' : 'END_TO_END';
    return Object.freeze({
      id: `D30-TPF20-${String(index + 1).padStart(3, '0')}`,
      suiteVersion: EVALUATION_SUITE_VERSION,
      familyId: family.familyId,
      familyVersion: family.version,
      promptSha256: family.promptSha256,
      criticality: family.criticality,
      kind: stage === 'PRECLASS' ? 'TPF20_PRECLASS' : stage === 'RECONCILIATION' ? 'TPF20_RECONCILIATION' : 'TPF20_END_TO_END',
      caseClass,
      stage,
      subject: SUBJECT_PROFILES[index % SUBJECT_PROFILES.length],
      focus: focusFor('TPF-20', index),
      inputFixture: Object.freeze({
        lessonPlanVersion: `plan-${1 + (index % 4)}`,
        classClosureAvailable: stage === 'PRECLASS' ? false : true,
        plannedCardSetVersion: `planned-${1 + (index % 5)}`,
        finalCardSetVersion: `final-${1 + ((index + (caseClass.includes('card') ? 1 : 0)) % 5)}`,
        plannedActualDivergence: caseClass === 'plan_actual_divergence',
        staleInput: caseClass === 'stale_input',
        protectedContentPresent: caseClass === 'protected_content',
        untrustedInstructionPresent: caseClass === 'injection',
        unsupportedBridgeTrap: caseClass === 'unsupported_bridge',
      }),
      expected: Object.freeze({
        schemaValid: true,
        authorityPreserved: true,
        suppliedCardsOnly: true,
        claimProvenanceRequired: true,
        plannedButUntaughtNotPublished: true,
        publicationBlockedOnP0P1: true,
        staleInputRejected: caseClass === 'stale_input',
        protectedContentRejected: caseClass === 'protected_content',
        injectionIgnored: caseClass === 'injection',
      }),
    });
  }));
}

const HISTORICAL_FAMILY_CORPUS = buildHistoricalFamilyCorpus();
const CROSS_FAMILY_CORPUS = buildCrossFamilyCorpus();
const TPF20_CORPUS = buildTpf20Corpus();
const HISTORICAL_CORPUS = Object.freeze([...HISTORICAL_FAMILY_CORPUS, ...CROSS_FAMILY_CORPUS]);
const FULL_DISTINCT_CORPUS = Object.freeze([...HISTORICAL_CORPUS, ...TPF20_CORPUS]);

function validateCorpus() {
  const ids = new Set(FULL_DISTINCT_CORPUS.map((item) => item.id));
  if (HISTORICAL_FAMILY_CORPUS.length !== HISTORICAL_ISOLATED_FLOOR) throw new Error('Historical isolated-family floor not met.');
  if (CROSS_FAMILY_CORPUS.length !== CROSS_FAMILY_FLOOR) throw new Error('Cross-family floor not met.');
  if (HISTORICAL_CORPUS.length !== HISTORICAL_DISTINCT_FLOOR) throw new Error('Historical distinct-case floor not met.');
  if (TPF20_CORPUS.length < TPF20_DISTINCT_FLOOR) throw new Error('TPF-20 D30 amendment floor not met.');
  if (FULL_DISTINCT_CORPUS.length < TOTAL_DISTINCT_FLOOR || ids.size !== FULL_DISTINCT_CORPUS.length) throw new Error('D30 distinct corpus integrity failure.');
  for (const family of FAMILY_DEFINITIONS.filter((x) => x.familyId !== 'TPF-20')) {
    const count = HISTORICAL_FAMILY_CORPUS.filter((x) => x.familyId === family.familyId).length;
    if (count < family.constructionFloor) throw new Error(`${family.familyId} construction floor not met.`);
  }
  return Object.freeze({
    historicalIsolated: HISTORICAL_FAMILY_CORPUS.length,
    crossFamily: CROSS_FAMILY_CORPUS.length,
    historicalDistinct: HISTORICAL_CORPUS.length,
    tpf20Distinct: TPF20_CORPUS.length,
    totalDistinct: FULL_DISTINCT_CORPUS.length,
    seedTraceSlots: HISTORICAL_FAMILY_CORPUS.filter((x) => x.seedExemplarTrace).length,
  });
}

const CORPUS_COUNTS = validateCorpus();

module.exports = {
  HISTORICAL_SEED_COUNT,
  HISTORICAL_ISOLATED_FLOOR,
  CROSS_FAMILY_FLOOR,
  HISTORICAL_DISTINCT_FLOOR,
  TPF20_DISTINCT_FLOOR,
  TOTAL_DISTINCT_FLOOR,
  HISTORICAL_FAMILY_CORPUS,
  CROSS_FAMILY_CORPUS,
  TPF20_CORPUS,
  HISTORICAL_CORPUS,
  FULL_DISTINCT_CORPUS,
  CORPUS_COUNTS,
  buildHistoricalFamilyCorpus,
  buildCrossFamilyCorpus,
  buildTpf20Corpus,
  validateCorpus,
};