'use strict';

const { createModuleDescriptor } = require('../../module-descriptor');
const d09 = require('../../d09');

module.exports = Object.freeze({
  ...createModuleDescriptor('scheduling', {
    authority: 'scheduler',
    status: 'implemented-d09',
  }),
  ...d09,
});
