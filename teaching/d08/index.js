'use strict';

const contracts = require('./contracts');
const canonical = require('./canonical-plan');
const intelligence = require('./intelligence');
const { createD08Service: createBaseD08Service } = require('./service');
const { decorateD08Service } = require('./review-experience-service');

function createD08Service(options = {}) {
  return decorateD08Service(createBaseD08Service(options), options);
}

module.exports = {
  ...contracts,
  ...canonical,
  ...intelligence,
  createD08Service,
};
