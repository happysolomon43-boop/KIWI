'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
  fingerprint, matchesKey, sandboxConfiguration, sandboxSurfaceGate, testInstanceGate,
  createAttestationHandler, createAdminClassroomTestRouter,
} = require('../../../teaching/admin-classroom-test');

const PROD_DB='postgresql://postgres.prod-project:p@prod.db.example:5432/postgres';
const SANDBOX_DB='postgresql://postgres.sandbox-project:p@sandbox.db.example:5432/postgres';
const ORIGIN='https://kiwi-classroom-sandbox.example';
const KEY='sandbox-shared-secret-with-sufficient-entropy';
const ENV={
  DATABASE_URL:PROD_DB,
  KIWI_CLASSROOM_TEST_ORIGIN:ORIGIN,
  KIWI_CLASSROOM_TEST_SHARED_KEY:KEY,
  KIWI_CLASSROOM_TEST_USER_ID:'test-user-only',
  KIWI_PUBLIC_ORIGIN:'https://kiwi.example',
};

async function serve(router, principal='admin') {
  const app=express();
  app.use(express.json());
  app.use((req,_res,next)=>{req.user={id:principal,role:principal};next();});
  app.use('/api/teaching/admin/classroom-test',router);
  const server=await new Promise(resolve=>{
    const running=app.listen(0,'127.0.0.1',()=>resolve(running));
  });
  const base='http://127.0.0.1:'+server.address().port+'/api/teaching/admin/classroom-test';
  return {base,close:()=>new Promise(resolve=>server.close(resolve))};
}
function sandboxFetch({remoteFingerprint=fingerprint(SANDBOX_DB),calls=[]}={}) {
  return async (url,opts)=>{
    calls.push({url,method:opts?.method||'GET',headers:opts?.headers,body:opts?.body});
    assert.equal(opts.headers['x-kiwi-classroom-test-key'],KEY);
    assert.equal(opts.headers.Authorization,undefined);
    if(url===ORIGIN+'/api/teaching/internal/classroom-test/attest') {
      return Response.json({kind:'KIWI_CLASSROOM_TEST_INSTANCE_V1',
        databaseFingerprint:remoteFingerprint,engine:'KIWI_D11_D14',
        ownerReady:true,activeCourseCount:1,upcomingClassCount:2});
    }
    if(url===ORIGIN+'/api/teaching/courses')
      return Response.json([{course_id:'course-1',title:'PHY101'}]);
    if(url===ORIGIN+'/api/teaching/classes/class-1/classroom')
      return Response.json({class:{classId:'class-1'},modeKey:'INSTRUCTION'});
    if(url===ORIGIN+'/api/teaching/classes/class-1/interactions')
      return Response.json({kind:'NEED_HELP',status:'HELP_RAISED'},{status:201});
    return Response.json({error:'bad upstream'},{status:500});
  };
}

test('Sandbox attestation requires a separate database identity and a server-only key', async()=>{
  assert.ok(fingerprint(PROD_DB));
  assert.notEqual(fingerprint(PROD_DB),fingerprint(SANDBOX_DB));
  assert.equal(fingerprint('bad-uri'),null);
  assert.equal(matchesKey(KEY,KEY),true);
  assert.equal(matchesKey(KEY+'x',KEY),false);
  assert.equal(matchesKey(undefined,KEY),false);
  assert.equal(sandboxConfiguration({...ENV,KIWI_CLASSROOM_TEST_ORIGIN:'http://internal.local/'}),null);
  assert.equal(sandboxConfiguration({...ENV,KIWI_CLASSROOM_TEST_ORIGIN:'https://kiwi.example/'}),null);
  assert.equal(sandboxConfiguration(ENV),ORIGIN);
});

test('Non-admins cannot reach test status, Class snapshots or write actions',async()=>{
  let called=false;
  const router=createAdminClassroomTestRouter({
    env:ENV,query:async()=>({rows:[{role:'user'}]}),
    fetchImpl:async()=>{called=true;throw Error('must not reach sandbox');},
  });
  const site=await serve(router,'user');
  try {
    for(const [method,path] of [['GET','/status'],['GET','/courses'],['POST','/classes/class-1/interactions']]){
      const response=await fetch(site.base+path,{method,...(method==='POST'?{headers:{'Content-Type':'application/json'},body:'{}'}:{})});
      assert.equal(response.status,403);
      assert.equal((await response.json()).code,'CLASSROOM_TEST_ADMIN_REQUIRED');
    }
    assert.equal(called,false);
  }finally{await site.close();}
});

