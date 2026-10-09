'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {PRODUCTION_PROJECT_REF,assertNonProductionDatabase,integrationConfig,createIntegrationPool}
  =require('./test-db');

const {connectionString:url,projectRef:ref,skipReason:skip}=integrationConfig('D11');
test('D11 PPL event retention contracts are checked against the real integration schema',{skip},async()=>{
  assertNonProductionDatabase({connectionString:url,projectRef:ref});
  const pool=createIntegrationPool(url);
  try{
    const result=await pool.query(
      "select table_name,column_name,is_nullable from information_schema.columns where table_schema='teaching_runtime' and table_name in ('event_outbox','due_events') and column_name in ('next_attempt_at','status','resolution')");
    assert.equal(result.rows.filter(x=>x.column_name==='next_attempt_at').length,2);
    assert.ok(result.rows.filter(x=>x.column_name==='next_attempt_at').every(x=>x.is_nullable==='NO'));
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const ref='ppl-integration-'+randomUUID();
      const outboxId='ppl-test-outbox-'+randomUUID();
      const dueId='ppl-test-due-'+randomUUID();
      await client.query(`insert into teaching_runtime.event_outbox
        (event_id,schema_version,event_type,event_category,trigger_type,source,origin,occurred_at,
         idempotency_key,aggregate_type,aggregate_id,aggregate_version,payload,status)
         values($1,1,'teaching.preparation.input_changed','committed_domain_event',
         'committed_domain_event','test.d11.ppl','d11',now(),$1,'preparation_workspace',$2,1,'{}'::jsonb,'PENDING')`,
        [outboxId,ref]);
      await client.query(`insert into teaching_runtime.due_events
        (event_id,schema_version,event_type,event_category,trigger_type,source,origin,occurred_at,due_at,
         idempotency_key,aggregate_type,aggregate_id,aggregate_version,payload,status)
         values($1,1,'teaching.preparation.review_due','scheduled_due_event',
         'system_time','test.d11.ppl','d11',now(),now()+interval '1 hour',
         $1,'preparation_workspace',$2,1,$3::jsonb,'PENDING')`,
        [dueId,ref,JSON.stringify({preparation_workspace_id:ref})]);
      const cancelled=await client.query(`update teaching_runtime.event_outbox
        set status='CANCELLED',last_error_code='TEACHING_D11_BLUEPRINT_ALREADY_INHERITED',
          updated_at=now()
        where aggregate_id=$1 and event_type like 'teaching.preparation.%'
          and status in ('PENDING','RETRY_WAIT') returning status,next_attempt_at`,[ref]);
      assert.equal(cancelled.rows.length,1);
      assert.equal(cancelled.rows[0].status,'CANCELLED');
      assert.ok(cancelled.rows[0].next_attempt_at);
      const superseded=await client.query(`update teaching_runtime.due_events
        set status='SUPERSEDED',resolution='SUPERSEDED',
          recovery_reason='BLUEPRINT_INHERITED_REVALIDATED',
          claim_token=null,claimed_by=null,claimed_at=null,claim_expires_at=null,updated_at=now()
        where payload->>'preparation_workspace_id'=$1 and status in ('PENDING','RETRY_WAIT')
          and event_type='teaching.preparation.review_due'
        returning status,resolution,next_attempt_at`,[ref]);
      assert.equal(superseded.rows.length,1);
      assert.equal(superseded.rows[0].resolution,'SUPERSEDED');
      assert.ok(superseded.rows[0].next_attempt_at);
    }finally{
      await client.query('ROLLBACK');
      client.release();
    }
  }finally{await pool.end();}
});
