'use strict';

const express = require('express');

function orderedWalkthrough(liveClasses, progressRows) {
  const records = new Map((progressRows || []).map(row => [
    String(row.class_id) + ':' + Number(row.schedule_version), row
  ]));
  const items = (liveClasses || [])
    .filter(row => row?.class_id && row.lifecycle_state === 'SCHEDULED'
      && Number.isSafeInteger(Number(row.schedule_version))
      && Number(row.schedule_version) > 0)
    .slice()
    .sort((a, b) => Date.parse(a.scheduled_start_at) - Date.parse(b.scheduled_start_at)
      || String(a.class_id).localeCompare(String(b.class_id)))
    .map((row, index) => {
      const progress = records.get(String(row.class_id) + ':' + Number(row.schedule_version));
      return {
        step: index + 1,
        classId: String(row.class_id),
        scheduledStartAt: row.scheduled_start_at,
        scheduledEndAt: row.scheduled_end_at,
        scheduleVersion: Number(row.schedule_version),
        realCanEnter: row.can_enter === true,
        realSessionState: row.session_state || null,
        reviewState: progress?.review_state || 'NOT_STARTED',
        reviewedAt: progress?.reviewed_at || null
      };
    });
  const nextIndex = items.findIndex(item => item.reviewState !== 'REVIEWED');
  const current = nextIndex === -1 ? null : items[nextIndex];
  return {
    total: items.length,
    reviewedCount: items.filter(x => x.reviewState === 'REVIEWED').length,
    currentClassId: current?.classId || null,
    allReviewed: Boolean(items.length) && current === null,
    classes: items.map(item => ({...item,
      unlocked: item.reviewState === 'REVIEWED' || item.classId === current?.classId
    }))
  };
}

