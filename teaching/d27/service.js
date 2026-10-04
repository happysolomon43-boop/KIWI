'use strict';

const { buildSourceInventory, digest } = require('../d07/contracts');
const {
  D27_CONTRACT_VERSION,
  D27_KS_EVIDENCE_TYPES,
  D27_PROHIBITED_KS_SIGNALS,
  D27_INTEGRATION_CONTRACTS,
  buildD27EventEnvelope,
} = require('./contracts');
const {
  normalizeKnowledgeType,
  findEquivalentCard,
  selectExistingCardReferences,
  buildValidatedCardCandidate,
} = require('./study');

function text(value, name) {
  const out = String(value == null ? '' : value).trim();
  if (!out) throw new TypeError(`${name} is required.`);
  return out;
}

function fail(message, code, status = 400, details = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  throw error;
}

function rowSource(row) {
  return Object.freeze({
    owner: String(row.source_owner),
    entityType: String(row.source_entity_type),
    entityId: String(row.source_entity_id),
    version: String(row.source_version),
  });
}

function primarySnapshotFingerprint(items = []) {
  const normalized = (Array.isArray(items) ? items : []).map((item) => Object.freeze({
    sourceRef:String(item.sourceRef ?? item.source_ref ?? ''),
    sourceVersionRef:item.sourceVersionRef ?? item.source_version_ref ?? null,
    contentHash:String(item.contentHash ?? item.content_hash ?? ''),
  })).sort((a, b) => a.sourceRef.localeCompare(b.sourceRef) || a.contentHash.localeCompare(b.contentHash));
  return digest(normalized);
}

