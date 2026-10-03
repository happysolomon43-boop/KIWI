'use strict';

const crypto = require('node:crypto');
const { install: installCore } = require('./d21-progression/core');
const { install: installSnapshot } = require('./d21-progression/snapshot');
const { install: installPathways } = require('./d21-progression/pathways');
const { install: installPreparation } = require('./d21-progression/preparation');
const { install: installGpa } = require('./d21-progression/gpa');

const METHOD_NAMES = Object.freeze(["assertReady", "course", "requireCourse", "requireSemester", "attemptForCourse", "ensureInitialAttempt", "currentPolicy", "policyComparable", "lockPolicy", "latestPlanBundle", "latestCourseResult", "latestTopicScores", "latestKnowledgeForUnits", "unresolvedAssignmentIntegrity", "loadProgressionSnapshot", "stateDigest", "progressionHistory", "commitOutcome", "pathway", "createPathway", "createPreparationWorkspace", "preparationSnapshot", "appendPreparationArtifact", "pathwaySteps", "addPathwayStep", "updatePathwayState", "createRepeatAttempt", "destinationPrerequisites", "semesterCourses", "commitGpaSnapshot", "semesterRecord"]);

function D21ProgressionRepository({ query, withTransaction, randomUUID, clock = () => new Date() } = {}) {
  if (typeof query !== 'function') throw new TypeError('D21 repository requires query().');
  if (typeof withTransaction !== 'function') throw new TypeError('D21 repository requires withTransaction().');
  if (typeof randomUUID !== 'function') throw new TypeError('D21 repository requires randomUUID().');
  this.query = query;
  this.withTransaction = withTransaction;
  this.randomUUID = randomUUID;
  this.clock = clock;
  this.json = (value) => JSON.stringify(value ?? null);
  this.q = (runner, text, params = []) => runner
    ? (typeof runner === 'function' ? runner(text, params) : runner.query(text, params))
    : query(text, params);
  this.sha = (value) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
  this.fail = (message, code = 'TEACHING_D21_REPOSITORY_ERROR', status = 409, details = null) => {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    if (details) error.details = details;
    throw error;
  };
  for (const name of METHOD_NAMES) this[name] = this[name].bind(this);
}

installCore(D21ProgressionRepository.prototype);
installSnapshot(D21ProgressionRepository.prototype);
installPathways(D21ProgressionRepository.prototype);
installPreparation(D21ProgressionRepository.prototype);
installGpa(D21ProgressionRepository.prototype);

function createD21ProgressionRepository(options = {}) {
  const repository = new D21ProgressionRepository(options);
  const publicApi = Object.fromEntries(METHOD_NAMES.map((name) => [name, repository[name]]));
  return Object.freeze({ ...publicApi, contractVersion: 'd21.progression-repository.v1' });
}

module.exports = { createD21ProgressionRepository };
