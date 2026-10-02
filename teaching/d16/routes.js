'use strict';
const {mountIntegrityRoutes}=require('../../services/integrity/routes');
function mountD16Routes(router,{foundation,sendError}={}){
  if(!router||!foundation||typeof sendError!=='function')throw new TypeError('D16 routes require router, foundation and sendError.');
  const service=foundation.d16?.service||null,repository=foundation.d16?.repository||null,d10Service=foundation.d10?.service||null,integrityService=foundation.integrity?.service||null;if(!service||!repository)return null;
  let ready=false;router.assertD16Ready=async()=>{await repository.assertReady();ready=true;return true;};
  const requireD16Ready=async(_req,res,next)=>{if(ready)return next();try{await router.assertD16Ready();return next();}catch{return res.status(503).json({error:'Teaching Work is unavailable until the D16 schema is ready.',code:'TEACHING_D16_SCHEMA_NOT_READY'});}};
  if(integrityService)mountIntegrityRoutes(router,{foundation,sendError});
  router.get('/work',requireD16Ready,async(req,res)=>{try{res.json(await service.listWork(req.user));}catch(error){sendError(res,error,'Failed to load Teaching Work.');}});
  router.get('/courses/:id/work',requireD16Ready,async(req,res)=>{try{res.json(await service.listWork(req.user,{courseId:req.params.id}));}catch(error){sendError(res,error,'Failed to load Course Work.');}});
  router.get('/assignments/:id',requireD16Ready,async(req,res)=>{try{const assignment=await service.getAssignment(req.user,req.params.id);if(!integrityService)return res.json(assignment);const gate=await integrityService.getAssignmentGate(req.user,req.params.id);return res.json({...assignment,submissionGate:gate});}catch(error){sendError(res,error,'Failed to load Assignment.');}});
  router.post('/assignments/:id/draft',requireD16Ready,async(req,res)=>{try{res.json(await service.saveDraft(req.user,req.params.id,req.body||{}));}catch(error){sendError(res,error,'Draft could not be saved.');}});
  router.post('/assignments/:id/submit',requireD16Ready,async(req,res)=>{try{if(!integrityService)return res.status(503).json({error:'Submission Verification Gate is not ready.',code:'KIWI_INTEGRITY_SCHEMA_NOT_READY'});return res.json(await integrityService.requestAssignmentSubmission(req.user,req.params.id,req.body||{}));}catch(error){sendError(res,error,'Assignment could not be submitted.');}});
  router.post('/assignments/:id/assistance',requireD16Ready,async(req,res)=>{try{res.json(await service.requestAssistance(req.user,req.params.id,req.body||{}));}catch(error){sendError(res,error,'Assignment assistance request failed safely.');}});
  router.post('/assignments/:id/correction',requireD16Ready,async(req,res)=>{try{res.json(await service.openCorrection({studentId:req.user.id,assignmentId:req.params.id,idempotencyKey:req.body?.idempotencyKey||null}));}catch(error){sendError(res,error,'Correction Mode could not open.');}});
  router.post('/assignments/:id/correction/submit',requireD16Ready,async(req,res)=>{try{if(!integrityService)return res.status(503).json({error:'Submission Verification Gate is not ready.',code:'KIWI_INTEGRITY_SCHEMA_NOT_READY'});return res.json(await integrityService.requestAssignmentSubmission(req.user,req.params.id,{...(req.body||{}),correction:true}));}catch(error){sendError(res,error,'Correction could not be resubmitted.');}});
  router.post('/assignments/:id/extension-request',requireD16Ready,async(req,res)=>{try{res.status(201).json(await service.requestExtension(req.user,req.params.id,req.body||{},d10Service));}catch(error){sendError(res,error,'Assignment extension Request could not be created.');}});
  return Object.freeze({ready:()=>ready,requireD16Ready});
}
module.exports={mountD16Routes};
