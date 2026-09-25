'use strict';

const { createTeachingConfig } = require('./config');
const { createKiwiSubjectReader } = require('./integrations/kiwi-subjects');
const { createKiwiExamInterface } = require('./integrations/kiwi-exam-interface');
const { createKiwiNotificationInterface } = require('./integrations/kiwi-notifications');
const { createTeachingRepositories } = require('./repositories');
const { createTeachingService } = require('./services/teaching-service');
const { modules } = require('./modules');

function createTeachingFoundation({
  env = process.env,
  subjectSource,
  notificationPublisher = null,
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
  });
}

module.exports = { createTeachingFoundation };
