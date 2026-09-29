'use strict';

const { createModuleDescriptor } = require('../../module-descriptor');

module.exports = createModuleDescriptor('courses', {
  authority: 'course_lifecycle',
  status: 'implemented-d10',
});
