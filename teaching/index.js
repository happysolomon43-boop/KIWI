'use strict';

const { createTeachingConfig } = require('./config');
const { createKiwiSubjectReader } = require('./integrations/kiwi-subjects');
const { createKiwiExamInterface } = require('./integrations/kiwi-exam-interface');
const { createKiwiNotificationInterface } = require('./integrations/kiwi-notifications');
const { createTeachingRepositories, createPreparationRuntimeRepository, createD07CourseIntakeRepository, createD08CoursePlanRepository, createD09SchedulingRepository, createD10LifecycleRequestRepository, createD11LessonControllerRepository } = require('./repositories');
const { createTeachingService } = require('./services/teaching-service');
const { modules } = require('./modules');
const orchestrator = require('./orchestrator');
const preparation = require('./preparation');
const runtime = require('./runtime');
const policy = require('./policy');
const d07 = require('./d07');
const d08 = require('./d08');
const d09 = require('./d09');
const d10 = require('./d10');
const d11 = require('./d11');

function createTeachingFoundation({
  env = process.env,
  subjectSource,
  notificationPublisher = null,
  query = null,
  withTransaction = null,
  randomUUID = null,
  d07Intelligence = null,
  d08Intelligence = null,
  d09Intelligence = null,
  d09TransactionalMutation = null,
  d10RuntimePlatform = null,
  d11Intelligence = null,
  d11PublishedEventRegistry = null,
} = {}) {
  const config = createTeachingConfig(env);
  const subjectReader = createKiwiSubjectReader({ subjects: subjectSource });
  const examInterface = createKiwiExamInterface();
  const notificationInterface = createKiwiNotificationInterface({
    publish: notificationPublisher,
  });
  const repositories = createTeachingRepositories({
    subjectReader,
    notificationInterface,
  });
  const d07Repository = typeof query === 'function' && typeof withTransaction === 'function' && typeof randomUUID === 'function'
    ? createD07CourseIntakeRepository({ query, withTransaction, randomUUID })
    : null;
  const d07Service = d07Repository
    ? d07.createD07Service({ subjects: repositories.subjects, repository: d07Repository, intelligence: d07Intelligence })
    : null;
  const d08Repository = typeof query === 'function' && typeof withTransaction === 'function' && typeof randomUUID === 'function'
    ? createD08CoursePlanRepository({ query, withTransaction, randomUUID })
    : null;
  const d08Service = d08Repository && d07Repository
    ? d08.createD08Service({ subjects: repositories.subjects, d07Repository, repository: d08Repository, intelligence: d08Intelligence })
    : null;
  const d09Repository = typeof query === 'function' && typeof withTransaction === 'function' && typeof randomUUID === 'function'
    ? createD09SchedulingRepository({ query, withTransaction, randomUUID })
    : null;
  const d09Service = d09Repository && d09TransactionalMutation
    ? d09.createD09Service({ repository: d09Repository, transactionalMutation: d09TransactionalMutation, randomUUID, intelligence: d09Intelligence })
    : null;
  const d10Repository = typeof query === 'function' && typeof withTransaction === 'function' && typeof randomUUID === 'function'
    ? createD10LifecycleRequestRepository({ query, withTransaction, randomUUID })
    : null;
  const d10Service = d10Repository && d09Repository && d09TransactionalMutation
    ? d10.createD10Service({ repository: d10Repository, d09Repository, transactionalMutation: d09TransactionalMutation, randomUUID })
    : null;
  if (d10Service && d10RuntimePlatform?.eventRuntime) {
    d10.registerD10DueEventHandler({ eventRuntime: d10RuntimePlatform.eventRuntime, repository: d10Repository, service: d10Service });
  }

  const d11Repository = typeof query === 'function' && typeof withTransaction === 'function' && typeof randomUUID === 'function'
    ? createD11LessonControllerRepository({ query, withTransaction, randomUUID, outboxStore:d10RuntimePlatform?.outboxStore || null })
    : null;
  const d11PreparationRepository = typeof query === 'function' && typeof withTransaction === 'function' && typeof randomUUID === 'function'
    ? createPreparationRuntimeRepository({ query, withTransaction, randomUUID })
    : null;
  const d11Service = d11Repository && d10RuntimePlatform?.eventStore
    ? d11.createD11Service({
        repository: d11Repository,
        intelligence: d11Intelligence,
        withTransaction,
        dueEventStore: d10RuntimePlatform.eventStore,
        preparationRepository: d11PreparationRepository,
      })
    : null;
  let d11Runtime = null;
  if (
    d11Service &&
    d11PublishedEventRegistry &&
    d10RuntimePlatform?.eventRuntime &&
    d10RuntimePlatform?.eventStore
  ) {
    d11Runtime = d11.registerD11Runtime({
      publishedEvents: d11PublishedEventRegistry,
      eventRuntime: d10RuntimePlatform.eventRuntime,
      dueEventStore: d10RuntimePlatform.eventStore,
      repository: d11Repository,
      service: d11Service,
    });
  }
  const service = createTeachingService({
    config,
    repositories,
    examInterface,
  });

  return Object.freeze({
    config,
    modules,
    integrations: Object.freeze({
      subjects: subjectReader,
      exams: examInterface,
      notifications: notificationInterface,
    }),
    repositories,
    service,
    d07: d07Service ? Object.freeze({ repository: d07Repository, service: d07Service }) : null,
    d08: d08Service ? Object.freeze({ repository: d08Repository, service: d08Service }) : null,
    d09: d09Service ? Object.freeze({ repository: d09Repository, service: d09Service }) : null,
    d10: d10Service ? Object.freeze({ repository: d10Repository, service: d10Service }) : null,
    d11: d11Service ? Object.freeze({ repository: d11Repository, service: d11Service, runtime: d11Runtime }) : null,
    policy,
  });
}

module.exports = {
  createTeachingFoundation,
  orchestrator,
  preparation,
  runtime,
  policy,
  d07,
  d08,
  d09,
  d10,
  d11,
};