function createAdminClassroomWalkthroughRouter({
  query, withTransaction, classroomService, env = process.env
} = {}) {
  if (typeof query !== 'function'
      || typeof withTransaction !== 'function'
      || typeof classroomService?.listClasses !== 'function')
    throw new TypeError('Admin walkthrough requires KIWI D14, query and transactions.');
  const router = express.Router();

  async function listLive(user) {
    const courseId = String(env.KIWI_CLASSROOM_TEST_SOURCE_COURSE_ID || '').trim();
    if (!courseId) throw Object.assign(new Error('No linked Course.'), {status:503,code:'WALKTHROUGH_SOURCE_UNAVAILABLE'});
    const {rows=[]} = await query(
      "select course_id from public.teaching_courses where course_id=$1 and student_id=$2 and lifecycle_state='ACTIVE' limit 1",
      [courseId,user.id]
    );
    if (!rows.length) throw Object.assign(new Error('Linked Course unavailable.'), {status:404,code:'WALKTHROUGH_SOURCE_UNAVAILABLE'});
    // This is the *real D14* Class source: it excludes cancelled and superseded
    // rows and returns the same time authority used by normal Classroom.
    const live = await classroomService.listClasses(user,courseId);
    return {courseId,liveClasses:live.classes || []};
  }

  async function progressRows(runner, userId, courseId) {
    const {rows=[]} = await runner(
      'select class_id,schedule_version,review_state,reviewed_at from teaching_runtime.admin_classroom_walkthroughs where admin_id=$1 and course_id=$2',
      [userId,courseId]);
    return rows;
  }
  function reportError(res,error) {
    if(error.code === '42P01' || error.code === '3F000')
      return res.status(503).json({code:'WALKTHROUGH_SCHEMA_UNAVAILABLE'});
    return res.status(error.status || 503).json({
      code:error.code && /^WALKTHROUGH_/.test(error.code) ? error.code : 'WALKTHROUGH_UNAVAILABLE'
    });
  }

  router.get('/', async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    try {
      const {courseId,liveClasses}=await listLive(req.user);
      const progress=await progressRows(query,req.user.id,courseId);
      return res.json({courseId,...orderedWalkthrough(liveClasses,progress)});
    } catch(error) {return reportError(res,error);}
  });

  async function mutate(req,res,action) {
    res.setHeader('Cache-Control','no-store');
    const classId = String(req.params.classId || '').trim();
    if(!/^[a-zA-Z0-9_-]{1,100}$/.test(classId))
      return res.status(400).json({code:'WALKTHROUGH_CLASS_ID_INVALID'});
    try {
      const {courseId,liveClasses}=await listLive(req.user);
      // Re-check review order under a per-account/course transaction lock.
      const result = await withTransaction(async tx => {
        await tx.query('select pg_advisory_xact_lock(hashtext($1),hashtext($2))',[req.user.id,courseId]);
        const progress=await progressRows(tx.query.bind(tx),req.user.id,courseId);
        const current=orderedWalkthrough(liveClasses,progress);
        const item=current.classes.find(x=>x.classId===classId);
        if(!item) return {error:'WALKTHROUGH_CLASS_NOT_FOUND',status:404};
        if(item.classId !== current.currentClassId)
          return {error:'WALKTHROUGH_CLASS_OUT_OF_ORDER',status:409};
        if(action==='complete' && item.reviewState!=='IN_PROGRESS')
          return {error:'WALKTHROUGH_START_REQUIRED',status:409};
        const target=await tx.query(
          "select class_id from public.teaching_classes where student_id=$1 and course_id=$2 and class_id=$3 and lifecycle_state='SCHEDULED' and schedule_version=$4",
          [req.user.id,courseId,item.classId,item.scheduleVersion]);
        if(!target.rows?.length) return {error:'WALKTHROUGH_SCHEDULE_CHANGED',status:409};
        if(action==='start') {
          await tx.query(`insert into teaching_runtime.admin_classroom_walkthroughs
            (admin_id,course_id,class_id,schedule_version,review_state,opened_at,updated_at)
            values($1,$2,$3,$4,'IN_PROGRESS',now(),now())
            on conflict(admin_id,course_id,class_id,schedule_version)
            do update set updated_at=now()
            where teaching_runtime.admin_classroom_walkthroughs.review_state='IN_PROGRESS'`,
            [req.user.id,courseId,item.classId,item.scheduleVersion]);
        } else {
          await tx.query(`update teaching_runtime.admin_classroom_walkthroughs
            set review_state='REVIEWED',reviewed_at=now(),updated_at=now()
            where admin_id=$1 and course_id=$2 and class_id=$3
              and schedule_version=$4 and review_state='IN_PROGRESS'`,
            [req.user.id,courseId,item.classId,item.scheduleVersion]);
        }
        const changed=await progressRows(tx.query.bind(tx),req.user.id,courseId);
        return {courseId,...orderedWalkthrough(liveClasses,changed)};
      });
      if(result.error) return res.status(result.status).json({code:result.error});
      return res.json(result);
    }catch(error){return reportError(res,error);}
  }
  router.post('/:classId/start',(req,res)=>mutate(req,res,'start'));
  router.post('/:classId/complete',(req,res)=>mutate(req,res,'complete'));

  router.post('/reset', async (req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(req.body?.confirm !== true) return res.status(400).json({code:'WALKTHROUGH_RESET_CONFIRMATION_REQUIRED'});
    try {
      const {courseId}=await listLive(req.user);
      await withTransaction(async tx=>{
        await tx.query('select pg_advisory_xact_lock(hashtext($1),hashtext($2))',[req.user.id,courseId]);
        await tx.query('delete from teaching_runtime.admin_classroom_walkthroughs where admin_id=$1 and course_id=$2',[req.user.id,courseId]);
      });
      return res.json({reset:true,courseId});
    }catch(error){return reportError(res,error);}
  });
  return router;
}

module.exports = {orderedWalkthrough,createAdminClassroomWalkthroughRouter};
