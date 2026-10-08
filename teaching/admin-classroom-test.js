'use strict';

const express = require('express');
const crypto = require('node:crypto');

const ATTEST_PATH = '/api/teaching/internal/classroom-test/attest';
const KEY_HEADER = 'x-kiwi-classroom-test-key';
const MAX_INPUT_BYTES = 128 * 1024;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const ID = '[A-Za-z0-9_-]{1,100}';

const ALLOWED = Object.freeze([
  ['GET', /^\/courses$/],
  ['GET', new RegExp('^/courses/' + ID + '/classes$')],
  ['GET', new RegExp('^/classes/' + ID + '/classroom$')],
  ['GET', new RegExp('^/classes/' + ID + '/classroom/assets/' + ID + '$')],
  ['GET', new RegExp('^/classes/' + ID + '/controller$')],
  ['GET', new RegExp('^/classes/' + ID + '/summary$')],
  ['POST', new RegExp('^/classes/' + ID + '/classroom/enter$')],
  ['POST', new RegExp('^/classes/' + ID + '/notebook$')],
  ['POST', new RegExp('^/classes/' + ID + '/interactions$')],
  ['POST', new RegExp('^/classes/' + ID + '/classroom/responses$')],
  ['POST', new RegExp('^/classes/' + ID + '/lesson-blueprint/prepare$')],
  ['POST', new RegExp('^/classes/' + ID + '/controller/(start|transition|cycle/advance|evidence-descriptor|progress|break|overtime|replan|close)$')],
]);

