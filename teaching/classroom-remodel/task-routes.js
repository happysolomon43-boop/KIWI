'use strict';
function mountClassroomTaskRoutes(router,{service}={}){
 if(!service)return {registered:false};
 for(const [path,method]of [['task-responses','submit'],['task-extensions','extend'],['task-support','support'],['tasks/:taskId/responses','submit'],['tasks/:taskId/extensions','extend'],['tasks/:taskId/support','support']])router.post('/classes/:id/classroom/'+path,async(req,res)=>{try{if(req.params.taskId&&req.params.taskId!==req.body?.taskId)throw Object.assign(Error('Task URL and command disagree'),{code:'CLASSROOM_TASK_TARGET_MISMATCH',status:422});res.set('Cache-Control','private, no-store').status(201).json(await service[method](req.user,req.params.id,req.body));}catch(e){res.status(Number(e.status)||500).json({code:/^CLASSROOM_[A-Z_]+$/.test(e.code||'')?e.code:'CLASSROOM_TASK_REQUEST_FAILED'});}});
 return {registered:true};
}
module.exports={mountClassroomTaskRoutes};
