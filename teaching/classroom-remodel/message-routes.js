'use strict';
function mountClassroomMessageRoutes(router,{service}={}){
 if(!service)return {registered:false};
 for(const [method,path,handler]of [['post','messages',req=>service.admit(req.user,req.params.id,req.body)],['get','questions',req=>service.questions(req.user,req.params.id)]])router[method]('/classes/:id/classroom/'+path,async(req,res)=>{try{res.set('Cache-Control','private, no-store').status(method==='post'?201:200).json(await handler(req));}catch(e){res.status(Number(e.status)||500).json({code:/^CLASSROOM_[A-Z_]+$/.test(e.code||'')?e.code:'CLASSROOM_MESSAGE_REQUEST_FAILED'});}});
 return {registered:true,qualified:false};
}
module.exports={mountClassroomMessageRoutes};
