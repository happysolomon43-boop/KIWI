'use strict';

const { renderTeacherSurface } = require('./ui');

function mountD22Routes(router,{foundation,sendError}={}){
  const service=foundation?.d22?.service;const repository=foundation?.d22?.repository;if(!service||!repository)return null;let ready=false;
  const requireReady=async(req,res,next)=>{try{if(!ready){await repository.assertReady();ready=true;}return next();}catch(error){return res.status(503).json({error:'Teacher Identity is unavailable until the D22 schema is ready.',code:error?.code||'TEACHING_D22_SCHEMA_NOT_READY'});}};
  router.use('/teacher-change',requireReady);
  router.use('/courses/:id/teacher',requireReady);
  router.get('/courses/:id/teacher',async(req,res)=>{try{res.json(await service.teacherSurface(req.user,req.params.id));}catch(e){sendError(res,e,'Failed to load Course Teacher.');}});
  router.get('/courses/:id/teacher/view',async(req,res)=>{try{res.type('html').send(renderTeacherSurface(await service.teacherSurface(req.user,req.params.id)));}catch(e){sendError(res,e,'Failed to render Course Teacher.');}});
  router.post('/courses/:id/teacher/ensure',async(req,res)=>{try{res.status(201).json(await service.ensureTeacher(req.user,req.params.id,req.body||{}));}catch(e){sendError(res,e,'Course Teacher could not be initialized safely.');}});
  router.get('/courses/:id/teacher/interaction-context',async(req,res)=>{try{res.json(await service.interactionContext(req.user,req.params.id,{register:'NORMAL'}));}catch(e){sendError(res,e,'Teacher interaction context could not be resolved.');}});
  router.put('/courses/:id/teacher/interaction-profile',async(req,res)=>{try{res.json(await service.updateInteractionProfile(req.user,req.params.id,req.body||{}));}catch(e){sendError(res,e,'Interaction preferences could not be saved.');}});
  router.post('/courses/:id/teacher/questions',async(req,res)=>{try{const result=await service.askOutsideClass(req.user,req.params.id,req.body||{});res.status(result.status==='ROUTE_HELD'?202:200).json(result);}catch(e){sendError(res,e,'Outside-Class Teacher question could not be handled safely.');}});
  router.post('/courses/:id/teacher/change-request',async(req,res)=>{try{res.status(201).json(await service.requestTeacherChange(req.user,req.params.id,req.body||{}));}catch(e){sendError(res,e,'Teacher Change Request could not be created.');}});
  router.get('/teacher-change/:requestId/transition',async(req,res)=>{try{res.json(await service.transitionForRequest(req.user,req.params.requestId));}catch(e){sendError(res,e,'Teacher transition is not available yet.');}});
  return Object.freeze({service,requireReady});
}

module.exports={mountD22Routes};