test('Gateway fails closed when the test instance attests to production database',async()=>{
  const calls=[];
  const site=await serve(createAdminClassroomTestRouter({
    env:ENV,query:async()=>({rows:[{role:'admin'}]}),
    fetchImpl:sandboxFetch({remoteFingerprint:fingerprint(PROD_DB),calls}),
  }));
  try{
    const status=await fetch(site.base+'/status');
    assert.equal(status.status,503);
    assert.equal((await status.json()).code,'CLASSROOM_TEST_ISOLATION_UNVERIFIED');
    const list=await fetch(site.base+'/courses');
    assert.equal(list.status,503);
    assert.equal(calls.every(c=>c.url.endsWith('/attest')),true);
  }finally{await site.close();}
});

test('Admin proxy exercises original Class endpoints with no fake responses or forwarded browser identity',async()=>{
  const calls=[];
  const site=await serve(createAdminClassroomTestRouter({
    env:ENV,query:async()=>({rows:[{role:'admin'}]}),
    fetchImpl:sandboxFetch({calls}),
  }));
  try{
    const access=await fetch(site.base+'/access');
    assert.equal(access.status,200);
    assert.equal((await access.json()).admin,true);
    const status=await fetch(site.base+'/status');
    assert.equal(status.status,200);
    assert.equal((await status.json()).realEngine,true);
    const courses=await fetch(site.base+'/courses');
    assert.deepEqual(await courses.json(),[{course_id:'course-1',title:'PHY101'}]);
    const snap=await fetch(site.base+'/classes/class-1/classroom');
    assert.equal((await snap.json()).modeKey,'INSTRUCTION');
    const action=await fetch(site.base+'/classes/class-1/interactions',{
      method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer browser-token'},
      body:JSON.stringify({kind:'NEED_HELP',body:'Why?',idempotencyKey:'abc'}),
    });
    assert.equal(action.status,201);
    assert.equal((await action.json()).status,'HELP_RAISED');
    const unsafe=await fetch(site.base+'/courses/course-1/timetable',{method:'POST'});
    assert.equal(unsafe.status,404);
    const write=calls.find(c=>c.url.endsWith('/interactions'));
    assert.equal(write.headers.Authorization,undefined);
    assert.match(write.body,/"NEED_HELP"/);
    assert.equal(calls.some(c=>c.url.includes('timetable')),false);
  }finally{await site.close();}
});

test('Standalone sandbox denies missing key and attestation uses DB-owned real records',async()=>{
  const env={...ENV,DATABASE_URL:SANDBOX_DB,KIWI_CLASSROOM_TEST_INSTANCE:'true'};
  const gate=testInstanceGate(env);
  const blocked={headers:{},path:'/courses'};
  let blockedStatus=null;
  gate(blocked,{status(n){blockedStatus=n;return this;},json(){}},()=>{throw Error('must not pass');});
  assert.equal(blockedStatus,404);
  let passed=false;
  gate({headers:{'x-kiwi-classroom-test-key':KEY}},{},()=>{passed=true;});
  assert.equal(passed,true);
  const attest=createAttestationHandler({env,query:async sql=>{
    if(sql.includes('from public.users'))return {rows:[{id:'test-user-only'}]};
    if(sql.includes('teaching_classes'))return {rows:[{n:2}]};
    return {rows:[{n:1}]};
  }});
  let payload=null;
  const res={setHeader(){},json(v){payload=v;return this;},status(n){this.statusCode=n;return this;}};
  await attest({headers:{'x-kiwi-classroom-test-key':KEY}},res);
  assert.equal(payload.engine,'KIWI_D11_D14');
  assert.equal(payload.upcomingClassCount,2);
  assert.equal(payload.databaseFingerprint,fingerprint(SANDBOX_DB));
});


