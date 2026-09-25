'use strict';

const modules = Object.freeze({
  curriculum: require('./curriculum'),
  courses: require('./courses'),
  lessons: require('./lessons'),
  classroom: require('./classroom'),
  controller: require('./controller'),
  pedagogy: require('./pedagogy'),
  knowledge: require('./knowledge'),
  scheduling: require('./scheduling'),
  attendance: require('./attendance'),
  work: require('./work'),
  assessment: require('./assessment'),
  grading: require('./grading'),
  requests: require('./requests'),
  teacherIdentity: require('./teacher-identity'),
  progression: require('./progression'),
  sharedUi: require('./shared-ui'),
});

module.exports = { modules };
