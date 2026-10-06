'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {setActiveTeachingAIBoundary,getActiveTeachingAIBoundary}=require('../../../teaching/ai/runtime-bridge');
test('Teaching AI runtime bridge rejects non-boundaries',()=>{assert.throws(()=>setActiveTeachingAIBoundary({}),/execution boundary/);const boundary={execute:async()=>({})};setActiveTeachingAIBoundary(boundary);assert.equal(getActiveTeachingAIBoundary(),boundary);});