test('Sandbox server exposes only keyed real Classroom paths and never the wider KIWI API or static UI',()=>{
  const env={...ENV,KIWI_CLASSROOM_TEST_INSTANCE:'true',DATABASE_URL:SANDBOX_DB};
  const gate=sandboxSurfaceGate(env);
  const invoke=(method,path,key=KEY)=>{
    let passed=false,status=null,output=null;
    const req={method,path,headers:key?{'x-kiwi-classroom-test-key':key}:{}};
    const res={setHeader(){},status(code){status=code;return this;},json(obj){output=obj;return this;}};
    gate(req,res,()=>{passed=true;});
    return {passed,status,output};
  };
  assert.equal(invoke('GET','/api/teaching/internal/classroom-test/attest').passed,true);
  assert.equal(invoke('GET','/api/teaching/classes/abc/classroom').passed,true);
  assert.equal(invoke('POST','/api/teaching/classes/abc/interactions').passed,true);
  assert.equal(invoke('GET','/api/teaching/courses',null).status,404);
  assert.equal(invoke('GET','/api/auth/me').status,404);
  assert.equal(invoke('GET','/teaching.html').status,404);
  assert.equal(invoke('POST','/api/teaching/courses').status,404);
  assert.equal(invoke('POST','/api/teaching/classes/abc/responses').status,404);
});


test('An admin can link only their own ACTIVE production course as read-only Classroom source',async()=>{
  const queries=[];
  const router=createAdminClassroomTestRouter({
    env:{...ENV,KIWI_CLASSROOM_TEST_SOURCE_COURSE_ID:'phy101-live-id'},
    query:async(sql,args)=>{
      queries.push({sql,args});
      if(sql.includes('select role from public.users'))return {rows:[{role:'admin'}]};
      if(sql.includes('from public.teaching_courses c'))return {rows:[{
        course_id:'phy101-live-id',title:'PHY101',subject_name:'PHY101',lifecycle_state:'ACTIVE',
        state_version:5,scheduled_class_count:20,plan_count:1
      }]};
      throw new Error('Unexpected query');
    },
    fetchImpl:async()=>{throw Error('Source lookup must never forward to sandbox');},
  });
  const site=await serve(router);
  try{
    const result=await fetch(site.base+'/source-course');
    assert.equal(result.status,200);
    const body=await result.json();
    assert.equal(body.linked,true);
    assert.equal(body.course.title,'PHY101');
    assert.equal(body.course.planCount,1);
    assert.equal(body.execution,'NORMAL_KIWI_CLASSROOM');
    const source=queries.find(x=>x.sql.includes('from public.teaching_courses c'));
    assert.deepEqual(source.args,['phy101-live-id','admin']);
    assert.match(source.sql,/c\.student_id=\$2/);
    assert.match(source.sql,/c\.lifecycle_state='ACTIVE'/);
    assert.equal(queries.every(x=>/^\s*select/i.test(x.sql)),true);
  }finally{await site.close();}
});

test('Unconfigured or non-owner course selection cannot activate a rehearsal',async()=>{
  const missing=createAdminClassroomTestRouter({
    env:{...ENV,KIWI_CLASSROOM_TEST_SOURCE_COURSE_ID:''},
    query:async()=>({rows:[{role:'admin'}]}),
    fetchImpl:async()=>{throw Error('No proxy permitted');},
  });
  const s1=await serve(missing);
  try{
    const response=await fetch(s1.base+'/source-course');
    assert.equal(response.status,503);
    assert.equal((await response.json()).code,'CLASSROOM_TEST_SOURCE_NOT_CONFIGURED');
  }finally{await s1.close();}
  const foreign=createAdminClassroomTestRouter({
    env:{...ENV,KIWI_CLASSROOM_TEST_SOURCE_COURSE_ID:'foreign-course'},
    query:async(sql)=>sql.includes('from public.teaching_courses c')?{rows:[]}:{rows:[{role:'admin'}]},
    fetchImpl:async()=>{throw Error('No proxy permitted');},
  });
  const s2=await serve(foreign);
  try{
    const response=await fetch(s2.base+'/source-course');
    assert.equal(response.status,404);
    assert.equal((await response.json()).code,'CLASSROOM_TEST_SOURCE_NOT_FOUND');
  }finally{await s2.close();}
});
