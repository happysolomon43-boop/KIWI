'use strict';

const D27_CONTRACT_VERSION = 'd27.integrations.v1';
const D27_EVENT_SCHEMA_VERSION = 1;

const D27_EVENT_TYPES = Object.freeze([
  'learning_unit_verified',
  'misconception_detected',
  'assessment_completed',
  'course_completed',
  'remediation_required',
]);

const D27_KNOWLEDGE_TYPES = Object.freeze([
  'DECLARATIVE',
  'CONCEPTUAL',
  'PROCEDURAL',
  'ANALYTICAL',
  'INTERPRETIVE',
  'PRODUCTION',
]);

const D27_KS_EVIDENCE_TYPES = Object.freeze([
  'CONTROLLED_FORMAL',
  'DELAYED_INDEPENDENT',
  'TRANSFER_INDEPENDENT',
  'INDEPENDENT',
  'VERIFIED_MISCONCEPTION_RESOLUTION',
]);

const D27_PROHIBITED_KS_SIGNALS = Object.freeze([
  'ATTENDANCE_ONLY',
  'NOTIFICATION_DELIVERY',
  'SELF_REPORT_ONLY',
  'CARD_EXPOSURE_ONLY',
  'CARD_FLAG_ONLY',
  'NOTE_READ_ONLY',
  'TIME_ON_SCREEN_ONLY',
]);

const D27_INTEGRATION_CONTRACTS = Object.freeze({
  SUBJECT: Object.freeze({
    gate: 'APPROVED',
    sourceOwner: 'KIWI_SUBJECT',
    targetOwner: 'TEACHING_COURSE_REFERENCE',
    read: 'REFERENCE_EXISTING_SUBJECT_AND_OWNER_VERSION',
    write: 'NONE',
    conflict: 'ACTIVE_COURSE_SNAPSHOT_REMAINS_PINNED; LIVE_CHANGE_REQUIRES_COURSE_SCOPE_REVIEW',
    deletion: 'ACTIVE_COURSE_SNAPSHOT_SURVIVES; NO_SILENT_ORPHAN_OR_AUTO_REPLACEMENT',
  }),
  EXAM: Object.freeze({
    gate: 'APPROVED',
    sourceOwner: 'TEACHING_ASSESSMENT',
    targetOwner: 'SHARED_ASSESSMENT_SHELL_RENDERER',
    read: 'LOCKED_TEACHING_ASSESSMENT_PACKAGE',
    write: 'RENDER_AND_RESPONSE_TRANSPORT_ONLY',
    conflict: 'TEACHING_ATTEMPT_GRADEBOOK_AND_RELEASE_OWNERS_WIN; RENDERER_NEVER_OWNS_ACADEMIC_TRUTH',
    globalDestination: 'NO_DUPLICATE_GLOBAL_EXAM_RECORD_FIRST_RELEASE',
  }),
  NOTIFICATIONS: Object.freeze({
    gate: 'APPROVED',
    sourceOwner: 'AUTHORITATIVE_TEACHING_OWNER',
    targetOwner: 'KIWI_NOTIFICATIONS',
    read: 'VERSIONED_SOURCE_REFERENCE',
    write: 'SHARED_NOTIFICATION_INTERFACE_ONLY',
    conflict: 'REVALIDATE_SOURCE_VERSION; STALE_NOTICE_NO_OP',
    evidence: 'DELIVERY_OR_READ_RECEIPT_IS_NEVER_ACADEMIC_EVIDENCE',
  }),
  KS: Object.freeze({
    gate: 'APPROVED_CONTRACT_WRITE_FEATURE_FLAGGED',
    sourceOwner: 'TEACHING_EVIDENCE_OWNER',
    targetOwner: 'KIWI_KNOWLEDGE_SCORE',
    read: 'OPTIONAL_TARGET_STATE_FOR_CONFLICT_CONTEXT',
    write: 'OWNER_ADAPTER_APPLY_TEACHING_EVIDENCE',
    conflict: 'TARGET_KS_OWNER_ACCEPTS_REJECTS_OR_RECONCILES; TEACHING_NEVER_WRITES_KS_TABLES',
    formula: 'NONE_IN_TEACHING',
    featureFlag: 'TEACHING_D27_KS_WRITE_ENABLED',
  }),
  MASTERY: Object.freeze({
    gate: 'APPROVED_CONTRACT_WRITE_FEATURE_FLAGGED',
    sourceOwner: 'TEACHING_OWNER_EVENTS',
    targetOwner: 'KIWI_MASTERY_BUBBLES',
    read: 'OPTIONAL_GOAL_TRAJECTORY_CONTEXT',
    write: 'OWNER_ADAPTER_APPLY_TEACHING_SIGNAL',
    conflict: 'TEACHING_SCHEDULER_OWNS_COURSE_TIMETABLE; MASTERY_OWNER_OWNS_GOAL_TRAJECTORY',
    featureFlag: 'TEACHING_D27_MASTERY_WRITE_ENABLED',
  }),
  STUDY_FSRS: Object.freeze({
    gate: 'APPROVED',
    sourceOwner: 'TEACHING_COURSE_CLASS_LEARNING_UNIT',
    targetOwner: 'KIWI_STUDY_FSRS',
    read: 'OWNER_CARD_LOOKUP_AND_EXISTING_CARD_SELECTION',
    write: 'REFERENCE_LOCAL; CANDIDATE_LOCAL; CARD_PROMOTION_OWNER_ADAPTER_ONLY',
    conflict: 'CARD_OWNER_OWNS_CARD_ID_DECK_REVIEW_INTERVAL_HISTORY_AND_DELETION; TEACHING_SCHEDULE_WINS_COURSE_TIME',
    evidence: 'CARD_EXPOSURE_REVIEW_OR_FLAG_DOES_NOT_AUTO_MUTATE_SKM',
    deletion: 'MISSING_CARD_REFERENCE_BECOMES_STALE; REMOVING_REVIEW_SET_NEVER_DELETES_SOURCE_CARD',
    promotionFeatureFlag: 'TEACHING_D27_STUDY_PROMOTION_ENABLED',
  }),
  BRAIN: Object.freeze({
    gate: 'EXPLICITLY_DEFERRED_OFF',
    sourceOwner: 'TEACHING',
    targetOwner: 'KIWI_BRAIN',
    read: 'NONE_AUTHORIZED_BY_D27',
    write: 'NONE',
    conflict: 'NO_CONTRACTED_OWNER_SEMANTICS; DO_NOT_INVENT',
  }),
  BIOME: Object.freeze({
    gate: 'EXPLICITLY_DEFERRED_OFF',
    sourceOwner: 'TEACHING',
    targetOwner: 'KIWI_BIOME',
    read: 'NONE_AUTHORIZED_BY_D27',
    write: 'NONE',
    conflict: 'ACADEMIC_TRUTH_MUST_NOT_BE_DISTORTED_FOR_MOTIVATIONAL_STATE',
  }),
  ACHIEVEMENTS: Object.freeze({
    gate: 'DECIDED_OFF_FIRST_RELEASE',
    sourceOwner: 'TEACHING_OWNER_EVENTS',
    targetOwner: 'KIWI_ACHIEVEMENTS',
    read: 'NONE_REQUIRED',
    write: 'NONE',
    conflict: 'SERIOUS_ACADEMIC_FAILURE_REMEDIATION_RECOVERY_STATES_ARE_NOT_GAMIFIED',
  }),
});

