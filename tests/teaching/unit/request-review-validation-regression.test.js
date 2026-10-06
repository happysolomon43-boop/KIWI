'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validateRequestForReview}=require('../../../teaching/d10/request-experience-service');
test('valid multi-window availability remains reviewable',()=>{assert.equal(validateRequestForReview({type:'PERMANENT_AVAILABILITY_CHANGE',requestedChange:{scheduleInputs:{semester:{semesterId:'sem',name:'Semester',startsAt:'2026-10-01T00:00:00Z',endsAt:'2026-12-01T00:00:00Z',timezone:'Africa/Lagos'},availability:[{dayOfWeek:1,startLocal:'09:00',endLocal:'12:00',kind:'AVAILABLE'},{dayOfWeek:3,startLocal:'14:00',endLocal:'17:00',kind:'AVAILABLE'}],blocks:[],deadlines:[],reserves:[],preferences:{}}}}),true);});
