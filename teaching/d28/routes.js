'use strict';
const express=require('express');
const {extractValidatedMaterial}=require('./material-upload');
const DISMISSIBLE_ARTIFACT_TYPES=new Set(['STUDY_PACK','NOTE','ANNOTATION','CARD_REFERENCE','CARD_CANDIDATE']);

function decodedFilename(value){
  const raw=String(value||'').trim();
  if(!raw)return '';
  try{return decodeURIComponent(raw);}catch{return raw;}
}

function uploadMime(req){
  return String(req.headers?.['content-type']||'application/octet-stream').split(';')[0].trim().toLowerCase();
}

function mountD28Routes(router,{service,sendError}={}){
  if(!router||!service)return null;

  // D28 validates and extracts binary supplementary material. It deliberately
  // does not persist academic source truth: D07 remains the owner that binds
  // the returned extracted text + provenance to a Course source inventory.
  router.post('/materials/extract',express.raw({type:()=>true,limit:'10mb'}),async(req,res)=>{
    try{
      const filename=decodedFilename(req.headers?.['x-kiwi-filename']);
      if(!filename)return res.status(400).json({error:'Teaching material filename is required.',code:'TEACHING_D28_UPLOAD_FILENAME_REQUIRED'});
      const bytes=Buffer.isBuffer(req.body)?req.body:Buffer.alloc(0);
      const extracted=await extractValidatedMaterial({filename,mimeType:uploadMime(req),bytes});
      return res.json(extracted);
    }catch(e){return sendError(res,e,'Teaching material could not be extracted safely.');}
  });

  router.get('/operations/d28/status',async(req,res)=>{try{res.json(service.status());}catch(e){sendError(res,e,'Failed to load D28 operational status.');}});
  router.get('/operations/d28/audit-dashboard',async(req,res)=>{try{res.json(await service.operationalDashboard(req.user,{hours:req.query.hours}));}catch(e){sendError(res,e,'Failed to load D28 operational dashboard.');}});
  router.post('/study-artifacts/:artifactType/:artifactId/dismiss',async(req,res)=>{try{const artifactType=String(req.params.artifactType||'').toUpperCase();if(!DISMISSIBLE_ARTIFACT_TYPES.has(artifactType))return res.status(400).json({error:'Unsupported student-facing artifact type.',code:'TEACHING_D28_ARTIFACT_TYPE_INVALID'});res.json(await service.suppressArtifact(req.user,{studentId:req.user.id,artifactType,artifactId:String(req.params.artifactId),courseId:req.body?.courseId||null,subjectId:req.body?.subjectId||null,reasonCode:req.body?.reasonCode||'STUDENT_DISMISSED',sourceOwner:req.body?.sourceOwner||'TEACHING',sourceVersion:req.body?.sourceVersion||null}));}catch(e){sendError(res,e,'Study artifact could not be dismissed safely.');}});
  return Object.freeze({mounted:true,readOnlyOperationalDashboard:true,studentDismissalAcademicMutation:false,materialExtractionAcademicMutation:false});
}
module.exports={mountD28Routes};
