'use strict';

function mountD15Routes(router,{foundation,sendError}={}){
  if(!router||!foundation||typeof sendError!=='function') throw new TypeError('D15 routes require router, foundation and sendError.');
  const service=foundation.d15?.service||null;
  const repository=foundation.d15?.repository||null;
  if(!service||!repository) return null;

  let ready=false;
  router.assertD15Ready=async()=>{
    await repository.assertReady();
    ready=true;
    return true;
  };
  const requireD15Ready=async(_req,res,next)=>{
    if(ready) return next();
    try{
      await router.assertD15Ready();
      return next();
    }catch{
      return res.status(503).json({
        error:'Teaching Attendance and recovery records are unavailable until the D15 schema is ready.',
        code:'TEACHING_D15_SCHEMA_NOT_READY',
      });
    }
  };

  router.get('/courses/:id/attendance',requireD15Ready,async(req,res)=>{
    try{res.json(await service.courseRecord(req.user,req.params.id));}
    catch(error){sendError(res,error,'Failed to load Course attendance record.');}
  });
  router.get('/record/attendance',requireD15Ready,async(req,res)=>{
    try{res.json(await service.globalRecord(req.user));}
    catch(error){sendError(res,error,'Failed to load Teaching attendance record.');}
  });
  router.get('/classes/:id/attendance/history',requireD15Ready,async(req,res)=>{
    try{res.json(await service.classHistory(req.user,req.params.id));}
    catch(error){sendError(res,error,'Failed to load Attendance correction history.');}
  });
  router.get('/classes/:id/makeup-readiness',requireD15Ready,async(req,res)=>{
    try{res.json(await service.makeupReadiness(req.user,req.params.id));}
    catch(error){sendError(res,error,'Failed to load missed-instruction recovery readiness.');}
  });
  router.get('/classes/:id/deferral-state',requireD15Ready,async(req,res)=>{
    try{res.json(await service.deferralState(req.user,req.params.id));}
    catch(error){sendError(res,error,'Failed to load Class deferral state.');}
  });

  return Object.freeze({ready:()=>ready,requireD15Ready});
}

module.exports={mountD15Routes};
