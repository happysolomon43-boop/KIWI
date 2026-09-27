'use strict';

module.exports = {
  ...require('./contracts-core'),
  ...require('./canonical-plan'),
  ...require('./durable-plan'),
  ...require('./coverage-contract'),
  ...require('./scope-contract'),
};
