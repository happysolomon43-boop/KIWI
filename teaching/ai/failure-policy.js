'use strict';

const { assertAuthorityLevel } = require('./contracts');

const FAILURE_DISPOSITIONS = Object.freeze({
  T0_DETERMINISTIC_CONTINUES: 'T0_DETERMINISTIC_CONTINUES',
  T1_SAFE_COMMUNICATION_FALLBACK: 'T1_SAFE_COMMUNICATION_FALLBACK',
  T2_NO_EVIDENCE_MUTATION: 'T2_NO_EVIDENCE_MUTATION',
  T3_REMAIN_DRAFT_PENDING: 'T3_REMAIN_DRAFT_PENDING',
  T4_REMAIN_UNFINALIZED: 'T4_REMAIN_UNFINALIZED',
});

function authorityFailurePolicy(authorityLevel) {
  const authority = assertAuthorityLevel(authorityLevel);
  if (authority === 'T0') {
    return Object.freeze({
      authority,
      disposition: FAILURE_DISPOSITIONS.T0_DETERMINISTIC_CONTINUES,
      fallbackAllowed: false,
      durableMutationAllowed: false,
      studentPenaltyAllowed: false,
    });
  }
  if (authority === 'T1') {
    return Object.freeze({
      authority,
      disposition: FAILURE_DISPOSITIONS.T1_SAFE_COMMUNICATION_FALLBACK,
      fallbackAllowed: true,
      durableMutationAllowed: false,
      studentPenaltyAllowed: false,
    });
  }
  if (authority === 'T2') {
    return Object.freeze({
      authority,
      disposition: FAILURE_DISPOSITIONS.T2_NO_EVIDENCE_MUTATION,
      fallbackAllowed: false,
      durableMutationAllowed: false,
      studentPenaltyAllowed: false,
    });
  }
  if (authority === 'T3') {
    return Object.freeze({
      authority,
      disposition: FAILURE_DISPOSITIONS.T3_REMAIN_DRAFT_PENDING,
      fallbackAllowed: false,
      durableMutationAllowed: false,
      studentPenaltyAllowed: false,
    });
  }
  return Object.freeze({
    authority,
    disposition: FAILURE_DISPOSITIONS.T4_REMAIN_UNFINALIZED,
    fallbackAllowed: false,
    durableMutationAllowed: false,
    studentPenaltyAllowed: false,
  });
}

module.exports = {
  FAILURE_DISPOSITIONS,
  authorityFailurePolicy,
};
