'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {orderedWalkthrough,createAdminClassroomWalkthroughRouter}=require('../../../teaching/admin-classroom-walkthrough');

const courseId='test-course-phy101';
const rows=[
  {class_id:'lesson-b',lifecycle_state:'SCHEDULED',schedule_version:26,scheduled_start_at:'2026-11-02T12:00:00Z',scheduled_end_at:'2026-11-02T13:00:00Z',can_enter:false},
  {class_id:'lesson-a',lifecycle_state:'SCHEDULED',schedule_version:26,scheduled_start_at:'2026-11-01T12:00:00Z',scheduled_end_at:'2026-11-01T13:00:00Z',can_enter:true},
  {class_id:'cancelled',lifecycle_state:'CANCELLED',schedule_version:26,scheduled_start_at:'2026-10-31T12:00:00Z',scheduled_end_at:'2026-10-31T13:00:00Z'}
];

test('Progress follows canonical scheduled KIWI D14 classes and resets on schedule version change',()=>{
  const initial=orderedWalkthrough(rows,[]);
  assert.deepEqual(initial.classes.map(c=>c.classId),['lesson-a','lesson-b']);
  assert.equal(initial.currentClassId,'lesson-a');
  assert.equal(initial.classes[1].unlocked,false);
  const advanced=orderedWalkthrough(rows,[{class_id:'lesson-a',schedule_version:26,review_state:'REVIEWED',reviewed_at:'2026-11-01T13:00:00Z'}]);
  assert.equal(advanced.currentClassId,'lesson-b');
  assert.equal(advanced.reviewedCount,1);
  assert.equal(advanced.classes[0].unlocked,true);
  assert.equal(orderedWalkthrough([{...rows[1],schedule_version:27}],advanced.classes).reviewedCount,0);
  const final=orderedWalkthrough(rows,[
    {class_id:'lesson-a',schedule_version:26,review_state:'REVIEWED',reviewed_at:'2026-11-01T13:00:00Z'},
    {class_id:'lesson-b',schedule_version:26,review_state:'REVIEWED',reviewed_at:'2026-11-02T13:00:00Z'}
  ]);
  assert.equal(final.allReviewed,true);
  assert.equal(final.currentClassId,null);
});

