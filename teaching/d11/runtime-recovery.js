'use strict';

const {TEACHING_EVENTS}=require('../events/names');
const {EVENT_CATEGORIES}=require('../runtime/constants');

// This is an operational recovery fanout, not a second academic owner.
// It only schedules guarded D11 continuations. They re-read Course, Class,
// timetable and schedule authority under the existing transaction checks.
function createD11RuntimeRecovery({repository,outboxStore,clock=()=>new Date(),logger=console,
  batchSize=32,intervalMs=15*60*1000,timers={setInterval,clearInterval,queueMicrotask}}={}){
  if(typeof repository?.listMissingCurrentClasses!=='function'
    ||typeof outboxStore?.append!=='function')throw new TypeError('D11 durable runtime recovery dependencies unavailable.');
  let inProgress=false,timer=null;
  async function runOnce(){
    if(inProgress)return Object.freeze({skipped:true,reason:'RECOVERY_ALREADY_RUNNING'});
    inProgress=true;
    try{
      const now=clock();
      if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw new TypeError('D11 recovery requires authoritative current time.');
      const dayKey=now.toISOString().slice(0,10).replace(/-/g,'');
      const candidates=await repository.listMissingCurrentClasses({dayKey,limit:batchSize});
      let enqueued=0,failed=0;
      for(const row of candidates){
        const id='d11-class-runtime-audit:'+row.class_id
          +':schedule-v'+Number(row.schedule_version)+':'+dayKey;
        try{
          await outboxStore.append({
            eventId:id,schemaVersion:1,eventType:TEACHING_EVENTS.CLASS_PREPARATION_RECONCILE,
            eventCategory:EVENT_CATEGORIES.OPERATIONAL_RECOVERY_EVENT,
            triggerType:'workflow_continuation',source:'teaching.d11',origin:'d11',
            actorId:row.student_id,aggregateType:'CLASS',aggregateId:row.class_id,
            aggregateVersion:Number(row.schedule_version),
            occurredAt:now.toISOString(),effectiveAt:now.toISOString(),
            correlationId:id,causationId:null,idempotencyKey:id,
            payload:{
              class_id:row.class_id,course_id:row.course_id,
              timetable_version_id:row.source_timetable_version_id,
              schedule_version:Number(row.schedule_version),
              reason:'AUTHORITATIVE_RUNTIME_GAP_RECONCILIATION'
            },
            auditRefs:[],provenanceRefs:[
              'timetable:'+row.source_timetable_version_id,'class:'+row.class_id
            ]
          });
          enqueued++;
        }catch(error){
          failed++;
          logger.error?.('[KIWI Teaching D11] Class-runtime recovery enqueue failed:',error?.code||'D11_RECOVERY_ENQUEUE_FAILED');
        }
      }
      if(candidates.length||failed)logger.info?.('[KIWI Teaching D11] Current Class-runtime reconciliation:',{scanned:candidates.length,enqueued,failed});
      return Object.freeze({scanned:candidates.length,enqueued,failed});
    }finally{inProgress=false;}
  }
  function start(){
    if(timer)return false;
    const run=()=>{void runOnce().catch(error=>
      logger.error?.('[KIWI Teaching D11] Class-runtime recovery scan failed:',error?.code||'D11_RECOVERY_SCAN_FAILED')
    );};
    timer=timers.setInterval(run,Math.max(60000,Number(intervalMs)||900000));
    timer?.unref?.();
    timers.queueMicrotask(run);
    return true;
  }
  function stop(){
    if(!timer)return false;
    timers.clearInterval(timer);timer=null;return true;
  }
  return Object.freeze({runOnce,start,stop});
}
module.exports={createD11RuntimeRecovery};
