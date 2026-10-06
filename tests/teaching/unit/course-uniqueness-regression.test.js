'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {dedupeCourses}=require('../../../teaching/d07/course-uniqueness-service');
test('canonical course selection prefers an active course over newer duplicate drafts',()=>{const result=dedupeCourses([{course_id:'draft',subject_id:'s',lifecycle_state:'DRAFT',updated_at:'2026-10-06T01:00:00Z'},{course_id:'active',subject_id:'s',lifecycle_state:'ACTIVE',updated_at:'2026-10-05T01:00:00Z'}]);assert.equal(result.length,1);assert.equal(result[0].course_id,'active');});
