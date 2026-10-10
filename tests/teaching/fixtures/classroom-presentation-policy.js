'use strict';
const {DEFINITIONS}=require('../../../teaching/classroom-remodel/state-policy');
// Isolated fault-harness policy. Never adopted for production.
function fixturePolicy(){const values={paceProfiles:{normal:{minimumDwellMs:10,maximumDwellMs:100,contentTypeWeights:{text:1,diagram:2}},slow:{minimumDwellMs:20,maximumDwellMs:100,contentTypeWeights:{text:1,diagram:2}}},bufferPortions:8,bufferBytes:100000,bufferSourceHorizon:4,clientLeaseMs:60000,clientRenewalMs:20000,takeoverPolicy:'explicit_epoch_takeover',closureLeadMs:0,reconnectBackoffMs:10,deltaPageSize:10,cursorRetentionMs:60000,generationTimeoutMs:1000,generationRetryLimit:0,generationBudget:10000};return {version:'FIXTURE_ONLY_NOT_PRODUCTION',fields:Object.fromEntries(Object.entries(values).map(([key,value])=>[key,{value,owner:DEFINITIONS[key].owner,authoritySource:'isolated fault harness',adoptedVersion:'fixture.v1',effectiveRule:'future_sessions'}]))};}
module.exports={fixturePolicy};
