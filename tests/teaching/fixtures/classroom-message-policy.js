'use strict';
const {fixturePolicy}=require('./classroom-presentation-policy');
const {DEFINITIONS}=require('../../../teaching/classroom-remodel/state-policy');
function messagePolicy(){const p=fixturePolicy();const values={conversationalAllowance:2,messageMaxBytes:2000,messageRateLimit:20,messageRateWindowMs:60000,messageWorkerLeaseMs:5000,messageRetryBackoffMs:10,messageRoutingRetryLimit:1,messageReplyRetryLimit:1,messageDraftRetentionMs:60000,refundPolicy:'none'};for(const [key,value]of Object.entries(values))p.fields[key]={value,owner:DEFINITIONS[key].owner,authoritySource:'isolated native test fixture; NOT production adoption',adoptedVersion:'fixture.messages.v1',effectiveRule:'future_sessions',...(key==='messageRateLimit'?{unit:'accepted_messages_per_window'}:key==='conversationalAllowance'?{unit:'accepted_turns_per_session'}:{})};return p;}
module.exports={messagePolicy};
