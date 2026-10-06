'use strict';
const {createPostgresTeachingEventStore}=require('./postgres-event-store');
const {createDurableTeachingEventRuntime}=require('./durable-event-runtime');
const {createPostgresTeachingExecutionTelemetry}=require('../observability/postgres-execution-telemetry');
const {createCentralAIExecutionBoundary}=require('../ai/central-orchestrator-boundary');
const {setActiveTeachingAIBoundary}=require('../ai/runtime-bridge');
const {createD28AiExecutionControls}=require('../d28/ai-controls');
const {createD28RuntimeService}=require('../d28/runtime-service');
const {setD28RuntimeService}=require('../d28/runtime-bridge');
const {createTeachingPromptControlPlane}=require('../prompt-runtime');
const {createPostgresOrchestrationStore}=require('./postgres-orchestration-store');
const {createPostgresTeachingOutboxStore}=require('./postgres-outbox-store');
const {createDurableTeachingOutboxRuntime}=require('./durable-outbox-runtime');
const {createTransactionalTeachingMutation}=require('./transactional-mutation');
function parseBounded(value,fallback,min,max){const parsed=Number(value);if(!Number.isFinite(parsed))return fallback;return Math.max(min,Math.min(Math.floor(parsed),max));}
function createTeachingRuntimePlatform({query,randomUUID,aiRun,env=process.env,logger=console,clock=()=>new Date(),timers}={}){
 if(typeof query!=='function')throw new TypeError('Teaching runtime requires query().');if(typeof randomUUID!=='function')throw new TypeError('Teaching runtime requires randomUUID().');if(typeof aiRun!=='function')throw new TypeError('Teaching runtime requires central aiRun().');
 const eventStore=createPostgresTeachingEventStore({query,randomUUID});
 const executionTelemetry=createPostgresTeachingExecutionTelemetry({query,randomUUID});
 const promptControl=createTeachingPromptControlPlane();
 const d28Service=createD28RuntimeService({query,randomUUID,env,logger,timers:timers||globalThis});
 setD28RuntimeService(d28Service);
 const aiExecutionControls=createD28AiExecutionControls({cacheRepository:d28Service.repository,maxValidationAttempts:parseBounded(env.TEACHING_D28_AI_VALIDATION_ATTEMPTS,2,1,3)});
 const workerId=`teaching-runtime:${randomUUID()}`;
 const eventRuntime=createDurableTeachingEventRuntime({store:eventStore,workerId,logger,clock,timers,pollMs:parseBounded(env.TEACHING_RUNTIME_POLL_MS,5000,1000,60000),leaseMs:parseBounded(env.TEACHING_RUNTIME_LEASE_MS,30000,5000,300000),batchSize:parseBounded(env.TEACHING_RUNTIME_BATCH_SIZE,20,1,100),maxAttempts:parseBounded(env.TEACHING_RUNTIME_MAX_ATTEMPTS,5,1,20),retryBaseMs:parseBounded(env.TEACHING_RUNTIME_RETRY_BASE_MS,5000,1000,300000)});
 const aiBoundary=createCentralAIExecutionBoundary({aiRun,telemetry:executionTelemetry,executionControls:aiExecutionControls});
 setActiveTeachingAIBoundary(aiBoundary);
 let ready=false,lastInitializationError=null;
 async function initialize(){try{promptControl.assertReady();await eventStore.assertReady();await executionTelemetry.assertReady();await d28Service.assertReady();ready=true;lastInitializationError=null;logger?.info?.('[KIWI Teaching] Frozen prompt runtime verified: 20/20 families, manifest v1.4');logger?.info?.('[KIWI Teaching D28] operational hardening runtime verified.');return true;}catch(error){ready=false;lastInitializationError={code:error?.code||null,message:error?.message||String(error)};throw error;}}
 function start(){if(!ready){const error=new Error('Teaching durable runtime cannot start before schema readiness passes.');error.code='TEACHING_RUNTIME_NOT_READY';throw error;}d28Service.start();return eventRuntime.start();}
 function stop(){d28Service.stop();return eventRuntime.stop();}
 function status(){return Object.freeze({ready,lastInitializationError,events:eventRuntime.status(),controlPlane:promptControl.status(),d28:d28Service.status()});}
 return Object.freeze({eventStore,eventRuntime,executionTelemetry,aiBoundary,aiExecutionControls,promptControl,d28Service,initialize,start,stop,status});
}
function createTeachingD05RuntimePlatform({query,withTransaction,randomUUID,aiRun,eventPublisher,env=process.env,logger=console,clock=()=>new Date(),timers}={}){
 if(typeof withTransaction!=='function')throw new TypeError('Teaching D05 runtime requires withTransaction().');if(typeof eventPublisher!=='function')throw new TypeError('Teaching D05 runtime requires eventPublisher().');
 const base=createTeachingRuntimePlatform({query,randomUUID,aiRun,env,logger,clock,timers});
 const orchestrationStore=createPostgresOrchestrationStore({query});
 const outboxStore=createPostgresTeachingOutboxStore({query,randomUUID});
 const outboxRuntime=createDurableTeachingOutboxRuntime({store:outboxStore,publish:eventPublisher,workerId:`teaching-outbox:${randomUUID()}`,logger,clock,timers,pollMs:parseBounded(env.TEACHING_OUTBOX_POLL_MS,5000,1000,60000),leaseMs:parseBounded(env.TEACHING_OUTBOX_LEASE_MS,30000,5000,300000),batchSize:parseBounded(env.TEACHING_OUTBOX_BATCH_SIZE,20,1,100),maxAttempts:parseBounded(env.TEACHING_OUTBOX_MAX_ATTEMPTS,8,1,20),retryBaseMs:parseBounded(env.TEACHING_OUTBOX_RETRY_BASE_MS,5000,1000,300000)});
 const transactionalMutation=createTransactionalTeachingMutation({withTransaction,outboxStore,dueEventStore:base.eventStore});let ready=false,lastInitializationError=null;
 async function initialize(){try{await base.initialize();await orchestrationStore.assertReady();await outboxStore.assertReady();ready=true;lastInitializationError=null;return true;}catch(error){ready=false;lastInitializationError={code:error?.code||null,message:error?.message||String(error)};throw error;}}
 function start(){if(!ready){const error=new Error('Teaching D05 runtime cannot start before D02/D05/D28 schema readiness passes.');error.code='TEACHING_D05_RUNTIME_NOT_READY';throw error;}return Object.freeze({dueEvents:base.start(),eventOutbox:outboxRuntime.start(),d28:base.d28Service.status()});}
 function stop(){return Object.freeze({dueEvents:base.stop(),eventOutbox:outboxRuntime.stop()});}
 function status(){return Object.freeze({ready,lastInitializationError,base:base.status(),outbox:outboxRuntime.status(),d28:base.d28Service.status()});}
 return Object.freeze({...base,orchestrationStore,outboxStore,outboxRuntime,transactionalMutation,initialize,start,stop,status});
}
module.exports={createTeachingRuntimePlatform,createTeachingD05RuntimePlatform,createPostgresOrchestrationStore,createPostgresTeachingOutboxStore,createDurableTeachingOutboxRuntime,createTransactionalTeachingMutation};
