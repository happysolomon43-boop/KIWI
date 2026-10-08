'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createGoogleHttpTransport} = require('../../services/ai/google-http-transport');
const {createGroqHttpTransport} = require('../../services/ai/groq-http-transport');
const {createCentralAIExecutionBoundary} = require('../../teaching/ai/central-orchestrator-boundary');

function abortableFetch(observed) {
  return async (_url, options) => {
    observed.push(options.signal);
    return new Promise((_resolve, reject) => {
      const fail = () => reject(Object.assign(new Error('cancelled'), {name:'AbortError'}));
      if (options.signal.aborted) return fail();
      options.signal.addEventListener('abort', fail, {once:true});
    });
  };
}
test('Google generation differentiates external cancellation from its timeout', async () => {
  const observed = [];
  const cancellation = new AbortController();
  const transport = createGoogleHttpTransport({fetchImpl:abortableFetch(observed)});
  const pending = transport.generate({apiKey:'not-a-real-key',modelId:'model-test',body:{},timeoutMs:10000,signal:cancellation.signal});
  cancellation.abort(new Error('parent superseded'));
  await assert.rejects(pending, error => error.code === 'CANCELLED' && error.retryable === false);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].aborted, true);
});
test('Google internal deadline remains TIMEOUT and not an academic cancellation', async () => {
  const transport=createGoogleHttpTransport({fetchImpl:abortableFetch([])});
  await assert.rejects(transport.generate({apiKey:'not-a-real-key',modelId:'test',body:{},timeoutMs:5}),error => error.code === 'TIMEOUT');
});
test('Groq generation propagates a parent abort and never treats it as a retryable timeout', async () => {
  const observed=[];
  const cancellation=new AbortController();
  const transport=createGroqHttpTransport({fetchImpl:abortableFetch(observed)});
  const pending=transport.generate({apiKey:'not-a-real-key',body:{model:'test',messages:[]},timeoutMs:10000,signal:cancellation.signal});
  cancellation.abort(new Error('parent superseded'));
  await assert.rejects(pending,error=>error.code==='CANCELLED'&&error.retryable===false);
  assert.equal(observed.length,1);
  assert.equal(observed[0].aborted,true);
});
test('Teaching central boundary carries AbortSignal without modifying legacy caller options',async()=>{
  const control=new AbortController();
  const options=[];
  const boundary=createCentralAIExecutionBoundary({aiRun:async(_task,_request,settings)=>{options.push(settings);return {structured:{ok:true}};}});
  const config={taskId:'MAIN_CBT',request:{content:'test'},responsibilityKey:'teaching.test',intelligenceClass:'DIRECT-AI',authorityLevel:'T1'};
  await boundary.execute({...config,signal:control.signal,centralRouteOptions:{executionProfile:'LONG_RUNNING_ANALYSIS'}});
  await boundary.execute({...config,centralRouteOptions:{preparationRoutePosture:'bounded_interpretive'}});
  assert.equal(options[0].signal,control.signal);
  assert.equal(options[0].executionProfile,'LONG_RUNNING_ANALYSIS');
  assert.deepEqual(options[1],{preparationRoutePosture:'bounded_interpretive'});
});
test('Teaching does not invent safe Teacher output when academic parent aborts', async()=>{
  const control=new AbortController();
  let fallbackCalls=0;
  const boundary=createCentralAIExecutionBoundary({aiRun:async()=>{control.abort();throw new Error('network aborted');}});
  await assert.rejects(boundary.execute({
    taskId:'MAIN_CBT',request:{content:'test'},responsibilityKey:'teaching.test',
    intelligenceClass:'DIRECT-AI',authorityLevel:'T1',signal:control.signal,
    safeCommunicationFallback:()=>{fallbackCalls++;return {message:'invented reply'};}
  }), error=>error.code==='TEACHING_AI_EXECUTION_FAILED');
  assert.equal(fallbackCalls,0);
});
