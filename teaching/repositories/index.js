'use strict';
const { createTeachingKernelPersistence } = require('./kernel-persistence');
const { createPreparationRuntimeRepository } = require('./preparation-runtime');
const { createD07CourseIntakeRepository } = require('./d07-course-intake');
const { createD08CoursePlanRepository } = require('./d08-course-plan');
const { createD09SchedulingRepository } = require('./d09-scheduling');
const { createD10LifecycleRequestRepository } = require('./d10-lifecycle-requests');
const { createD11LessonControllerRepository } = require('./d11-lesson-controller');
const { createD12ResponsePedagogyRepository } = require('./d12-response-pedagogy');
const { createD13StudentKnowledgeRepository } = require('./d13-student-knowledge');
const { createD14ClassroomRepository } = require('./d14-classroom');
const { createD15AttendanceRepository } = require('./d15-attendance');
const { createD16AssignmentRepository } = require('./d16-assignments');
const { createD17AssessmentRepository } = require('./d17-assessments');
const { createD20GradebookRepository } = require('./d20-gradebook');
const { createD21ProgressionRepository } = require('./d21-progression');
function requireMethod(value,name){if(!value||typeof value[name]!=='function')throw new TypeError(`Teaching repository dependency requires ${name}().`);}
function createTeachingRepositories({subjectReader,notificationInterface}){requireMethod(subjectReader,'listForUser');requireMethod(subjectReader,'getForUser');requireMethod(subjectReader,'getCorpusForUser');requireMethod(notificationInterface,'send');return Object.freeze({subjects:Object.freeze({listForUser:userId=>subjectReader.listForUser(userId),getForUser:(userId,subjectId)=>subjectReader.getForUser(userId,subjectId),getCorpusForUser:(userId,subjectId)=>subjectReader.getCorpusForUser(userId,subjectId)}),notifications:Object.freeze({send:event=>notificationInterface.send(event),available:notificationInterface.available===true})});}
module.exports={createTeachingRepositories,createTeachingKernelPersistence,createPreparationRuntimeRepository,createD07CourseIntakeRepository,createD08CoursePlanRepository,createD09SchedulingRepository,createD10LifecycleRequestRepository,createD11LessonControllerRepository,createD12ResponsePedagogyRepository,createD13StudentKnowledgeRepository,createD14ClassroomRepository,createD15AttendanceRepository,createD16AssignmentRepository,createD17AssessmentRepository,createD20GradebookRepository,createD21ProgressionRepository};
