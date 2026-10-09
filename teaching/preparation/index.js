'use strict';

const t0 = require('./t0-handlers');
const events = require('./events');
const workflow = require('./workflow');
const classroom = require('../classroom-remodel/preparation-service');
const classroomRuntime = require('../classroom-remodel/preparation-runtime');
const classroomReview = require('../classroom-remodel/independent-review');

module.exports = Object.freeze({ ...t0, ...events, ...workflow, ...classroom, ...classroomRuntime, ...classroomReview });
