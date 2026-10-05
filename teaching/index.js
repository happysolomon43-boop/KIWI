'use strict';

const { createTeachingConfig } = require('./config');
const { createKiwiSubjectReader } = require('./integrations/kiwi-subjects');
const { createKiwiExamInterface } = require('./integrations/kiwi-exam-interface');
const { createKiwiNotificationInterface } = require('./integrations/kiwi-notifications');
const { createIntegrityRepository, createIntegrityService } = require('../services/integrity');
const {
  createTeachingRepositories,
  createPreparationRuntimeRepository,
  createD07CourseIntakeRepository,
  createD08CoursePlanRepository,
  createD09SchedulingRepository,
  createD10LifecycleRequestRepository,
  createD11LessonControllerRepository,
  createD12ResponsePedagogyRepository,
  createD13StudentKnowledgeRepository,
  createD14ClassroomRepository,
  createD15AttendanceRepository,
  createD16AssignmentRepository,
  createD17AssessmentRepository,
  createD20GradebookRepository,
  createD21ProgressionRepository,
  createD22TeacherIdentityRepository,
  createD26CoordinationRepository,
  createD27IntegrationRepository,
} = require('./repositories');
const { createD14Service } = require('./d14/service');
const { registerD14Runtime } = require('./d14/runtime');
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
const d12 = require('./d12');
const d13 = require('./d13');
const d14 = require('./d14');
const d15 = require('./d15');
const d16 = require('./d16');
const d17 = require('./d17');
const d20 = require('./d20');
const d21 = require('./d21');
const d22 = require('./d22');
const d26 = require('./d26');
const d27 = require('./d27');

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
  d12Intelligence = null,
  d12PublishedEventRegistry = null,
  d13Intelligence = null,
  d13PublishedEventRegistry = null,
  d16Intelligence = null,
  d17Intelligence = null,
  d20Intelligence = null,
  d21Intelligence = null,
  d22Intelligence = null,
  d27OwnerAdapters = null,
  d27IntegrationEventPublisher = null,
} = {}) {
  const config = createTeachingConfig(env);
  const subjectReader = createKiwiSubjectReader({ subjects: subjectSource });
  const examInterface = createKiwiExamInterface();
  const notificationInterface = createKiwiNotificationInterface({ publish: notificationPublisher });
  const repositories = createTeachingRepositories({ subjectReader, notificationInterface });
  const persistentDepsReady = typeof query === 'function'
    && typeof withTransaction === 'function'
    && typeof randomUUID === 'function';

  const d07Repository = persistentDepsReady
    ? createD07CourseIntakeRepository({ query, withTransaction, randomUUID })
    : null;
  const d07Service = d07Repository
    ? d07.createD07Service({ subjects: repositories.subjects, repository: d07Repository, intelligence: d07Intelligence, outboxStore:d10RuntimePlatform?.outboxStore || null, randomUUID })
    : null;

  const d08Repository = persistentDepsReady
    ? createD08CoursePlanRepository({ query, withTransaction, randomUUID })
    : null;
  const d08Service = d08Repository && d07Repository
    ? d08.createD08Service({ subjects: repositories.subjects, d07Repository, repository: d08Repository, intelligence: d08Intelligence })
    : null;

  const d09Repository = persistentDepsReady
    ? createD09SchedulingRepository({ query, withTransaction, randomUUID })
    : null;
  const d09Service = d09Repository && d09TransactionalMutation
    ? d09.createD09Service({ repository: d09Repository, transactionalMutation: d09TransactionalMutation, randomUUID, intelligence: d09Intelligence })
    : null;
  const d09AttendanceRecoveryOwner = persistentDepsReady && typeof d09.createD09AttendanceRecoveryOwner === 'function'
    ? d09.createD09AttendanceRecoveryOwner({ query, withTransaction, randomUUID })
    : null;

  const d15Repository = persistentDepsReady
    ? createD15AttendanceRepository({ query, withTransaction, randomUUID })
    : null;
  const d16Repository = persistentDepsReady
    ? createD16AssignmentRepository({
        query,
        withTransaction,
        randomUUID,
        dueEventStore:d10RuntimePlatform?.eventStore || null,
      })
    : null;
  const d17Repository = persistentDepsReady
    ? createD17AssessmentRepository({ query, withTransaction, randomUUID, dueEventStore:d10RuntimePlatform?.eventStore || null })
    : null;
  const d20Repository = persistentDepsReady
    ? createD20GradebookRepository({ query, withTransaction, randomUUID })
    : null;
  const d20DownstreamBridge = { reconcileGradeChange:null };
  const d21Repository = persistentDepsReady
    ? createD21ProgressionRepository({ query, withTransaction, randomUUID })
    : null;
  const d22Repository = persistentDepsReady
    ? createD22TeacherIdentityRepository({ query, withTransaction, randomUUID })
    : null;
  const integrityRepository = persistentDepsReady
    ? createIntegrityRepository({ query, withTransaction, randomUUID })
    : null;
  const d26Repository = persistentDepsReady
    ? createD26CoordinationRepository({query,withTransaction,randomUUID})
    : null;
  const d27Repository = persistentDepsReady
    ? createD27IntegrationRepository({query,withTransaction,randomUUID})
    : null;
  const d27SourceVersionReader = persistentDepsReady
    ? d27.createD27SourceVersionReader({query})
    : null;

  const d10Repository = persistentDepsReady
    ? createD10LifecycleRequestRepository({ query, withTransaction, randomUUID })
    : null;
  const d10Service = d10Repository && d09Repository && d09TransactionalMutation
    ? d10.createD10Service({
        repository: d10Repository,
        d09Repository,
        transactionalMutation: d09TransactionalMutation,
        randomUUID,
        outboxStore:d10RuntimePlatform?.outboxStore || null,
        attendanceRequestOwner:d15Repository,
        workRequestOwner:d16Repository,
      })
    : null;
  if (d10Service && d10RuntimePlatform?.eventRuntime) {
    d10.registerD10DueEventHandler({
      eventRuntime: d10RuntimePlatform.eventRuntime,
      repository: d10Repository,
      service: d10Service,
    });
  }
  const d22Service = d22Repository && d10Service
    ? d22.createD22Service({ repository:d22Repository, d10Service, intelligence:d22Intelligence, randomUUID })
    : null;

  const d11RepositoryBase = persistentDepsReady
    ? createD11LessonControllerRepository({
        query,
        withTransaction,
        randomUUID,
        outboxStore:d10RuntimePlatform?.outboxStore || null,
      })
    : null;
  const d11Repository = d11RepositoryBase && d16Repository
    ? Object.freeze({
        ...d11RepositoryBase,
        getPlanningSignals: async (studentId,classRow) => {
          const base = await d11RepositoryBase.getPlanningSignals(studentId,classRow);
          try {
            return Object.freeze({
              ...base,
              workSignals: await d16Repository.planningSignals(studentId,classRow.course_id),
            });
          } catch (error) {
            return Object.freeze({
              ...base,
              workSignals:Object.freeze({
                status:'D16_UNAVAILABLE',
                signals:Object.freeze([]),
                negative_inference_forbidden:true,
                official_marks_included:false,
                reason:error?.code || 'D16_WORK_OWNER_UNAVAILABLE',
              }),
            });
          }
        },
      })
    : d11RepositoryBase;
  const d11PreparationRepository = persistentDepsReady
    ? createPreparationRuntimeRepository({ query, withTransaction, randomUUID })
    : null;
  const d11Service = d11Repository && d10RuntimePlatform?.eventStore
    ? d11.createD11Service({
        repository: d11Repository,
        intelligence: d11Intelligence,
        withTransaction,
        dueEventStore: d10RuntimePlatform.eventStore,
        outboxStore: d10RuntimePlatform.outboxStore,
        preparationRepository: d11PreparationRepository,
      })
    : null;

  const d15Service = d15Repository && d11Repository && d11Service
    ? d15.createD15Service({
        repository:d15Repository,
        d11Repository,
        d11Service,
        schedulerRecoveryOwner:d09AttendanceRecoveryOwner,
        dueEventStore:d10RuntimePlatform?.eventStore || null,
        randomUUID,
      })
    : null;

  let d11Runtime = null;
  if (
    d11Service
    && d11PublishedEventRegistry
    && d10RuntimePlatform?.eventRuntime
    && d10RuntimePlatform?.eventStore
  ) {
    d11Runtime = d11.registerD11Runtime({
      publishedEvents: d11PublishedEventRegistry,
      eventRuntime: d10RuntimePlatform.eventRuntime,
      dueEventStore: d10RuntimePlatform.eventStore,
      repository: d11Repository,
      service: d11Service,
      attendanceService:d15Service,
    });
  }

  const d15Runtime = d15Service && d10RuntimePlatform?.eventRuntime
    ? d15.registerD15Runtime({
        eventRuntime:d10RuntimePlatform.eventRuntime,
        publishedEvents:d11PublishedEventRegistry,
        repository:d15Repository,
        service:d15Service,
      })
    : null;

  const d12Repository = d11Repository && persistentDepsReady
    ? createD12ResponsePedagogyRepository({
        query,
        withTransaction,
        randomUUID,
        d11Repository,
        outboxStore: d10RuntimePlatform?.outboxStore || null,
      })
    : null;
  const d12Service = d12Repository
    ? d12.createD12Service({ repository: d12Repository, intelligence: d12Intelligence, randomUUID })
    : null;
  let d12Runtime = null;
  if (d12Service && d12PublishedEventRegistry) {
    d12Runtime = d12.registerD12Runtime({ publishedEvents: d12PublishedEventRegistry, service: d12Service });
  }

  const d13Repository = d12Repository && persistentDepsReady
    ? createD13StudentKnowledgeRepository({ query, withTransaction, randomUUID })
    : null;
  const d13Service = d13Repository
    ? d13.createD13Service({ repository: d13Repository, intelligence: d13Intelligence, randomUUID })
    : null;
  let d13Runtime = null;
  if (d13Service && d13PublishedEventRegistry) {
    d13Runtime = d13.registerD13Runtime({ publishedEvents: d13PublishedEventRegistry, service: d13Service });
  }

  const d16Service = d16Repository
    ? d16.createD16Service({
        repository:d16Repository,
        intelligence:d16Intelligence,
        d13Service,
        randomUUID,
      })
    : null;
  const integrityService = integrityRepository && d16Repository
    ? createIntegrityService({
        repository: integrityRepository,
        d16Repository,
        d16Intelligence,
        randomUUID,
      })
    : null;
  const d16Runtime = d16Service && d10RuntimePlatform?.eventRuntime
    ? d16.registerD16Runtime({
        publishedEvents:d11PublishedEventRegistry,
        eventRuntime:d10RuntimePlatform.eventRuntime,
        repository:d16Repository,
        service:d16Service,
      })
    : null;

  const d17Service = d17Repository
    ? d17.createD17Service({ repository:d17Repository, intelligence:d17Intelligence, integrityService, randomUUID })
    : null;
  const d17Runtime = d17Service && d10RuntimePlatform?.eventRuntime
    ? d17.registerD17Runtime({ eventRuntime:d10RuntimePlatform.eventRuntime, repository:d17Repository, service:d17Service })
    : null;

  const d14Repository = d11Repository && persistentDepsReady
    ? createD14ClassroomRepository({query,withTransaction,randomUUID,d11Repository})
    : null;
  const d14Service = d14Repository && d11Service && d12Service
    ? createD14Service({
        repository:d14Repository,
        d11Repository,
        d11Service,
        d12Service,
        attendanceService:d15Service,
        randomUUID,
      })
    : null;
  const d14Runtime = d14Service && d11PublishedEventRegistry
    ? registerD14Runtime({publishedEvents:d11PublishedEventRegistry,service:d14Service})
    : null;

  const service = createTeachingService({ config, repositories, examInterface });
  const d26Service = d26Repository
    ? d26.createD26Service({repository:d26Repository,notificationInterface,dueEventStore:d10RuntimePlatform?.eventStore||null,clock:()=>new Date(),randomUUID})
    : null;
  const d26Runtime = d26Service && d10RuntimePlatform?.eventRuntime
    ? d26.registerD26Runtime({eventRuntime:d10RuntimePlatform.eventRuntime,service:d26Service,preparationRepository:d11PreparationRepository})
    : null;
  const d27Service = d27Repository
    ? d27.createD27Service({
        repository:d27Repository,
        subjectReader,
        examInterface,
        notificationInterface,
        ownerAdapters:d27OwnerAdapters || {},
        sourceVersionReader:d27SourceVersionReader,
        integrationEventPublisher:d27IntegrationEventPublisher,
        writeGates:{
          ksWrite:config.integrations?.d27?.ksWriteEnabled === true,
          masteryWrite:config.integrations?.d27?.masteryWriteEnabled === true,
          studyPromotion:config.integrations?.d27?.studyPromotionEnabled === true,
        },
        randomUUID,
        clock:()=>new Date(),
      })
    : null;

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
    d09: d09Service ? Object.freeze({ repository: d09Repository, service: d09Service, attendanceRecoveryOwner:d09AttendanceRecoveryOwner }) : null,
    d10: d10Service ? Object.freeze({ repository: d10Repository, service: d10Service }) : null,
    d11: d11Service ? Object.freeze({ repository: d11Repository, service: d11Service, runtime: d11Runtime }) : null,
    d12: d12Service ? Object.freeze({ repository: d12Repository, service: d12Service, runtime:d12Runtime }) : null,
    d13: d13Service ? Object.freeze({ repository:d13Repository, service:d13Service, runtime:d13Runtime }) : null,
    d14: d14Service ? Object.freeze({ repository:d14Repository, service:d14Service, runtime:d14Runtime }) : null,
    d15: d15Service ? Object.freeze({ repository:d15Repository, service:d15Service, runtime:d15Runtime }) : null,
    d16: d16Service ? Object.freeze({ repository:d16Repository, service:d16Service, runtime:d16Runtime }) : null,
    d17: d17Service ? Object.freeze({ repository:d17Repository, service:d17Service, runtime:d17Runtime }) : null,
    d20: d20Repository ? Object.freeze({ repository:d20Repository, intelligence:d20Intelligence, randomUUID, downstreamBridge:d20DownstreamBridge }) : null,
    d21: d21Repository ? Object.freeze({ repository:d21Repository, intelligence:d21Intelligence, randomUUID }) : null,
    d22: d22Service ? Object.freeze({ repository:d22Repository, service:d22Service, intelligence:d22Intelligence, randomUUID }) : null,
    d26: d26Service ? Object.freeze({repository:d26Repository,service:d26Service,runtime:d26Runtime}) : null,
    d27: d27Service ? Object.freeze({repository:d27Repository,service:d27Service}) : null,
    integrity: integrityService ? Object.freeze({ repository:integrityRepository, service:integrityService }) : null,
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
  d12,
  d13,
  d14,
  d15,
  d16,
  d17,
  d20,
  d21,
  d22,
  d26,
  d27,
};
