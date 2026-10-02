'use strict';

const {createD20Service}=require('./service');

function mountD20Routes(router,{foundation,sendError,d19Service,requireD17Ready}={}){
  const repository=foundation?.d20?.repository;if(!repository)return null;let ready=false;
  const service=createD20Service({repository,d17Repository:foundation.d17?.repository,d19Service,intelligence:foundation.d20?.intelligence||null,policy:foundation.policy,randomUUID:foundation.d20?.randomUUID||foundation.randomUUID||require('node:crypto').randomUUID});
  const requireReady=async(req,res,next)=>{try{if(typeof requireD17Ready==='function'){let finished=false;await requireD17Ready(req,res,()=>{finished=true;});if(!finished)return;}if(!ready){await repository.assertReady();ready=true;}return next();}catch(error){return res.status(503).json({error:'Teaching formal marking and Gradebook are unavailable until the D20 schema is ready.',code:error?.code||'TEACHING_D20_SCHEMA_NOT_READY'});}};
  router.use('/results',requireReady);
  router.use('/gradebook',requireReady);

  router.put('/gradebook/courses/:courseId/policy',async(req,res)=>{try{
    const body=req.body||{},appeal=body.appealPolicy||body.appeal_policy||{};
    if(appeal.default_review_direction&&!appeal.authority_ref&&!appeal.policy_ref){return res.status(400).json({error:'Appeal review direction must cite an explicit Course/institution policy authority.',code:'TEACHING_D20_APPEAL_DIRECTION_AUTHORITY_REQUIRED'});}
    res.json(await service.ensurePolicy(req.user,req.params.courseId,body));
  }catch(e){sendError(res,e,'Failed to lock Course Grading Policy.');}});
  router.get('/gradebook/courses/:courseId',async(req,res)=>{try{res.json(await service.courseResults(req.user,req.params.courseId));}catch(e){sendError(res,e,'Failed to load Course Results.');}});
  router.post('/gradebook/homework/:evaluationId/commit',async(req,res)=>{try{res.status(201).json(await service.commitHomeworkEvaluation(req.user,req.params.evaluationId,req.body||{}));}catch(e){sendError(res,e,'Failed to commit validated Homework evaluation.');}});

  router.post('/results/attempts/:attemptId/mark',async(req,res)=>{try{res.status(201).json(await service.markAttempt(req.user,req.params.attemptId,req.body||{}));}catch(e){sendError(res,e,'Failed to mark Assessment Attempt.');}});
  router.get('/results/:resultId',async(req,res)=>{try{res.json(await service.assessmentReview(req.user,req.params.resultId));}catch(e){sendError(res,e,'Failed to load Assessment Result review.');}});
  router.post('/results/:resultId/moderate',async(req,res)=>{try{res.json(await service.moderateResult(req.user,req.params.resultId,req.body||{}));}catch(e){sendError(res,e,'Failed to moderate Assessment Result.');}});
  router.post('/results/:resultId/transition',async(req,res)=>{try{res.json(await service.transitionResult(req.user,req.params.resultId,req.body||{}));}catch(e){sendError(res,e,'Failed to change Assessment Result lifecycle.');}});
  router.post('/results/:resultId/appeals',async(req,res)=>{try{
    const studentId=String(req.user?.id||''),result=await repository.resultById(studentId,req.params.resultId);
    if(!result)return res.status(404).json({error:'Assessment Result not found.',code:'TEACHING_D20_RESULT_NOT_FOUND'});
    const policy=await repository.lockedPolicy(studentId,result.course_id),direction=policy?.appeal_policy?.default_review_direction||null;
    if(!direction)return res.status(409).json({error:'This Course has no configured appeal review-direction policy. Appeal review cannot begin until an authorized versioned policy exists.',code:'TEACHING_D20_REVIEW_DIRECTION_REQUIRED'});
    res.status(201).json(await service.createAppeal(req.user,req.params.resultId,{...(req.body||{}),reviewDirectionPolicy:direction}));
  }catch(e){sendError(res,e,'Failed to create Grade appeal.');}});
  router.post('/results/appeals/:appealId/review',async(req,res)=>{try{res.json(await service.reviewAppeal(req.user,req.params.appealId,req.body||{}));}catch(e){sendError(res,e,'Failed to review Grade appeal.');}});

  return Object.freeze({service,requireReady});
}

module.exports={mountD20Routes};