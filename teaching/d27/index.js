'use strict';

module.exports = Object.freeze({
  ...require('./contracts'),
  ...require('./conflicts'),
  ...require('./study'),
  ...require('./service'),
  ...require('./source-reader'),
  ...require('./routes'),
  ...require('./task-accounting'),
});