function fakePersistence(){
  const progress=new Map();
  const executed=[];
  function query(sql,params){
    executed.push(sql);
    if(sql.includes('select course_id from public.teaching_courses'))return Promise.resolve({rows:[{course_id:courseId}]});
    if(sql.includes('select class_id,schedule_version,review_state,reviewed_at'))return Promise.resolve({rows:[...progress.values()]});
    if(sql.includes('select pg_advisory_xact_lock'))return Promise.resolve({rows:[]});
    if(sql.includes('select class_id from public.teaching_classes'))return Promise.resolve({rows:[{class_id:params[2]}]});
    if(sql.includes('insert into teaching_runtime.admin_classroom_walkthroughs')){
      const key=params[2]+':'+params[3],current=progress.get(key);
      if(!current)progress.set(key,{class_id:params[2],schedule_version:params[3],review_state:'IN_PROGRESS',reviewed_at:null});
      return Promise.resolve({rows:[]});
    }
    if(sql.includes('update teaching_runtime.admin_classroom_walkthroughs')){
      const key=params[2]+':'+params[3],current=progress.get(key);
      if(current&&current.review_state==='IN_PROGRESS')progress.set(key,{...current,review_state:'REVIEWED',reviewed_at:'2026-11-01T13:00:00Z'});
      return Promise.resolve({rows:[]});
    }
    if(sql.includes('delete from teaching_runtime.admin_classroom_walkthroughs')){
      progress.clear();return Promise.resolve({rows:[]});
    }
    throw Error('Unexpected SQL: '+sql);
  }
  return {query,withTransaction:async fn=>fn({query}),progress,executed};
}
async function serve(router){
  const app=express();
  app.use(express.json());
  app.use((req,_res,next)=>{req.user={id:'admin-1',role:'admin'};next();});
  app.use('/walkthrough',router);
  const server=await new Promise(resolve=>{const listening=app.listen(0,'127.0.0.1',()=>resolve(listening));});
  return {
    url:'http://127.0.0.1:'+server.address().port+'/walkthrough',
    close:()=>new Promise(resolve=>server.close(resolve))
  };
}
test('Admin can join read-only review, complete sequentially and reset without academic writes',async()=>{
  const db=fakePersistence();
  const calls=[];
  const router=createAdminClassroomWalkthroughRouter({
    ...db,
    env:{KIWI_CLASSROOM_TEST_SOURCE_COURSE_ID:courseId},
    classroomService:{listClasses:async(user,id)=>{
      calls.push({user,id});return {classes:rows};
    }}
  });
  const app=await serve(router);
  const post=(path,body={})=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try{
    let initial=await (await fetch(app.url)).json();
    assert.equal(initial.total,2);
    assert.equal(initial.currentClassId,'lesson-a');
    let blocked=await post('/lesson-b/start');
    assert.equal(blocked.status,409);
    assert.equal((await blocked.json()).code,'WALKTHROUGH_CLASS_OUT_OF_ORDER');
    blocked=await post('/lesson-a/complete');
    assert.equal(blocked.status,409);
    assert.equal((await blocked.json()).code,'WALKTHROUGH_START_REQUIRED');
    const started=await (await post('/lesson-a/start')).json();
    assert.equal(started.classes[0].reviewState,'IN_PROGRESS');
    const again=await (await post('/lesson-a/start')).json();
    assert.equal(again.classes[0].reviewState,'IN_PROGRESS');
    const completed=await (await post('/lesson-a/complete')).json();
    assert.equal(completed.reviewedCount,1);
    assert.equal(completed.currentClassId,'lesson-b');
    await post('/lesson-b/start');
    const end=await (await post('/lesson-b/complete')).json();
    assert.equal(end.allReviewed,true);
    blocked=await post('/lesson-a/start');
    assert.equal(blocked.status,409);
    assert.equal((await blocked.json()).code,'WALKTHROUGH_CLASS_OUT_OF_ORDER');
    const resetDenied=await post('/reset');
    assert.equal(resetDenied.status,400);
    const reset=await (await post('/reset',{confirm:true})).json();
    assert.equal(reset.reset,true);
    const fresh=await (await fetch(app.url)).json();
    assert.equal(fresh.reviewedCount,0);
    assert.equal(fresh.currentClassId,'lesson-a');
    assert.ok(calls.every(c=>c.user.id==='admin-1'&&c.id===courseId));
    assert.equal(db.executed.some(sql=>/\b(insert|update|delete)\s+(?:into\s+|from\s+)?(?:public\.teaching_classes|public\.teaching_class_sessions|public\.teaching_attendance_records|public\.teaching_class_summaries)/i.test(sql)),false);
    assert.ok(db.executed.some(sql=>sql.includes('pg_advisory_xact_lock')));
  }finally{await app.close();}
});

test('Owner verification fails closed before D14 classes are read',async()=>{
  const db=fakePersistence();
  const query=async(sql,params)=>sql.includes('select course_id from public.teaching_courses')?{rows:[]}:db.query(sql,params);
  let called=false;
  const router=createAdminClassroomWalkthroughRouter({
    query,withTransaction:db.withTransaction,
    env:{KIWI_CLASSROOM_TEST_SOURCE_COURSE_ID:courseId},
    classroomService:{listClasses:async()=>{called=true;return {classes:rows};}}
  });
  const app=await serve(router);
  try{
    const response=await fetch(app.url);
    assert.equal(response.status,404);
    assert.equal((await response.json()).code,'WALKTHROUGH_SOURCE_UNAVAILABLE');
    assert.equal(called,false);
  }finally{await app.close();}
});