function fingerprint(connectionString) {
  if (!connectionString) return null;
  try {
    const value = new URL(connectionString);
    if (!['postgres:', 'postgresql:'].includes(value.protocol) || !value.hostname || !value.username) return null;
    return crypto.createHash('sha256').update([value.hostname.toLowerCase(), value.port || '5432', value.pathname, decodeURIComponent(value.username)].join('|')).digest('hex');
  } catch (_) { return null; }
}
function matchesKey(provided, configured) {
  if (typeof provided !== 'string' || !configured || typeof configured !== 'string') return false;
  const lhs = Buffer.from(provided), rhs = Buffer.from(configured);
  return lhs.length === rhs.length && crypto.timingSafeEqual(lhs, rhs);
}
function sandboxSurfaceGate(env = process.env) {
  return function blockNonClassroomSandboxRoutes(req,res,next) {
    if(env.KIWI_CLASSROOM_TEST_INSTANCE!=='true')return next();
    res.setHeader('Cache-Control','no-store');
    const path=req.path||'';
    const attest=path==='/api/teaching/internal/classroom-test/attest'&&req.method==='GET';
    const classroom=path.startsWith('/api/teaching')
      && ALLOWED.some(([method,pattern])=>method===req.method&&pattern.test(path.slice('/api/teaching'.length)));
    if(!(attest||classroom) || !matchesKey(req.headers[KEY_HEADER],env.KIWI_CLASSROOM_TEST_SHARED_KEY))
      return res.status(404).json({code:'CLASSROOM_TEST_NOT_FOUND'});
    next();
  };
}
function testInstanceGate(env = process.env) {
  return function classroomTestInstanceGate(req, res, next) {
    if (env.KIWI_CLASSROOM_TEST_INSTANCE !== 'true') return next();
    if (!matchesKey(req.headers[KEY_HEADER], env.KIWI_CLASSROOM_TEST_SHARED_KEY)) {
      return res.status(404).json({ code:'CLASSROOM_TEST_NOT_FOUND' });
    }
    next();
  };
}
function createAttestationHandler({env=process.env,query}={}) {
  return async (req, res) => {
    if (env.KIWI_CLASSROOM_TEST_INSTANCE !== 'true'
      || !matchesKey(req.headers[KEY_HEADER], env.KIWI_CLASSROOM_TEST_SHARED_KEY)) {
      return res.status(404).json({ code:'CLASSROOM_TEST_NOT_FOUND' });
    }
    const databaseFingerprint = fingerprint(env.DATABASE_URL);
    if (!databaseFingerprint || !env.KIWI_CLASSROOM_TEST_USER_ID || typeof query !== 'function') {
      return res.status(503).json({ code:'CLASSROOM_TEST_INSTANCE_NOT_READY' });
    }
    try {
      const [owner, courses, classes] = await Promise.all([
        query('select id from public.users where id=$1 limit 1', [env.KIWI_CLASSROOM_TEST_USER_ID]),
        query("select count(*)::int as n from public.teaching_courses where student_id=$1 and lifecycle_state='ACTIVE'", [env.KIWI_CLASSROOM_TEST_USER_ID]),
        query("select count(*)::int as n from public.teaching_classes where student_id=$1 and lifecycle_state='SCHEDULED' and scheduled_end_at>now()", [env.KIWI_CLASSROOM_TEST_USER_ID]),
      ]);
      res.setHeader('Cache-Control','no-store');
      return res.json({
        kind:'KIWI_CLASSROOM_TEST_INSTANCE_V1', databaseFingerprint,
        engine:'KIWI_D11_D14', ownerReady:Boolean(owner.rows?.[0]),
        activeCourseCount:Number(courses.rows?.[0]?.n || 0),
        upcomingClassCount:Number(classes.rows?.[0]?.n || 0),
      });
    } catch (_) {
      return res.status(503).json({code:'CLASSROOM_TEST_DATABASE_UNAVAILABLE'});
    }
  };
}
function sandboxConfiguration(env) {
  const origin=env.KIWI_CLASSROOM_TEST_ORIGIN, key=env.KIWI_CLASSROOM_TEST_SHARED_KEY;
  if (!origin || !key || !fingerprint(env.DATABASE_URL)) return null;
  try {
    const target = new URL(origin);
    if (target.protocol !== 'https:' || target.username || target.password || target.pathname !== '/'
      || target.search || target.hash || target.hostname === 'localhost'
      || target.hostname === '127.0.0.1') return null;
    if (env.KIWI_PUBLIC_ORIGIN && new URL(env.KIWI_PUBLIC_ORIGIN).origin === target.origin) return null;
    return target.origin;
  } catch (_) { return null; }
}
function createAdminClassroomTestRouter({query,env=process.env,fetchImpl=globalThis.fetch}={}) {
  if(typeof query!=='function'||typeof fetchImpl!=='function') throw new TypeError('Admin Classroom test requires query and fetch.');
  const router=express.Router();
  router.use(async (req,res,next)=>{
    if (!req.user?.id) return res.status(401).json({code:'CLASSROOM_TEST_SIGN_IN_REQUIRED'});
    try {
      // A JWT role or a master-token header is not sufficient: verify the live DB account.
      const result=await query('select role from public.users where id=$1 limit 1',[req.user.id]);
      if (result.rows?.[0]?.role!=='admin') return res.status(403).json({code:'CLASSROOM_TEST_ADMIN_REQUIRED'});
    } catch (_) {return res.status(503).json({code:'CLASSROOM_TEST_AUTH_UNAVAILABLE'});}
    next();
  });
  // Read-only binding to the administrator's existing, ACTIVE KIWI course.
  // Selecting a source is NOT permission to create a session on the production
  // course. Classroom execution remains behind independent database attestation.
  router.get('/source-course',async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    const sourceCourseId=String(env.KIWI_CLASSROOM_TEST_SOURCE_COURSE_ID||'').trim();
    if(!sourceCourseId)return res.status(503).json({code:'CLASSROOM_TEST_SOURCE_NOT_CONFIGURED'});
    try{
      const {rows=[]}=await query(`
        select c.course_id,c.title,c.lifecycle_state,c.state_version,
          coalesce(s.name,c.title) as subject_name,
          (select count(*)::int from public.teaching_classes cls
            where cls.student_id=c.student_id and cls.course_id=c.course_id and cls.lifecycle_state='SCHEDULED') as scheduled_class_count,
          (select count(*)::int from public.teaching_course_plans p
            where p.student_id=c.student_id and p.course_id=c.course_id) as plan_count
        from public.teaching_courses c
        left join public.subjects s on s.id=c.subject_id and s.user_id=c.student_id
        where c.course_id=$1 and c.student_id=$2 and c.lifecycle_state='ACTIVE'
        limit 1
      `,[sourceCourseId,req.user.id]);
      if(!rows[0])return res.status(404).json({code:'CLASSROOM_TEST_SOURCE_NOT_FOUND'});
      const course=rows[0];
      return res.json({linked:true,course:{
        courseId:course.course_id,
        title:course.title,
        subjectName:course.subject_name,
        lifecycleState:course.lifecycle_state,
        stateVersion:Number(course.state_version),
        scheduledClassCount:Number(course.scheduled_class_count),
        planCount:Number(course.plan_count)
      },execution:'NORMAL_KIWI_CLASSROOM'});
    }catch(_){return res.status(503).json({code:'CLASSROOM_TEST_SOURCE_UNAVAILABLE'});}
  });
  router.get('/access',(_req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.json({admin:true,feature:'classroom-test',isolationRequired:true});
  });
  async function attest() {
    const origin=sandboxConfiguration(env);
    if(!origin) return {error:'CLASSROOM_TEST_NOT_CONFIGURED',status:503};
    const response=await fetchImpl(origin+ATTEST_PATH,{
      headers:{[KEY_HEADER]:env.KIWI_CLASSROOM_TEST_SHARED_KEY,Accept:'application/json'},
      redirect:'error',signal:AbortSignal.timeout(10000),
    });
    if(!response.ok) return {error:'CLASSROOM_TEST_SANDBOX_UNAVAILABLE',status:503};
    const remote=await response.json();
    if(remote.kind!=='KIWI_CLASSROOM_TEST_INSTANCE_V1'
       || !/^[a-f0-9]{64}$/.test(remote.databaseFingerprint||'')
       || remote.databaseFingerprint===fingerprint(env.DATABASE_URL)
       || remote.engine!=='KIWI_D11_D14') {
      return {error:'CLASSROOM_TEST_ISOLATION_UNVERIFIED',status:503};
    }
    return {origin,remote};
  }
  router.get('/status',async (_req,res)=>{
    res.setHeader('Cache-Control','no-store');
    try {
      const a=await attest();
      if(a.error)return res.status(a.status).json({ready:false,code:a.error});
      return res.json({ready:a.remote.ownerReady===true,
        code:a.remote.ownerReady?'READY':'CLASSROOM_TEST_USER_NOT_PROVISIONED',
        isolated:true,realEngine:true,activeCourseCount:a.remote.activeCourseCount,
        upcomingClassCount:a.remote.upcomingClassCount});
    }catch(_){return res.status(503).json({ready:false,code:'CLASSROOM_TEST_SANDBOX_UNAVAILABLE'});}
  });
  router.use(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    const path=req.path;
    if(!ALLOWED.some(([method,pattern])=>method===req.method&&pattern.test(path)))
      return res.status(404).json({code:'CLASSROOM_TEST_ROUTE_UNAVAILABLE'});
    const asset=/^\/classes\/[^/]+\/classroom\/assets\/[^/]+$/.test(path);
    if(req.method!=='GET' && Buffer.byteLength(JSON.stringify(req.body||{}))>MAX_INPUT_BYTES)
      return res.status(413).json({code:'CLASSROOM_TEST_INPUT_TOO_LARGE'});
    try {
      const a=await attest();
      if(a.error) return res.status(a.status).json({code:a.error});
      if(a.remote.ownerReady!==true) return res.status(503).json({code:'CLASSROOM_TEST_USER_NOT_PROVISIONED'});
      const target=a.origin+'/api/teaching'+path;
      const response=await fetchImpl(target,{
        method:req.method,redirect:'error',signal:AbortSignal.timeout(/\/lesson-blueprint\/prepare$|\/controller\/replan$/.test(path)?12*60*1000:3*60*1000),
        headers:{[KEY_HEADER]:env.KIWI_CLASSROOM_TEST_SHARED_KEY,
          Accept:asset?'image/png,image/jpeg,image/svg+xml':'application/json',
          ...(req.method==='GET'?{}:{'Content-Type':'application/json'})},
        ...(req.method==='GET'?{}:{body:JSON.stringify(req.body||{})}),
      });
      const length=Number(response.headers.get('content-length')||0);
      if(length>(asset?MAX_ASSET_BYTES:MAX_JSON_BYTES))return res.status(502).json({code:'CLASSROOM_TEST_UPSTREAM_TOO_LARGE'});
      const buffer=Buffer.from(await response.arrayBuffer());
      if(buffer.length>(asset?MAX_ASSET_BYTES:MAX_JSON_BYTES))return res.status(502).json({code:'CLASSROOM_TEST_UPSTREAM_TOO_LARGE'});
      if(asset){
        const mime=(response.headers.get('content-type')||'').split(';')[0].trim();
        if(!response.ok || !['image/png','image/jpeg','image/svg+xml'].includes(mime))
          return res.status(502).json({code:'CLASSROOM_TEST_ASSET_UNAVAILABLE'});
        res.setHeader('X-Content-Type-Options','nosniff');
        res.type(mime);
        return res.status(200).send(buffer);
      }
      const mime=(response.headers.get('content-type')||'').split(';')[0].trim();
      if(mime!=='application/json')return res.status(502).json({code:'CLASSROOM_TEST_NON_JSON_RESPONSE'});
      res.type('application/json');
      return res.status(response.status>=200&&response.status<=599?response.status:502).send(buffer);
    }catch(_) {return res.status(503).json({code:'CLASSROOM_TEST_SANDBOX_UNAVAILABLE'});}
  });
  return router;
}
module.exports={fingerprint,matchesKey,sandboxConfiguration,sandboxSurfaceGate,testInstanceGate,createAttestationHandler,createAdminClassroomTestRouter,ALLOWED};
