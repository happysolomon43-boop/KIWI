'use strict';
const DISMISSIBLE_ARTIFACT_TYPES=new Set(['STUDY_PACK','NOTE','ANNOTATION','CARD_REFERENCE','CARD_CANDIDATE']);
function mountD28Routes(router,{service,sendError}={}){
  if(!router||!service)return null;
  router.get('/operations/d28/status',async(req,res)=>{try{res.json(service.status());}catch(e){sendError(res,e,'Failed to load D28 operational status.');}});
  router.get('/operations/d28/audit-dashboard',async(req,res)=>{try{res.json(await service.operationalDashboard(req.user,{hours:req.query.hours}));}catch(e){sendError(res,e,'Failed to load D28 operational dashboard.');}});
  router.post('/study-artifacts/:artifactType/:artifactId/dismiss',async(req,res)=>{try{const artifactType=String(req.params.artifactType||'').toUpperCase();if(!DISMISSIBLE_ARTIFACT_TYPES.has(artifactType))return res.status(400).json({error:'Unsupported student-facing artifact type.',code:'TEACHING_D28_ARTIFACT_TYPE_INVALID'});res.json(await service.suppressArtifact(req.user,{studentId:req.user.id,artifactType,artifactId:String(req.params.artifactId),courseId:req.body?.courseId||null,subjectId:req.body?.subjectId||null,reasonCode:req.body?.reasonCode||'STUDENT_DISMISSED',sourceOwner:req.body?.sourceOwner||'TEACHING',sourceVersion:req.body?.sourceVersion||null}));}catch(e){sendError(res,e,'Study artifact could not be dismissed safely.');}});
  return Object.freeze({mounted:true,readOnlyOperationalDashboard:true,studentDismissalAcademicMutation:false});
}
module.exports={mountD28Routes};
