'use strict';

const {createD20Service}=require('./assessment-boundary-service');
const {renderCourseResults,renderTopicResult,renderAssessmentReview}=require('./ui');

function mountD20Routes(router,{foundation,sendError,d19Service,requireD17Ready}={}){
  const repository=foundation?.d20?.repository;if(!repository)return null;let ready=false;
  const service=createD20Service({repository,d17Repository:foundation.d17?.repository,d19Service,intelligence:foundation.d20?.intelligence||null,policy:foundation.policy,randomUUID:foundation.d20?.randomUUID||foundation.randomUUID||require('node:crypto').randomUUID});
  const requireReady=async(req,res,next)=>{try{if(typeof requireD17Ready==='function'){let finished=false;await requireD17Ready(req,res,()=>{finished=true;});if(!finished)return;}if(!ready){await repository.assertReady();ready=true;}return next();}catch(error){return res.status(503).json({error:'Teaching formal marking and Gradebook are unavailable until the D20 schema is ready.',code:error?.code||'TEACHING_D20_SCHEMA_NOT_READY'});}};
  const downstreamReconcile=async(user,resultId)=>{try{const row=await repository.resultById(String(user?.id||''),resultId);const fn=foundation?.d20?.downstreamBridge?.reconcileGradeChange;if(!row||typeof fn!=='function')return Object.freeze({reconciled:false,state:'D21_NOT_TRACKING'});return await fn(String(user.id),String(row.course_id));}catch(error){return Object.freeze({reconciled:false,state:'D21_RECONCILIATION_DEFERRED',code:error?.code||'TEACHING_D21_RECONCILIATION_FAILED'});}};
  router.use('/results',requireReady);
  router.use('/gradebook',requireReady);

  router.put('/gradebook/courses/:courseId/policy',async(req,res)=>{try{
    const body=req.body||{},appeal=body.appealPolicy||body.appeal_policy||{};
    if((appeal.default_review_direction||appeal.defaultReviewDirection)&&!appeal.authority_ref&&!appeal.authorityRef&&!appeal.policy_ref&&!appeal.policyRef){return res.status(400).json({error:'Appeal review direction must cite an explicit Course/institution policy authority.',code:'TEACHING_D20_APPEAL_DIRECTION_AUTHORITY_REQUIRED'});}
    res.json(await service.ensurePolicy(req.user,req.params.courseId,body));
  }catch(e){sendError(res,e,'Failed to lock Course Grading Policy.');}});
  router.get('/gradebook/courses/:courseId',async(req,res)=>{try{res.json(await service.courseResults(req.user,req.params.courseId));}catch(e){sendError(res,e,'Failed to load Course Results.');}});
  router.get('/gradebook/courses/:courseId/view',async(req,res)=>{try{const model=await service.courseResults(req.user,req.params.courseId);res.type('html').send(renderCourseResults(model));}catch(e){sendError(res,e,'Failed to load Course Results view.');}});
  router.get('/gradebook/courses/:courseId/topics/:topicId/view',async(req,res)=>{try{const model=await service.courseResults(req.user,req.params.courseId),topic=model.topics.find(t=>String(t.topicId)===String(req.params.topicId));if(!topic)return res.status(404).type('html').send(renderTopicResult({topic:{topicId:req.params.topicId,state:'PROVISIONAL_INSUFFICIENT_EVIDENCE'}}));res.type('html').send(renderTopicResult({courseId:model.courseId,topic,policy:model.policy}));}catch(e){sendError(res,e,'Failed to load Topic Result view.');}});
  router.post('/gradebook/homework/:evaluationId/commit',async(req,res)=>{try{res.status(201).json(await service.commitHomeworkEvaluation(req.user,req.params.evaluationId,req.body||{}));}catch(e){sendError(res,e,'Failed to commit validated Homework evaluation.');}});

  router.post('/results/attempts/:attemptId/mark',async(req,res)=>{try{res.status(201).json(await service.markAttempt(req.user,req.params.attemptId,req.body||{}));}catch(e){sendError(res,e,'Failed to mark Assessment Attempt.');}});
  router.get('/results/:resultId',async(req,res)=>{try{res.json(await service.assessmentReview(req.user,req.params.resultId));}catch(e){sendError(res,e,'Failed to load Assessment Result review.');}});
  router.get('/results/:resultId/view',async(req,res)=>{try{res.type('html').send(renderAssessmentReview(await service.assessmentReview(req.user,req.params.resultId)));}catch(e){sendError(res,e,'Failed to load Assessment Result review view.');}});
  router.post('/results/:resultId/moderate',async(req,res)=>{try{res.json(await service.moderateResult(req.user,req.params.resultId,req.body||{}));}catch(e){sendError(res,e,'Failed to moderate Assessment Result.');}});
  router.post('/results/:resultId/transition',async(req,res)=>{try{res.json(await service.transitionResult(req.user,req.params.resultId,req.body||{}));}catch(e){sendError(res,e,'Failed to change Assessment Result lifecycle.');}});
  router.post('/results/:resultId/recalculate-invalidation',async(req,res)=>{try{const result=await service.recalculateAfterItemInvalidation(req.user,req.params.resultId,req.body||{});const downstreamProgression=await downstreamReconcile(req.user,req.params.resultId);res.json({...result,downstreamProgression});}catch(e){sendError(res,e,'Failed to recalculate Assessment Result after item invalidation.');}});
  router.post('/results/:resultId/appeals',async(req,res)=>{try{res.status(201).json(await service.createAppeal(req.user,req.params.resultId,req.body||{}));}catch(e){sendError(res,e,'Failed to create Grade appeal.');}});
  router.post('/results/appeals/:appealId/review',async(req,res)=>{try{const appeal=await repository.appealById(String(req.user?.id||''),req.params.appealId);const result=await service.reviewAppeal(req.user,req.params.appealId,req.body||{});const downstreamProgression=appeal?.assessment_result_id?await downstreamReconcile(req.user,appeal.assessment_result_id):Object.freeze({reconciled:false,state:'RESULT_LINEAGE_UNAVAILABLE'});res.json({...result,downstreamProgression});}catch(e){sendError(res,e,'Failed to review Grade appeal.');}});

  return Object.freeze({service,requireReady});
}

module.exports={mountD20Routes};
