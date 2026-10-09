'use strict';
const {createClassroomAcademicRepository}=require('../repositories/classroom-academic-artifacts');
const {createClassroomPreparationService}=require('./preparation-service');
const {createClassroomPreparationIntelligence}=require('./preparation-intelligence');
const {validateBlock}=require('../d14/board');
const {fail}=require('./contracts');

// Reuses the established runtime/owners. Adoption readers and review routes
// must be supplied by server configuration; absence is a scoped hold, never
// an inferred numerical or academic policy.
function createClassroomPreparationRuntime({query,withTransaction,randomUUID,d11Repository,d11Service,preparationRepository,orchestrator,requirementsReader,releaseGate,independentReviewService,assetReader,clock}={}) {
 const repository=createClassroomAcademicRepository({query,withTransaction,randomUUID});
 const intelligence=createClassroomPreparationIntelligence({orchestrator,repository,d11Repository});
 const boardTypes={equations:'equation',worked_steps:'worked_solution',sources:'source_passage',student_work_annotation:'annotation'};
 const service=createClassroomPreparationService({repository,d11Repository,preparationRepository,intelligence,clock,releaseGate,
  getRequirements:async context=>{
   if(typeof requirementsReader!=='function')fail('CLASSROOM_APPROVED_PREPARATION_CONFIG_MISSING');
   const requirements=await requirementsReader(context);
   if(!requirements?.version||!requirements?.adoptionRef||!requirements.scope?.version||!Array.isArray(requirements.sourceMaterial)||!requirements.sourceMaterial.length||!requirements.numericPolicy?.version)fail('CLASSROOM_APPROVED_PREPARATION_CONFIG_MISSING');
   if(requirements.sourceMaterial.some(s=>s.protected===true||!s.version||!s.sourceRef))fail('CLASSROOM_SOURCE_AUTHORITY_INVALID');
   const signals=await d11Repository.getPlanningSignals(context.classRow.student_id,context.classRow);
   return {...requirements,signals,verifiedHistory:{priorClassFacts:signals.priorClassFacts||[],teacherNotes:signals.teacherNotes||[],missingHistoryIsNegativeEvidence:false}};
  },
  reviewArtifact:async args=>{if(typeof independentReviewService?.reviewArtifact!=='function')fail('CLASSROOM_INDEPENDENT_REVIEW_ROUTE_MISSING');return independentReviewService.reviewArtifact(args);},
  reviewWholeArtifact:async args=>{if(typeof independentReviewService?.reviewWholeArtifact!=='function')fail('CLASSROOM_WHOLE_REVIEW_ROUTE_MISSING');return independentReviewService.reviewWholeArtifact(args);},
  acceptBlueprint:args=>d11Service.acceptClassroomBlueprint(args),
  finalizePpl:args=>d11Service.finalizeClassroomPreparation(args),
  currentDependencyVersion:async dependency=>{
   if(dependency.dependency_kind==='source')return (await query('select source_version_ref from public.teaching_source_content_items where source_content_item_id=$1 and student_id=$2 and superseded_at is null',[dependency.aggregate_ref.replace(/^source:/,''),dependency.student_id])).rows?.[0]?.source_version_ref||null;
   return d11Repository.currentDependencyVersion(dependency);
  },
  assetReadiness:async({opening,chapter,context})=>{
   const assets=[];for(const block of opening.payload.board){validateBlock({type:boardTypes[block.type]||block.type,content:block.content});if(block.content.assetId)assets.push(block.content.assetId);}
   for(const unit of chapter.payload.units)for(const element of unit.elements)if(element.asset_ref)assets.push(element.asset_ref.id);
   if(!assets.length)return {ready:true,owner:'D14',representations:[]};
   if(typeof assetReader!=='function')return {ready:false,hold:'D14_ASSET_OWNER_UNAVAILABLE'};
   return assetReader({studentId:context.classRow.student_id,classId:context.classRow.class_id,assets:[...new Set(assets)]});
  },
 });
 return Object.freeze({repository,service,intelligence,activation:'INACTIVE',productionQualified:false});
}
module.exports={createClassroomPreparationRuntime};