function createD27Service({
  repository,
  subjectReader,
  examInterface,
  notificationInterface,
  ownerAdapters = {},
  sourceVersionReader = null,
  integrationEventPublisher = null,
  writeGates = {},
  randomUUID,
  clock = () => new Date(),
} = {}) {
  if (!repository) throw new TypeError('D27 requires its integration repository.');
  if (!subjectReader || typeof subjectReader.getForUser !== 'function' || typeof subjectReader.getCorpusForUser !== 'function') {
    throw new TypeError('D27 requires the existing KIWI Subject reader.');
  }
  if (!examInterface || typeof examInterface.buildAssessmentShellHandoff !== 'function') {
    throw new TypeError('D27 requires the shared KIWI Assessment Shell interface.');
  }
  if (!notificationInterface || typeof notificationInterface.send !== 'function') {
    throw new TypeError('D27 requires the existing KIWI notification interface.');
  }
  if (typeof randomUUID !== 'function') throw new TypeError('D27 requires randomUUID().');

  const gates = Object.freeze({
    ksWrite: writeGates.ksWrite === true,
    masteryWrite: writeGates.masteryWrite === true,
    studyPromotion: writeGates.studyPromotion === true,
  });
  const now = () => {
    const value = clock();
    return value instanceof Date ? value : new Date(value);
  };

  async function audit(studentId, integrationName, action, {
    sourceRef = {}, targetRef = {}, featureFlag = false, decision, outcome, errorCode = null,
  }) {
    return repository.recordAudit({
      studentId:String(studentId),integrationName,action,sourceRef,targetRef,featureFlag,
      decision:String(decision),outcome:String(outcome),errorCode,occurredAt:now().toISOString(),
    });
  }

  async function subjectBoundary(user, courseId) {
    const studentId = String(user.id);
    const course = await repository.getCourseSubjectContext(studentId, text(courseId, 'courseId'));
    if (!course) fail('Teaching Course not found.', 'TEACHING_D27_COURSE_NOT_FOUND', 404);
    const subject = await subjectReader.getForUser(studentId, course.subject_id);
    if (!subject) {
      return Object.freeze({
        courseId:course.course_id,subjectId:course.subject_id,state:'SUBJECT_MISSING_SNAPSHOT_PINNED',
        lifecycleState:course.lifecycle_state,subjectSnapshotRef:course.subject_snapshot_ref,
        sourceVersionRef:course.source_version_ref,liveSubject:null,liveVersion:null,pinnedPrimaryVersion:null,
        maySilentlyRebind:false,
      });
    }
    const corpus = await subjectReader.getCorpusForUser(studentId, course.subject_id);
    if (!corpus) {
      return Object.freeze({
        courseId:course.course_id,subjectId:course.subject_id,state:'SUBJECT_CHANGED_SNAPSHOT_PINNED',
        lifecycleState:course.lifecycle_state,subjectSnapshotRef:course.subject_snapshot_ref,
        sourceVersionRef:course.source_version_ref,liveSubject:subject,liveVersion:null,pinnedPrimaryVersion:null,
        conflictReason:'LIVE_SUBJECT_CORPUS_UNAVAILABLE',maySilentlyRebind:false,
      });
    }
    let livePrimary;
    try {
      livePrimary = buildSourceInventory({ corpus, supplementaryMaterials:[] }).items;
    } catch (error) {
      return Object.freeze({
        courseId:course.course_id,subjectId:course.subject_id,state:'SUBJECT_CHANGED_SNAPSHOT_PINNED',
        lifecycleState:course.lifecycle_state,subjectSnapshotRef:course.subject_snapshot_ref,
        sourceVersionRef:course.source_version_ref,liveSubject:subject,liveVersion:null,pinnedPrimaryVersion:null,
        conflictReason:error?.code || 'LIVE_SUBJECT_CORPUS_INVALID',maySilentlyRebind:false,
      });
    }
    if (typeof repository.getCoursePrimarySubjectSnapshot !== 'function') {
      fail('D27 requires the pinned primary Subject snapshot reader.', 'TEACHING_D27_SUBJECT_SNAPSHOT_READER_UNAVAILABLE', 503);
    }
    const pinnedPrimary = await repository.getCoursePrimarySubjectSnapshot(studentId, course.course_id);
    const liveVersion = primarySnapshotFingerprint(livePrimary);
    const pinnedPrimaryVersion = primarySnapshotFingerprint(pinnedPrimary);
    const changed = !pinnedPrimary.length || liveVersion !== pinnedPrimaryVersion;
    return Object.freeze({
      courseId:course.course_id,subjectId:course.subject_id,state:changed?'SUBJECT_CHANGED_SNAPSHOT_PINNED':'SUBJECT_CURRENT',
      lifecycleState:course.lifecycle_state,subjectSnapshotRef:course.subject_snapshot_ref,
      sourceVersionRef:course.source_version_ref,liveVersion,pinnedPrimaryVersion,liveSubject:subject,
      maySilentlyRebind:false,
    });
  }

  async function assessmentShellHandoff(user, input = {}) {
    const assessmentId = text(input.assessmentId, 'assessmentId');
    const packageId = text(input.packageId, 'packageId');
    const handoff = examInterface.buildAssessmentShellHandoff({
      assessmentId,packageId,attemptId:input.attemptId || null,returnPath:input.returnPath || '/teaching.html',
    });
    await audit(user.id, 'EXAM', 'BUILD_SHARED_ASSESSMENT_SHELL_HANDOFF', {
      sourceRef:{ owner:'D17_ASSESSMENT',entityType:'Assessment',entityId:assessmentId,version:String(input.sourceVersion || 'CURRENT_OWNER_VALIDATED') },
      targetRef:{ owner:'SHARED_ASSESSMENT_SHELL',contractVersion:handoff.contractVersion },
      featureFlag:true,decision:'ALLOW_SHARED_RENDERER_ONLY',outcome:'HANDOFF_CREATED',
    });
    return Object.freeze({ ...handoff, academicTruthOwner:'TEACHING_ASSESSMENT', duplicateGlobalExamRecordCreated:false });
  }

  async function publishEvent(user, input = {}) {
    const event = buildD27EventEnvelope({
      ...input,
      eventId:input.eventId || randomUUID(),
      studentId:String(user.id),
      occurredAt:input.occurredAt || now().toISOString(),
      policyVersion:input.policyVersion || D27_CONTRACT_VERSION,
    });
    const stored = await repository.enqueueEvent(event);
    if (!stored.row) fail('Integration event could not be persisted.', 'TEACHING_D27_EVENT_PERSIST_FAILED', 500);
    if (!stored.inserted) {
      const existing = stored.row;
      const same = existing.event_type === event.eventType
        && existing.source_owner === event.source.owner
        && existing.source_entity_type === event.source.entityType
        && existing.source_entity_id === event.source.entityId
        && String(existing.source_version) === String(event.source.version);
      if (!same) fail('Integration idempotency key is already bound to a different event.', 'TEACHING_D27_IDEMPOTENCY_COLLISION', 409);
    }
    return Object.freeze({ event:stored.row, inserted:stored.inserted, duplicateDeliverySafe:true });
  }

  async function dispatchEvent(user, eventId, { replay = false } = {}) {
    const row = await repository.getEvent(String(user.id), text(eventId, 'eventId'));
    if (!row) fail('Integration event not found.', 'TEACHING_D27_EVENT_NOT_FOUND', 404);
    if (row.status === 'DELIVERED' && !replay) return Object.freeze({ disposition:'ALREADY_DELIVERED', event:row });
    if (typeof integrationEventPublisher !== 'function') {
      fail('No D27 integration event publisher is configured.', 'TEACHING_D27_EVENT_PUBLISHER_UNAVAILABLE', 503);
    }
    const message = Object.freeze({
      eventId:row.event_id,eventType:row.event_type,schemaVersion:row.schema_version,studentId:row.student_id,
      source:rowSource(row),occurredAt:row.occurred_at,correlationId:row.correlation_id,causationId:row.causation_id,
      idempotencyKey:row.idempotency_key,policyVersion:row.policy_version,privacyClass:row.privacy_class,
      payload:Object.freeze({ ...(row.payload || {}) }),
    });
    try {
      const result = await integrationEventPublisher(message);
      const updated = await repository.markEvent({ studentId:String(user.id),eventId:row.event_id,status:'DELIVERED',replayed:replay,at:now().toISOString() });
      return Object.freeze({ disposition:'DELIVERED', event:updated, result:result == null ? null : result });
    } catch (error) {
      await repository.markEvent({ studentId:String(user.id),eventId:row.event_id,status:'PENDING',replayed:replay,at:now().toISOString() });
      throw error;
    }
  }

  async function assertSourceCurrent(row) {
    if (typeof sourceVersionReader !== 'function') {
      fail('Consequential D27 writes require an authoritative source-version reader.', 'TEACHING_D27_SOURCE_READER_UNAVAILABLE', 503);
    }
    const source = rowSource(row);
    const current = await sourceVersionReader(String(row.student_id), source);
    if (!current || current.exists === false) fail('Authoritative Teaching source no longer exists.', 'TEACHING_D27_SOURCE_MISSING', 409);
    if (String(current.version) !== String(source.version)) {
      fail('Authoritative Teaching source changed before integration commit.', 'TEACHING_D27_SOURCE_VERSION_STALE', 409, { currentVersion:String(current.version) });
    }
    return current;
  }

  async function applyKnowledgeScore(user, eventId) {
    const row = await repository.getEvent(String(user.id), text(eventId, 'eventId'));
    if (!row) fail('Integration event not found.', 'TEACHING_D27_EVENT_NOT_FOUND', 404);
    const source = rowSource(row);
    if (!gates.ksWrite) {
      await audit(user.id, 'KS', 'APPLY_TEACHING_EVIDENCE', { sourceRef:source,featureFlag:false,decision:'DENY_WRITE_GATE_OFF',outcome:'NO_WRITE' });
      fail('Teaching→Knowledge Score writes are disabled.', 'TEACHING_D27_KS_WRITE_DISABLED', 409);
    }
    const evidenceType = String(row.payload?.evidenceType || '').toUpperCase();
    const signalClass = String(row.payload?.signalClass || '').toUpperCase();
    if (!D27_KS_EVIDENCE_TYPES.includes(evidenceType) || D27_PROHIBITED_KS_SIGNALS.includes(signalClass)) {
      await audit(user.id, 'KS', 'APPLY_TEACHING_EVIDENCE', { sourceRef:source,featureFlag:true,decision:'REJECT_EVIDENCE_QUALITY',outcome:'NO_WRITE',errorCode:'TEACHING_D27_KS_EVIDENCE_INELIGIBLE' });
      fail('This Teaching event is not eligible for Knowledge Score integration.', 'TEACHING_D27_KS_EVIDENCE_INELIGIBLE', 409);
    }
    await assertSourceCurrent(row);
    const adapter = ownerAdapters.knowledgeScore;
    if (!adapter || typeof adapter.readState !== 'function' || typeof adapter.applyTeachingEvidence !== 'function') {
      fail('Knowledge Score owner adapter is unavailable.', 'TEACHING_D27_KS_OWNER_UNAVAILABLE', 503);
    }
    const targetBefore = await adapter.readState({ studentId:String(user.id),subjectId:row.payload?.subjectId || null });
    try {
      const result = await adapter.applyTeachingEvidence({
        studentId:String(user.id),eventId:row.event_id,idempotencyKey:`d27:ks:${row.event_id}`,
        source,evidenceType,subjectId:row.payload?.subjectId || null,learningUnitId:row.payload?.learningUnitId || null,
        evidence:Object.freeze({ ...(row.payload || {}) }),expectedTargetVersion:targetBefore?.version ?? null,
        policyVersion:D27_CONTRACT_VERSION,
      });
      await audit(user.id, 'KS', 'APPLY_TEACHING_EVIDENCE', { sourceRef:source,targetRef:{ version:result?.version ?? targetBefore?.version ?? null },featureFlag:true,decision:'OWNER_VALIDATED_WRITE',outcome:'OWNER_ACCEPTED' });
      return Object.freeze({ owner:'KIWI_KNOWLEDGE_SCORE', result, teachingFormulaApplied:false });
    } catch (error) {
      await audit(user.id, 'KS', 'APPLY_TEACHING_EVIDENCE', { sourceRef:source,targetRef:{ version:targetBefore?.version ?? null },featureFlag:true,decision:'OWNER_VALIDATED_WRITE',outcome:'OWNER_REJECTED',errorCode:error?.code || 'TARGET_OWNER_REJECTED' });
      throw error;
    }
  }

  async function applyMasterySignal(user, eventId) {
    const row = await repository.getEvent(String(user.id), text(eventId, 'eventId'));
    if (!row) fail('Integration event not found.', 'TEACHING_D27_EVENT_NOT_FOUND', 404);
    const source = rowSource(row);
    if (!gates.masteryWrite) {
      await audit(user.id, 'MASTERY', 'APPLY_TEACHING_SIGNAL', { sourceRef:source,featureFlag:false,decision:'DENY_WRITE_GATE_OFF',outcome:'NO_WRITE' });
      fail('Teaching→Mastery writes are disabled.', 'TEACHING_D27_MASTERY_WRITE_DISABLED', 409);
    }
    await assertSourceCurrent(row);
    const adapter = ownerAdapters.mastery;
    if (!adapter || typeof adapter.readState !== 'function' || typeof adapter.applyTeachingSignal !== 'function') {
      fail('Mastery owner adapter is unavailable.', 'TEACHING_D27_MASTERY_OWNER_UNAVAILABLE', 503);
    }
    const targetBefore = await adapter.readState({ studentId:String(user.id),subjectId:row.payload?.subjectId || null });
    try {
      const result = await adapter.applyTeachingSignal({
        studentId:String(user.id),eventId:row.event_id,idempotencyKey:`d27:mastery:${row.event_id}`,source,
        signal:Object.freeze({ eventType:row.event_type, ...(row.payload || {}) }),expectedTargetVersion:targetBefore?.version ?? null,
        policyVersion:D27_CONTRACT_VERSION,teachingTimetableAuthoritative:true,
      });
      await audit(user.id, 'MASTERY', 'APPLY_TEACHING_SIGNAL', { sourceRef:source,targetRef:{ version:result?.version ?? targetBefore?.version ?? null },featureFlag:true,decision:'OWNER_VALIDATED_WRITE',outcome:'OWNER_ACCEPTED' });
      return Object.freeze({ owner:'KIWI_MASTERY_BUBBLES', result, timetableMutatedByMastery:false });
    } catch (error) {
      await audit(user.id, 'MASTERY', 'APPLY_TEACHING_SIGNAL', { sourceRef:source,targetRef:{ version:targetBefore?.version ?? null },featureFlag:true,decision:'OWNER_VALIDATED_WRITE',outcome:'OWNER_REJECTED',errorCode:error?.code || 'TARGET_OWNER_REJECTED' });
      throw error;
    }
  }

  async function prepareClassReviewSet(user, input = {}) {
    const studentId = String(user.id);
    const context = await repository.getCourseStudyContext(studentId, {
      courseId:text(input.courseId,'courseId'),classId:text(input.classId,'classId'),learningUnitId:text(input.learningUnitId,'learningUnitId'),
    });
    if (!context) fail('Course/Class/Learning Unit integration context not found.', 'TEACHING_D27_STUDY_CONTEXT_NOT_FOUND', 404);
    const knowledgeType = normalizeKnowledgeType(input.knowledgeType || context.learning_unit_metadata?.knowledge_type || context.learning_unit_metadata?.knowledgeType);
    const subjectState = await subjectBoundary(user, context.course_id);
    if (subjectState.state !== 'SUBJECT_CURRENT') {
      return Object.freeze({
        courseId:context.course_id,classId:context.class_id,learningUnitId:context.learning_unit_id,knowledgeType,
        status:'SOURCE_CONFLICT',subjectState:subjectState.state,references:Object.freeze([]),candidate:null,
        automaticDeckMutation:false,freshPracticeRecommended:false,
      });
    }
    const corpus = await subjectReader.getCorpusForUser(studentId, context.subject_id);
    const cards = corpus?.cards || [];
    const selection = selectExistingCardReferences({
      cards,knowledgeType,learningUnitTitle:context.learning_unit_title,intendedCompetence:context.intended_competence,limit:input.limit,
    });
    const sourceVersion = `course:${context.course_state_version}:class:${context.class_state_version}:plan:${context.course_plan_version}`;
    const persisted = [];
    for (const ref of selection.references) {
      const currentCard = cards.find((card) => String(card.id) === String(ref.cardId));
      const currentVersion = currentCard?.updated_at || currentCard?.updatedAt || currentCard?.version || currentCard?.created_at || currentCard?.createdAt;
      if (!currentCard || String(currentVersion) !== String(ref.cardVersion)) continue;
      persisted.push(await repository.upsertStudyReference({
        studentId,courseId:context.course_id,classId:context.class_id,learningUnitId:context.learning_unit_id,subjectId:context.subject_id,
        cardId:ref.cardId,cardVersion:ref.cardVersion,knowledgeType,relevanceReason:ref.relevanceReason,sourceVersion,createdAt:now().toISOString(),
      }));
    }
    let candidate = null;
    if (!persisted.length && input.candidate) {
      const equivalent = findEquivalentCard(cards, input.candidate.frontContent, input.candidate.backContent);
      if (equivalent) {
        const version = equivalent.updated_at || equivalent.updatedAt || equivalent.version || equivalent.created_at || equivalent.createdAt;
        const row = await repository.upsertStudyReference({
          studentId,courseId:context.course_id,classId:context.class_id,learningUnitId:context.learning_unit_id,subjectId:context.subject_id,
          cardId:String(equivalent.id),cardVersion:String(version),knowledgeType,relevanceReason:'EXACT_DEDUPLICATION_MATCH',sourceVersion,createdAt:now().toISOString(),
        });
        persisted.push(row);
      } else {
        const built = buildValidatedCardCandidate({
          ...input.candidate,candidateId:input.candidate.candidateId || randomUUID(),studentId,courseId:context.course_id,
          classId:context.class_id,learningUnitId:context.learning_unit_id,subjectId:context.subject_id,knowledgeType,sourceVersion,
          createdAt:now().toISOString(),updatedAt:now().toISOString(),
        });
        candidate = (await repository.insertCandidate(built)).row;
      }
    }
    return Object.freeze({
      courseId:context.course_id,classId:context.class_id,learningUnitId:context.learning_unit_id,knowledgeType,
      status:persisted.length?'REFERENCES_READY':candidate?'VALIDATED_CANDIDATE_READY':selection.freshPracticeRecommended?'FRESH_PRACTICE_REQUIRED':'NO_CARD_MATCH',
      references:Object.freeze(persisted),candidate,automaticDeckMutation:false,freshPracticeRecommended:selection.freshPracticeRecommended,
    });
  }

  async function getClassReviewSet(user, input = {}) {
    const studentId = String(user.id);
    const references = await repository.listStudyReferences(studentId, {
      courseId:input.courseId || null,classId:input.classId || null,learningUnitId:input.learningUnitId || null,
    });
    if (!references.length) return Object.freeze({ references:Object.freeze([]),sourceCardsCopied:false });
    const bySubject = new Map();
    const resolved = [];
    for (const ref of references) {
      let corpus = bySubject.get(ref.subject_id);
      if (corpus === undefined) {
        corpus = await subjectReader.getCorpusForUser(studentId, ref.subject_id);
        bySubject.set(ref.subject_id, corpus || null);
      }
      const card = corpus?.cards?.find((item) => String(item.id) === String(ref.card_id));
      const version = card && (card.updated_at || card.updatedAt || card.version || card.created_at || card.createdAt);
      resolved.push(Object.freeze({
        referenceId:ref.reference_id,courseId:ref.course_id,classId:ref.class_id,learningUnitId:ref.learning_unit_id,
        subjectId:ref.subject_id,cardId:ref.card_id,knowledgeType:ref.knowledge_type,relevanceReason:ref.relevance_reason,
        referencedVersion:ref.card_version,currentVersion:version == null ? null : String(version),
        status:!card?'CARD_MISSING':String(version)===String(ref.card_version)?'CURRENT':'CARD_VERSION_CHANGED',
      }));
    }
    return Object.freeze({ references:Object.freeze(resolved),sourceCardsCopied:false,sourceCardDeletionAuthority:false });
  }

  async function dismissStudyCandidate(user, candidateId, expectedVersion) {
    const row = await repository.transitionCandidate({
      studentId:String(user.id),candidateId:text(candidateId,'candidateId'),expectedVersion:Number(expectedVersion),
      fromStatus:'VALIDATED',toStatus:'DISMISSED',at:now().toISOString(),
    });
    if (!row) fail('Study card candidate not found.', 'TEACHING_D27_CANDIDATE_NOT_FOUND', 404);
    return row;
  }

  async function promoteStudyCandidate(user, candidateId, expectedVersion, input = {}) {
    const studentId = String(user.id);
    const candidate = await repository.getCandidate(studentId, text(candidateId,'candidateId'));
    if (!candidate) fail('Study card candidate not found.', 'TEACHING_D27_CANDIDATE_NOT_FOUND', 404);
    if (candidate.status === 'PROMOTED') return Object.freeze({ disposition:'ALREADY_PROMOTED',candidate });
    if (!gates.studyPromotion) {
      await audit(studentId, 'STUDY_FSRS', 'PROMOTE_VALIDATED_CANDIDATE', { sourceRef:{candidateId:candidate.candidate_id,version:candidate.version},featureFlag:false,decision:'DENY_WRITE_GATE_OFF',outcome:'NO_WRITE' });
      fail('Teaching→Study card promotion is disabled.', 'TEACHING_D27_STUDY_PROMOTION_DISABLED', 409);
    }
    if (candidate.status !== 'VALIDATED' || Number(candidate.version) !== Number(expectedVersion)) {
      fail('Study card candidate is stale or no longer promotable.', 'TEACHING_D27_CANDIDATE_VERSION_STALE', 409, { currentVersion:candidate.version,currentStatus:candidate.status });
    }
    const subject = await subjectReader.getForUser(studentId, candidate.subject_id);
    if (!subject) fail('KIWI Subject no longer exists; candidate cannot be promoted.', 'TEACHING_D27_SUBJECT_MISSING_FOR_PROMOTION', 409);
    const adapter = ownerAdapters.studyCards;
    if (!adapter || typeof adapter.readPromotionContext !== 'function' || typeof adapter.promoteCandidate !== 'function') {
      fail('KIWI Study owner adapter is unavailable.', 'TEACHING_D27_STUDY_OWNER_UNAVAILABLE', 503);
    }
    const targetBefore = await adapter.readPromotionContext({ studentId,subjectId:candidate.subject_id,deckId:input.deckId || null });
    let promoted;
    try {
      promoted = await adapter.promoteCandidate({
        studentId,subjectId:candidate.subject_id,deckId:input.deckId || null,candidateId:candidate.candidate_id,
        idempotencyKey:`d27:study-promote:${candidate.candidate_id}`,frontContent:candidate.front_content,backContent:candidate.back_content,
        knowledgeType:candidate.knowledge_type,provenanceRefs:candidate.provenance_refs,expectedTargetVersion:targetBefore?.version ?? null,
        policyVersion:D27_CONTRACT_VERSION,
      });
    } catch (error) {
      await audit(studentId, 'STUDY_FSRS', 'PROMOTE_VALIDATED_CANDIDATE', { sourceRef:{candidateId:candidate.candidate_id,version:candidate.version},targetRef:{version:targetBefore?.version ?? null},featureFlag:true,decision:'OWNER_VALIDATED_WRITE',outcome:'OWNER_REJECTED',errorCode:error?.code || 'TARGET_OWNER_REJECTED' });
      throw error;
    }
    const cardId = text(promoted?.cardId || promoted?.id, 'promoted cardId');
    const transitioned = await repository.transitionCandidate({
      studentId,candidateId:candidate.candidate_id,expectedVersion:Number(expectedVersion),fromStatus:'VALIDATED',toStatus:'PROMOTED',
      promotedCardId:cardId,at:now().toISOString(),
    });
    await audit(studentId, 'STUDY_FSRS', 'PROMOTE_VALIDATED_CANDIDATE', { sourceRef:{candidateId:candidate.candidate_id,version:candidate.version},targetRef:{cardId,version:promoted?.version ?? null},featureFlag:true,decision:'OWNER_VALIDATED_WRITE',outcome:'OWNER_ACCEPTED' });
    return Object.freeze({ disposition:'PROMOTED',candidate:transitioned,target:promoted,fsrsStateWrittenByTeaching:false });
  }

  function status() {
    return Object.freeze({
      contractVersion:D27_CONTRACT_VERSION,taskCount:17,contracts:D27_INTEGRATION_CONTRACTS,integrationWriteGates:gates,
      subjectTruthCopied:false,examTruthCopied:false,knowledgeScoreTruthCopied:false,masteryTruthCopied:false,
      fsrsTruthCopied:false,brainTruthCopied:false,biomeTruthCopied:false,notificationsRemainShared:true,
      brainWriteEnabled:false,biomeWriteEnabled:false,achievementWriteEnabled:false,
      centralAIOrchestratorOnly:true,promptQualificationChanged:false,
    });
  }

  return Object.freeze({
    subjectBoundary,assessmentShellHandoff,publishEvent,dispatchEvent,applyKnowledgeScore,applyMasterySignal,
    prepareClassReviewSet,getClassReviewSet,dismissStudyCandidate,promoteStudyCandidate,status,
  });
}

module.exports = { createD27Service, primarySnapshotFingerprint };
