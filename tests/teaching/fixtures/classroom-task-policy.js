'use strict';
const {messagePolicy}=require('./classroom-message-policy');
const {DEFINITIONS}=require('../../../teaching/classroom-remodel/state-policy');
function taskPolicy(){const p=messagePolicy();for(const [key,value]of Object.entries({taskSupportMaxBytes:1000,taskSupportRateLimit:5,taskSupportRateWindowMs:60000,taskDurations:{short_text:1000},extensionLimitMs:500,extensionCount:1,graceMs:0,lateSubmissionPolicy:'reject',taskResponseMaxBytes:2000,taskDraftRetentionMs:60000,taskWorkerLeaseMs:5000,taskEvaluationRetryLimit:1,taskEvaluationRetryBackoffMs:10}))p.fields[key]={value,owner:DEFINITIONS[key].owner,authoritySource:'isolated task fixture; NOT production adoption',adoptedVersion:'FIXTURE_TASKS_V1',effectiveRule:'future_sessions'};return p;}
module.exports={taskPolicy};
