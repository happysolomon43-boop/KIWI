'use strict';
function mountD26Routes(router,{service,repository,sendError}={}){if(!service)return null;let ready=false;const requireReady=async(_req,res,next)=>{try{if(!ready){await repository.assertReady();ready=true;}next();}catch(error){res.status(503).json({error:'Teaching coordination is unavailable until the D26 schema is ready.',code:error.code||'TEACHING_D26_SCHEMA_NOT_READY'});}};
  router.get('/coordination/status',(req,res)=>res.json(service.status()));
  router.get('/coordination/semesters/:semesterId',requireReady,async(req,res)=>{try{res.json(await service.globalSchedule(req.user,{semesterId:req.params.semesterId,dailyCapacityMinutes:req.query.dailyCapacityMinutes,timeZone:req.query.timeZone||'UTC'}));}catch(e){sendError(res,e,'Failed to coordinate semester workload.');}});
  router.post('/coordination/notifications',requireReady,async(req,res)=>{try{res.status(202).json(await service.enqueueNotification(req.user,req.body||{}));}catch(e){sendError(res,e,'Failed to schedule notification.');}});
  router.post('/coordination/review-needs',requireReady,async(req,res)=>{try{res.status(201).json(await service.upsertReviewNeed(req.user,req.body||{}));}catch(e){sendError(res,e,'Failed to record Review Need.');}});
  router.post('/coordination/recovery-cases',requireReady,async(req,res)=>{try{res.status(201).json(await service.createRecoveryCase(req.user,req.body||{}));}catch(e){sendError(res,e,'Failed to create Recovery Case.');}});
  router.get('/coordination/recovery-cases/:caseId',requireReady,async(req,res)=>{try{res.json(await service.getRecoveryCase(req.user,req.params.caseId));}catch(e){sendError(res,e,'Failed to load Recovery Case.');}});
  router.post('/coordination/recovery-cases/:caseId/transition',requireReady,async(req,res)=>{try{res.json(await service.transitionRecoveryCase(req.user,req.params.caseId,req.body||{}));}catch(e){sendError(res,e,'Failed to transition Recovery Case.');}});
  router.post('/coordination/recovery-cases/:caseId/proposal',requireReady,async(req,res)=>{try{res.json(await service.proposeRecovery(req.user,req.params.caseId,req.body||{}));}catch(e){sendError(res,e,'Failed to prepare Recovery Case options.');}});
  router.get('/coordination/support/inspection',requireReady,async(req,res)=>{try{res.json(await service.supportInspection(req.user,req.query));}catch(e){sendError(res,e,'Failed to load support inspection.');}});
  return Object.freeze({service,requireReady});
}
module.exports={mountD26Routes};
