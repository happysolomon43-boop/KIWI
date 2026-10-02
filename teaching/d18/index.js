'use strict';

const { createD18AssessmentShellService } = require('./service');
const { mountD18Routes } = require('./routes');

module.exports = Object.freeze({
  createD18AssessmentShellService,
  mountD18Routes,
});
