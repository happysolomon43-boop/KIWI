'use strict';
const {mountD18Routes}=require('../d18/routes');
const {createD19AssessmentTypeService}=require('../d19/service');
const {mountD20Routes}=require('../d20/routes');
const {mountD21Routes}=require('../d21/routes');
const {mountD22Routes}=require('../d22/routes');
const {mountD23Routes}=require('../d23/routes');
const {createD25ReliabilityService}=require('../d25/service');
const {mountD25Routes}=require('../d25/routes');
function mountD17Routes(router,{foundation,sendError}={}){
  const d17=foundation?.d17?.service;if(!d17)return null;let ready=false;
  const service=createD19AssessmentTypeService({d17Service:d17,d17Repository:foundation.d17.repository,d08Repository:foundation.d08?.repository||null,d11Repository:foundation.d11?.repository||null,d14Service:foundation.d14?.service||null,policy:foundation.policy});
  const reliability=foundation.d11?.service&&foundation.d14?.service&&foundation.d16?.service
    ? createD25ReliabilityService({foundation})
    : null;
  const requireReady=async(req,res,next)=>{try{if(!ready){await foundation.d17.repository.assertReady();ready=true;}return next();}catch(error){return res.status(503).json({error:'Teaching Assessment is unavailable until the D17 schema is ready.',code:error?.code||'TEACHING_D17_SCHEMA_NOT_READY'});}};
  router.use('/assessments',requireReady);
  router.get('/assessments',async(req,res)=>{try{res.json(await service.list(req.user,{courseId:req.query.courseId||null,limit:req.query.limit}));}catch(e){sendError(res,e,'Failed to load Teaching Assessments.');}});
  router.post('/assessments',async(req,res)=>{try{res.status(201).json(await service.createDefinition(req.user,req.body||{}));}catch(e){sendError(res,e,'Failed to create Assessment definition.');}});
  router.get('/assessments/:id/measurement-policy',async(req,res)=>{try{res.json(await service.getMeasurementPolicy(req.user,req.params.id));}catch(e){sendError(res,e,'Failed to load Assessment measurement policy.');}});
  router.post('/assessments/:id/blueprints',async(req,res)=>{try{res.status(201).json(await service.prepareBlueprint(req.user,req.params.id,req.body||{}));}catch(e){sendError(res,e,'Failed to prepare Assessment Blueprint.');}});
  router.post('/assessments/:id/candidates',async(req,res)=>{try{res.status(201).json(await service.generateCandidate(req.user,req.params.id,req.body||{}));}catch(e){sendError(res,e,'Failed to generate protected Assessment candidate.');}});
  router.post('/assessments/:id/candidates/:candidateVersionId/validate',async(req,res)=>{try{res.json(await service.validateItem(req.user,req.params.id,req.params.candidateVersionId,req.body||{}));}catch(e){sendError(res,e,'Failed to validate Assessment item.');}});
  router.post('/assessments/:id/validate-package',async(req,res)=>{try{res.json(await service.validateWholePackage(req.user,req.params.id,req.body||{}));}catch(e){sendError(res,e,'Failed to validate Assessment package.');}});
  router.post('/assessments/:id/lock',async(req,res)=>{try{res.json(await service.reconcileAndLock(req.user,req.params.id,req.body||{}));}catch(e){sendError(res,e,'Assessment Package could not be locked.');}});
  router.get('/assessments/packages/:packageId',async(req,res)=>{try{res.json(await service.getPackage(req.user,req.params.packageId));}catch(e){sendError(res,e,'Failed to load Assessment Package.');}});
  router.post('/assessments/:id/attempts',async(req,res)=>{try{res.status(201).json(await (reliability?reliability.startAssessmentAttempt(req.user,req.params.id,req.body||{}):service.startAttempt(req.user,req.params.id,req.body||{})));}catch(e){sendError(res,e,'Failed to start Assessment Attempt.');}});
  router.post('/assessments/attempts/:attemptId/responses',async(req,res)=>{try{res.status(201).json(await (reliability?reliability.saveAssessmentResponse(req.user,req.params.attemptId,req.body||{}):service.saveResponse(req.user,req.params.attemptId,req.body||{})));}catch(e){sendError(res,e,'Failed to save Assessment response.');}});
  router.post('/assessments/attempts/:attemptId/submit',async(req,res)=>{try{res.json(await (reliability?reliability.submitAssessmentAttempt(req.user,req.params.attemptId,req.body||{}):service.submit(req.user,req.params.attemptId,req.body||{})));}catch(e){sendError(res,e,'Failed to submit Assessment Attempt.');}});
  router.post('/assessments/attempts/:attemptId/device-transfer',async(req,res)=>{try{res.json(await (reliability?reliability.transferAssessmentDevice(req.user,req.params.attemptId,req.body||{}):service.transferDevice(req.user,req.params.attemptId,req.body||{})));}catch(e){sendError(res,e,'Failed to transfer Assessment Attempt device.');}});
  router.post('/assessments/attempts/:attemptId/challenges',async(req,res)=>{try{res.status(201).json(await service.challenge(req.user,req.params.attemptId,req.body||{}));}catch(e){sendError(res,e,'Failed to record Assessment item challenge.');}});
  router.post('/assessments/attempts/:attemptId/clarification',async(req,res)=>{try{res.json(await service.clarify(req.user,req.params.attemptId,req.body||{}));}catch(e){sendError(res,e,'Failed to classify Assessment clarification.');}});
  const d18=mountD18Routes(router,{foundation,sendError,requireD17Ready:requireReady});
  const d20=mountD20Routes(router,{foundation,sendError,d19Service:service,requireD17Ready:requireReady});
  const d21=mountD21Routes(router,{foundation,sendError,d17Service:service,d19Service:service,d20Service:d20?.service||null,requireD17Ready:requireReady});
  const d22=mountD22Routes(router,{foundation,sendError});
  const d23=mountD23Routes(router,{foundation,sendError,d19Service:service,d20Service:d20?.service||null,d21Service:d21?.service||null,d22Service:d22?.service||null});
  const d25=reliability?mountD25Routes(router,{service:reliability,sendError}):null;
  return Object.freeze({requireReady,d18,d19:service,d20,d21,d22,d23,d25});
}
module.exports={mountD17Routes};
