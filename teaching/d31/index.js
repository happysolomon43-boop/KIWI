'use strict';

module.exports = Object.freeze({
  ...require('./contracts'),
  ...require('./task-accounting'),
  ...require('./academic-limitations'),
  ...require('./owner-release-override'),
  ...require('./release-intelligence'),
});
