'use strict';

const { createTeachingConfig } = require('./config');
const { createKiwiSubjectReader } = require('./integrations/kiwi-subjects');
const { createKiwiExamInterface } = require('./integrations/kiwi-exam-interface');
const { createKiwiNotificationInterface } = require('./integrations/kiwi-notifications');
const { createTeachingRepositories, createD07CourseIntakeRepository, createD08CoursePlanRepository } = require('./repositories');
const { createTeachingService } = require('./services/teaching-service');
const { modules } = require('./modules');
const orchestrator = require('./orchestrator');
const preparation = require('./preparation');
const runtime = require('./runtime');
const policy = require('./policy');
const d07 = require('./d07');
const d08 = require('./d08');

function createTeachingFoundation({
  env = process.env,
  subjectSource,
  notificationPublisher = null,
  query = null,
  withTransaction = null,
  randomUUID = null,
  d07Intelligence = null,
  d08Intelligence = null,
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
};
