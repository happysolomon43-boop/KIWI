'use strict';

const t0 = require('./t0-handlers');
const events = require('./events');
const workflow = require('./workflow');
const classroom = require('../classroom-remodel/preparation-service');

module.exports = Object.freeze({ ...t0, ...events, ...workflow, ...classroom });
