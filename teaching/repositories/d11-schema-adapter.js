'use strict';

const { createD11LessonControllerRepository: createBaseD11LessonControllerRepository } = require('./d11-lesson-controller');

const LEGACY_LEARNING_UNIT_ORDER = 'select * from public.teaching_learning_units where student_id=$1 and course_plan_id=$2 order by sequence_no,learning_unit_id';
const CANONICAL_LEARNING_UNIT_ORDER = `select u.*
  from public.teaching_learning_units u
  join public.teaching_topics t
    on t.student_id=u.student_id and t.topic_id=u.topic_id and t.course_plan_id=u.course_plan_id
  left join public.teaching_subtopics s
    on s.student_id=u.student_id and s.subtopic_id=u.subtopic_id and s.topic_id=u.topic_id
  where u.student_id=$1 and u.course_plan_id=$2
  order by t.ordinal, s.ordinal nulls first, u.learning_unit_id`;

function rewriteD11LearningUnitOrdering(text) {
  if (typeof text !== 'string') return text;
  if (!text.includes('public.teaching_learning_units')) return text;
  if (!text.includes('order by sequence_no,learning_unit_id')) return text;
  return text.replace(LEGACY_LEARNING_UNIT_ORDER, CANONICAL_LEARNING_UNIT_ORDER);
}

function wrapRunner(runner) {
  if (!runner || typeof runner.query !== 'function') return runner;
  return new Proxy(runner, {
    get(target, property, receiver) {
      if (property === 'query') {
        return (text, params) => target.query(rewriteD11LearningUnitOrdering(text), params);
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function createD11LessonControllerRepository(options = {}) {
  const { query, withTransaction, ...rest } = options;
  if (typeof query !== 'function') return createBaseD11LessonControllerRepository(options);

  const adaptedQuery = (text, params) => query(rewriteD11LearningUnitOrdering(text), params);
  const adaptedTransaction = typeof withTransaction === 'function'
    ? (work) => withTransaction((runner) => work(wrapRunner(runner)))
    : withTransaction;

  const base = createBaseD11LessonControllerRepository({
    ...rest,
    query: adaptedQuery,
    withTransaction: adaptedTransaction,
  });

  return Object.freeze({
    ...base,
    getClassContext: (studentId, classId, runner = null) =>
      base.getClassContext(studentId, classId, wrapRunner(runner)),
  });
}

module.exports = {
  LEGACY_LEARNING_UNIT_ORDER,
  CANONICAL_LEARNING_UNIT_ORDER,
  rewriteD11LearningUnitOrdering,
  createD11LessonControllerRepository,
};
