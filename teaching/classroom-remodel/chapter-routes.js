'use strict';
// Called only from the existing authenticated Teaching router. The service
// independently verifies the server session pin and accepted artifact binding.
function mountClassroomChapterRoute(router,{service,sendError}){
 if(!service||typeof service.getPublicChapter!=='function')return {registered:false,qualified:false};
 router.get('/classes/:id/classroom/chapter',async(req,res)=>{
  try{res.json(await service.getPublicChapter(req.user,req.params.id));}
  catch(error){sendError(res,error,'The prepared chapter is unavailable for this session.');}
 });
 return {registered:true,qualified:false};
}
module.exports={mountClassroomChapterRoute};
