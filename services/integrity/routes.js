'use strict';

function mountIntegrityRoutes(router,{foundation,sendError}={}){
  if(!router||!foundation||typeof sendError!=='function')throw new TypeError('Integrity routes require router, foundation and sendError.');
  const service=foundation.integrity?.service||null,repository=foundation.integrity?.repository||null;if(!service||!repository)return null;
  let ready=false;
  const requireReady=async(_req,res,next)=>{if(ready)return next();try{await repository.assertReady();ready=true;return next();}catch(error){return res.status(503).json({error:'KIWI Integrity Session Guard is unavailable until its schema is ready.',code:'KIWI_INTEGRITY_SCHEMA_NOT_READY'});}};
  router.post('/integrity/sessions',requireReady,async(req,res)=>{try{res.status(201).json(await service.startSession(req.user,req.body||{}));}catch(error){sendError(res,error,'Controlled session could not start.');}});
  router.get('/integrity/sessions/:sessionId',requireReady,async(req,res)=>{try{res.json(await service.getSession(req.user,req.params.sessionId));}catch(error){sendError(res,error,'Controlled session could not be loaded.');}});
  router.post('/integrity/sessions/:sessionId/events',requireReady,async(req,res)=>{try{res.json(await service.recordEvent(req.user,req.params.sessionId,req.body||{}));}catch(error){sendError(res,error,'Controlled-session event could not be recorded.');}});
  router.post('/integrity/sessions/:sessionId/close',requireReady,async(req,res)=>{try{res.json(await service.closeSession(req.user,req.params.sessionId));}catch(error){sendError(res,error,'Controlled session could not close.');}});
  router.get('/assignments/:id/submission-gate',requireReady,async(req,res)=>{try{res.json(await service.getAssignmentGate(req.user,req.params.id));}catch(error){sendError(res,error,'Submission verification state could not be loaded.');}});
  router.post('/verification/:sessionId/items/:itemId/respond',requireReady,async(req,res)=>{try{res.json(await service.submitVerificationResponse(req.user,req.params.sessionId,req.params.itemId,req.body||{}));}catch(error){sendError(res,error,'Verification response could not be accepted.');}});
  return Object.freeze({ready:()=>ready,requireReady});
}
module.exports={mountIntegrityRoutes};
