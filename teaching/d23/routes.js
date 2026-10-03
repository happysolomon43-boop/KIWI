'use strict';

const {createD23Service}=require('./service');
const ui=require('./ui');

function mountD23Routes(router,{foundation,sendError,d19Service,d20Service,d21Service,d22Service}={}){
  const deps={d07:foundation?.d07?.service,d08:foundation?.d08?.service,d09:foundation?.d09?.service,d10:foundation?.d10?.service,d14:foundation?.d14?.service,d16:foundation?.d16?.service,d19:d19Service,d20:d20Service,d21:d21Service,d22:d22Service};
  if(Object.values(deps).some(v=>!v))return null;
  const service=createD23Service(deps);let ready=false;
  const repositories=[foundation.d07?.repository,foundation.d08?.repository,foundation.d09?.repository,foundation.d10?.repository,foundation.d14?.repository,foundation.d16?.repository,foundation.d20?.repository,foundation.d21?.repository,foundation.d22?.repository].filter(Boolean);
  const requireReady=async(_req,res,next)=>{try{if(!ready){for(const repository of repositories)if(typeof repository.assertReady==='function')await repository.assertReady();ready=true;}return next();}catch(error){return res.status(503).json({error:'Teaching workspace is unavailable until predecessor academic stores are ready.',code:error?.code||'TEACHING_D23_PREDECESSOR_NOT_READY'});}};
  const tz=req=>String(req.query.currentTimeZone||req.query.timeZone||'UTC');
  const html=(res,renderer,model)=>res.type('html').send(renderer(model));
  const jsonRoute=(path,work,fallback)=>router.get(path,requireReady,async(req,res)=>{try{res.json(await work(req));}catch(e){sendError(res,e,fallback);}});
  const htmlRoute=(path,renderer,work,fallback)=>router.get(path,requireReady,async(req,res)=>{try{html(res,renderer,await work(req));}catch(e){sendError(res,e,fallback);}});

  jsonRoute('/information/today',req=>service.today(req.user,{currentTimeZone:tz(req)}),'Failed to load Teaching Today.');
  jsonRoute('/information/courses',req=>service.courses(req.user),'Failed to load Teaching Courses workspace.');
  jsonRoute('/information/calendar',req=>service.calendar(req.user,{from:req.query.from||null,to:req.query.to||null,currentTimeZone:tz(req)}),'Failed to load Teaching Calendar workspace.');
  jsonRoute('/information/record',req=>service.record(req.user,{semesterId:req.query.semesterId||null}),'Failed to load Teaching Record workspace.');
  jsonRoute('/information/study',req=>service.study(req.user,{courseId:req.query.courseId||null,classId:req.query.classId||null}),'Failed to load Teaching Study collection.');

  htmlRoute('/today/view',ui.renderToday,req=>service.today(req.user,{currentTimeZone:tz(req)}),'Failed to render Teaching Today.');
  htmlRoute('/courses/view',ui.renderCourses,req=>service.courses(req.user),'Failed to render Teaching Courses.');
  htmlRoute('/archive/view',ui.renderCourses,req=>service.archivedCourses(req.user),'Failed to render Archived Courses.');
  htmlRoute('/calendar/view',ui.renderCalendar,req=>service.calendar(req.user,{from:req.query.from||null,to:req.query.to||null,currentTimeZone:tz(req)}),'Failed to render Teaching Calendar.');
  htmlRoute('/work/view',ui.renderWork,req=>service.globalWork(req.user),'Failed to render Teaching Work.');
  htmlRoute('/record/view',ui.renderRecord,req=>service.record(req.user,{semesterId:req.query.semesterId||null}),'Failed to render Teaching Record.');
  htmlRoute('/requests/view',ui.renderRequests,req=>service.requests(req.user),'Failed to render Teaching Requests.');
  htmlRoute('/study/view',ui.renderStudy,req=>service.study(req.user,{courseId:req.query.courseId||null,classId:req.query.classId||null}),'Failed to render Teaching Study collection.');
  router.get('/create-course/view',requireReady,(_req,res)=>html(res,ui.renderCreateCourse,{}));

  htmlRoute('/courses/:id/overview/view',ui.renderCourseOverview,req=>service.courseOverview(req.user,req.params.id),'Failed to render Course Overview.');
  htmlRoute('/courses/:id/plan/view',ui.renderCoursePlan,req=>service.coursePlan(req.user,req.params.id),'Failed to render Course Plan.');
  htmlRoute('/courses/:id/materials/view',ui.renderMaterials,req=>service.courseMaterials(req.user,req.params.id),'Failed to render Course Materials.');
  htmlRoute('/courses/:id/work/view',ui.renderWork,req=>service.courseWork(req.user,req.params.id),'Failed to render Course Work.');
  htmlRoute('/courses/:id/results/view',ui.renderCourseResults,req=>service.courseResults(req.user,req.params.id),'Failed to render Course Results.');
  htmlRoute('/classes/:id/event/view',ui.renderClassEvent,req=>service.classEventDetail(req.user,req.params.id),'Failed to render Class Event.');

  return Object.freeze({service,requireReady});
}

module.exports={mountD23Routes};
