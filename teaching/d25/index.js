'use strict';
const contracts = require('./contracts');
const { createD25ReliabilityService } = require('./service');
const { mountD25Routes } = require('./routes');
module.exports = { ...contracts, createD25ReliabilityService, mountD25Routes };