function requiredText(value, name) {
  const text = String(value == null ? '' : value).trim();
  if (!text) throw new TypeError(`${name} is required.`);
  return text;
}

function normalizeSourceRef(input) {
  if (!input || typeof input !== 'object') throw new TypeError('source reference is required.');
  return Object.freeze({
    owner: requiredText(input.owner, 'source.owner'),
    entityType: requiredText(input.entityType, 'source.entityType'),
    entityId: requiredText(input.entityId, 'source.entityId'),
    version: requiredText(input.version, 'source.version'),
  });
}

function assertUnprotectedPrivacy(input) {
  const privacyClass = requiredText(input || 'C1', 'privacyClass').toUpperCase();
  if (['C3', 'C4', 'PROTECTED_ASSESSMENT', 'SECRET_ASSESSMENT'].includes(privacyClass)) {
    const error = new Error('Protected Assessment content cannot cross a D27 general integration boundary.');
    error.code = 'TEACHING_D27_PROTECTED_CONTENT_FORBIDDEN';
    error.status = 400;
    throw error;
  }
  return privacyClass;
}

function buildD27EventEnvelope(input) {
  if (!input || typeof input !== 'object') throw new TypeError('integration event input is required.');
  const eventType = requiredText(input.eventType, 'eventType');
  if (!D27_EVENT_TYPES.includes(eventType)) {
    const error = new Error(`Unsupported D27 integration event type: ${eventType}`);
    error.code = 'TEACHING_D27_EVENT_TYPE_INVALID';
    error.status = 400;
    throw error;
  }
  const payload = input.payload == null ? {} : input.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('payload must be an object.');
  return Object.freeze({
    eventId: requiredText(input.eventId, 'eventId'),
    studentId: requiredText(input.studentId, 'studentId'),
    eventType,
    schemaVersion: D27_EVENT_SCHEMA_VERSION,
    source: normalizeSourceRef(input.source),
    occurredAt: requiredText(input.occurredAt, 'occurredAt'),
    correlationId: input.correlationId == null ? null : String(input.correlationId),
    causationId: input.causationId == null ? null : String(input.causationId),
    idempotencyKey: requiredText(input.idempotencyKey, 'idempotencyKey'),
    policyVersion: requiredText(input.policyVersion || D27_CONTRACT_VERSION, 'policyVersion'),
    privacyClass: assertUnprotectedPrivacy(input.privacyClass || 'C1'),
    payload: Object.freeze({ ...payload }),
  });
}

function integrationContract(name) {
  const key = requiredText(name, 'integration name').toUpperCase();
  const contract = D27_INTEGRATION_CONTRACTS[key];
  if (!contract) throw new RangeError(`Unknown D27 integration contract: ${key}`);
  return contract;
}

module.exports = {
  D27_CONTRACT_VERSION,
  D27_EVENT_SCHEMA_VERSION,
  D27_EVENT_TYPES,
  D27_KNOWLEDGE_TYPES,
  D27_KS_EVIDENCE_TYPES,
  D27_PROHIBITED_KS_SIGNALS,
  D27_INTEGRATION_CONTRACTS,
  normalizeSourceRef,
  assertUnprotectedPrivacy,
  buildD27EventEnvelope,
  integrationContract,
};
