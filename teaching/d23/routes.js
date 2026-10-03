'use strict';

const {createD23Service}=require('./service');
const ui=require('./ui');

function mountD23Routes(router,{foundation,sendError,d19Service,d20Service,d21Service,d22Service}={}){
  const deps={d07:foundation?.d07?.service,d08:foundation?.d08?.service,d09:foundation?.d09?.service,d10:foundation?.d10?.service,d14:foundation?.d14?.service,d16:foundation?.d16?.service,d19:d19Service,d20:d20Service,d21:d21Service,d22:d22Service};
  if(Object.values(deps).some(v=>!v))return null;
  const service=createD23Service(deps);let ready=false;
  const repositories=[foundation.d07?.repository,foundation.d08?.repository,foundation.d09?.repository,foundation.d10?.repository,foundation.d14?.repository,foundation.d16?.repository,foundation.d20?.repository,foundation.d21?.repository,foundation.d22?.repository].filter(Boolean);
  const requireReady=async(req,res,next)=>{try{if(!ready){for(const repository of repositories)if(typeof repository.assertReady==='function')await repository.assertReady();ready=true;}return next();}catch(error){return res.status(503).json({error:'Teaching workspace is unavailable until predecessor academic stores are ready.',code:error?.code||'TEACHING_D23_PREDECESSOR_NOT_READY'});}};
  router.use(requireReady);

  const tz=req=>String(req.query.currentTimeZone||req.query.timeZone||'UTC');
  const html=(res,renderer,model)=>res.type('html').send(renderer(model));

  router.get('/information/today',async(req,res)=>{try{res.json(await service.today(req.user,{currentTimeZone:tz(req)}));}catch(e){sendError(res,e,'Failed to load Teaching Today.');}});
  router.get('/information/courses',async(req,res)=>{try{res.json(await service.courses(req.user));}catch(e){sendError(res,e,'Failed to load Teaching Courses workspace.');}});
  router.get('/information/calendar',async(req,res)=>{try{res.json(await service.calendar(req.user,{from:req.query.from||null,to:req.query.to||null,currentTimeZone:tz(req)}));}catch(e){sendError(res,e,'Failed to load Teaching Calendar workspace.');}});
  router.get('/information/record',async(req,res)=>{try{res.json(await service.record(req.user,{semesterId:req.query.semesterId||null}));}catch(e){sendError(res,e,'Failed to load Teaching Record workspace.');}});
  router.get('/information/study',async(req,res)=>{try{res.json(await service.study(req.user,{courseId:req.query.courseId||null,classId:req.query.classId||null}));}catch(e){sendError(res,e,'Failed to load Teaching Study collection.');}});

  router.get('/today/view',async(req,res)=>{try{html(res,ui.renderToday,await service.today(req.user,{currentTimeZone:tz(req)}));}catch(e){sendError(res,e,'Failed to render Teaching Today.');}});
  router.get('/courses/view',async(req,res)=>{try{html(res,ui.renderCourses,await service.courses(req.user));}catch(e){sendError(res,e,'Failed to render Teaching Courses.');}});
  router.get('/archive/view',async(req,res)=>{try{html(res,ui.renderCourses,await service.archivedCourses(req.user));}catch(e){sendError(res,e,'Failed to render Archived Courses.');}});
  router.get('/calendar/view',async(req,res)=>{try{html(res,ui.renderCalendar,await service.calendar(req.user,{from:req.query.from||null,to:req.query.to||null,currentTimeZone:tz(req)}));}catch(e){sendError(res,e,'Failed to render Teaching Calendar.');}});
  router.get('/work/view',async(req,res)=>{try{html(res,ui.renderWork,await service.globalWork(req.user));}catch(e){sendError(res,e,'Failed to render Teaching Work.');}});
  router.get('/record/view',async(req,res)=>{try{html(res,ui.renderRecord,await service.record(req.user,{semesterId:req.query.semesterId||null}));}catch(e){sendError(res,e,'Failed to render Teaching Record.');}});
  router.get('/requests/view',async(req,res)=>{try{html(res,ui.renderRequests,await service.requests(req.user));}catch(e){sendError(res,e,'Failed to render Teaching Requests.');}});
  router.get('/study/view',async(req,res)=>{try{html(res,ui.renderStudy,await service.study(req.user,{courseId:req.query.courseId||null,classId:req.query.classId||null}));}catch(e){sendError(res,e,'Failed to render Teaching Study collection.');}});
  router.get('/create-course/view',(_req,res)=>html(res,ui.renderCreateCourse,{}));

  router.get('/courses/:id/overview/view',async(req,res)=>{try{html(res,ui.renderCourseOverview,await service.courseOverview(req.user,req.params.id));}catch(e){sendError(res,e,'Failed to render Course Overview.');}});
  router.get('/courses/:id/plan/view',async(req,res)=>{try{html(res,ui.renderCoursePlan,await service.coursePlan(req.user,req.params.id));}catch(e){sendError(res,e,'Failed to render Course Plan.');}});
  router.get('/courses/:id/materials/view',async(req,res)=>{try{html(res,ui.renderMaterials,await service.courseMaterials(req.user,req.params.id));}catch(e){sendError(res,e,'Failed to render Course Materials.');}});
  router.get('/courses/:id/work/view',async(req,res)=>{try{html(res,ui.renderWork,await service.courseWork(req.user,req.params.id));}catch(e){sendError(res,e,'Failed to render Course Work.');}});
  router.get('/courses/:id/results/view',async(req,res)=>{try{html(res,ui.renderCourseResults,await service.courseResults(req.user,req.params.id));}catch(e){sendError(res,e,'Failed to render Course Results.');}});
  router.get('/classes/:id/event/view',async(req,res)=>{try{html(res,ui.renderClassEvent,await service.classEventDetail(req.user,req.params.id));}catch(e){sendError(res,e,'Failed to render Class Event.');}});

  return Object.freeze({service,requireReady});
}

module.exports={mountD23Routes};
