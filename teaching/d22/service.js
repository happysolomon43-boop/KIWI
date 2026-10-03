'use strict';

const {
  TPF08,TPF18,TEACHER_CODE,SAFE_PROFILE_LIBRARY,profileForPreference,displayNameFromApprovedPool,
  buildStyleEnvelope,normalizeInteractionProfile,contextualStyle,evidenceSpecificPraise,
  accountabilityMessage,shortStyleDescription,teacherChangeTransition,cleanString,fail,
} = require('./contracts');

const DEFAULT_TRAITS=SAFE_PROFILE_LIBRARY.BALANCED;

function createD22Service({repository,d10Service,intelligence=null,randomUUID}={}){
  if(!repository)throw new TypeError('D22 service requires Teacher Identity repository.');
  if(!d10Service)throw new TypeError('D22 service requires the existing D10 Request/Course lifecycle owner.');
  if(typeof randomUUID!=='function')throw new TypeError('D22 service requires randomUUID().');

  function traitsFromVersion(version){
    if(!version)return DEFAULT_TRAITS;
    return Object.freeze({warmth:version.warmth,directness:version.directness,formality:version.formality,expressiveness:version.expressiveness,humor_frequency:version.humor_frequency,encouragement_intensity:version.encouragement_intensity,challenge_style:version.challenge_style,accountability_style:version.accountability_style,conversationality:version.conversationality});
  }
  async function resolveAssignment(studentId,courseId,{
    hydrateIdentity=true,hydrateFamiliarity=true,
    familiarityLevel='new',familiaritySourceKind='INITIAL_ASSIGNMENT',familiaritySourceRef=null,
  }={}){
    const current=await repository.currentAssignment(studentId,courseId);if(!current)return null;
    let version=current.version;
    if(!version&&hydrateIdentity)version=await repository.hydrateIdentityIfNeeded({studentId,teacherIdentityId:current.assignment.teacher_identity_id,traits:DEFAULT_TRAITS,displayName:current.assignment.display_name});
    let familiarity=current.familiarity;
    if(!familiarity&&hydrateFamiliarity)familiarity=await repository.ensureFamiliarity({studentId,teacherAssignmentId:current.assignment.teacher_assignment_id,initialLevel:familiarityLevel,sourceKind:familiaritySourceKind,sourceRef:familiaritySourceRef});
    return {...current,version,familiarity};
  }
  function styleEnvelope(resolved){
    if(!resolved?.assignment||!resolved?.version)throw fail('Teacher Identity is not fully initialized.','TEACHING_D22_IDENTITY_NOT_INITIALIZED',409);
    return buildStyleEnvelope({teacherIdentityRef:resolved.assignment.teacher_identity_id,coreTraits:traitsFromVersion(resolved.version),familiarityLevel:resolved.familiarity?.familiarity_level||'new'});
  }
  async function createProductIdentity(studentId,{broadStylePreference=null,generationMode='D22_DETERMINISTIC_POLICY'}={}){
    const selection=profileForPreference(broadStylePreference,{randomUUID});
    const displayName=displayNameFromApprovedPool(randomUUID);
    const created=await repository.createIdentity({studentId,displayName,traits:selection.traits,broadStylePreference:selection.preference,presentationMetadata:{display_name:displayName,avatar_ref:null,voice_ref:null,gender_presentation:null,display_name_policy:'APPROVED_POOL_ONLY'},generationMode,influenceTrace:[{influence:'KIWI_DEFAULTS',effect:'safe coherent profile library'},{influence:selection.fit,effect:selection.preference==='surprise_me'?'no explicit student style override':'product-configured broad preference mapping'},{influence:'PRODUCT_PRESENTATION_POLICY',effect:'approved display name only'}],promptLineage:null});
    return {...created,selection};
  }

  async function ensureTeacher(user,courseId,input={}){
    const course=await repository.ensureCourse(user.id,courseId);
    let resolved=await resolveAssignment(user.id,courseId);
    if(resolved)return teacherSurface(user,courseId,{resolved});

    const continuity=await repository.continuityCandidate(user.id,courseId);
    let teacherIdentityId=null,continuitySource=null;
    if(continuity?.assignment?.teacher_identity_id){
      teacherIdentityId=continuity.assignment.teacher_identity_id;
      continuitySource=continuity;
    }else{
      const created=await createProductIdentity(user.id,{broadStylePreference:input.broadStylePreference||null});
      teacherIdentityId=created.identity.teacher_identity_id;
    }
    await d10Service.prepareAcademicRules(user,courseId,{teacherIdentityId});
    resolved=await resolveAssignment(user.id,courseId,{hydrateIdentity:true,hydrateFamiliarity:false});
    if(!resolved)throw fail('D10 did not establish the Teacher assignment.','TEACHING_D22_ASSIGNMENT_NOT_CREATED',500);
    if(!resolved.familiarity){
      const sourceLevel=continuitySource?.familiarity?.familiarity_level||'new';
      await repository.ensureFamiliarity({studentId:user.id,teacherAssignmentId:resolved.assignment.teacher_assignment_id,initialLevel:sourceLevel,sourceKind:continuitySource?.sourceKind||'INITIAL_ASSIGNMENT',sourceRef:continuitySource?`course:${continuitySource.sourceCourseId}`:null});
      resolved=await resolveAssignment(user.id,courseId);
    }
    return teacherSurface(user,courseId,{resolved,course});
  }

  async function teacherSurface(user,courseId,{resolved=null,course=null}={}){
    course=course||await repository.ensureCourse(user.id,courseId);
    resolved=resolved||await resolveAssignment(user.id,courseId);
    const interactionRow=await repository.interactionProfile(user.id,courseId);
    const interaction=normalizeInteractionProfile(interactionRow?.preferences||{});
    const history=await repository.assignmentHistory(user.id,courseId);
    let pending=[];
    if(typeof d10Service.listRequests==='function'){
      const requests=await d10Service.listRequests(user,{courseId});
      pending=requests.filter((r)=>r.type==='TEACHER_CHANGE'&&!['CLOSED','REJECTED','WITHDRAWN'].includes(r.state));
    }
    if(!resolved){
      return Object.freeze({courseId,courseTitle:course.title,teacher:null,setupRequired:true,aiDisclosure:'Your Course Teacher is an AI teacher in KIWI Teaching.',teacherCode:TEACHER_CODE,interactionProfile:interaction,pendingTeacherChanges:Object.freeze(pending),academicAuthority:Object.freeze({teacherIdentity:'presentation_only',marks:'D20_GRADEBOOK',pedagogy:'D12_PEDAGOGY',coursePlan:'D08',schedule:'D09',attendance:'D15',progression:'D21',request:'D10'}),outsideClassQuestions:Object.freeze({available:Boolean(intelligence?.outsideClassQuestion),routeQualification:intelligence?.outsideClassQuestion?'QUALIFIED_BY_RUNTIME_INJECTION':'UNQUALIFIED_UNTIL_D30'})});
    }
    const envelope=styleEnvelope(resolved);
    return Object.freeze({
      courseId,courseTitle:course.title,setupRequired:false,
      teacher:Object.freeze({teacherIdentityId:resolved.assignment.teacher_identity_id,assignmentId:resolved.assignment.teacher_assignment_id,assignmentVersion:Number(resolved.assignment.version_no),identityVersion:Number(resolved.version.version_no),displayName:resolved.assignment.display_name,aiDisclosure:'This is an AI Teacher in KIWI Teaching.',styleDescription:shortStyleDescription(envelope),styleEnvelopeVersion:TPF08.styleEnvelopeVersion,styleEnvelope:envelope,presentationMetadata:Object.freeze(resolved.version.presentation_metadata||{}),effectiveFrom:resolved.assignment.effective_from,sourceRequestId:resolved.assignment.source_request_id||null}),
      interactionProfile:interaction,teacherCode:TEACHER_CODE,
      continuity:Object.freeze({assignmentHistory:Object.freeze(history.map((h)=>Object.freeze({assignmentId:h.teacher_assignment_id,version:Number(h.version_no),teacherIdentityId:h.teacher_identity_id,displayName:h.display_name,effectiveFrom:h.effective_from,effectiveTo:h.effective_to||null,sourceRequestId:h.source_request_id||null}))),historicalRecordsPreserved:true,fabricatedSharedMemoryForbidden:true,familiarityInferredFromAgeOrMessageCount:false}),
      pendingTeacherChanges:Object.freeze(pending),
      outsideClassQuestions:Object.freeze({available:Boolean(intelligence?.outsideClassQuestion),routeQualification:intelligence?.outsideClassQuestion?'QUALIFIED_BY_RUNTIME_INJECTION':'UNQUALIFIED_UNTIL_D30'}),
      academicAuthority:Object.freeze({teacherIdentity:'presentation_only',marks:'D20_GRADEBOOK',pedagogy:'D12_PEDAGOGY',coursePlan:'D08',schedule:'D09',attendance:'D15',progression:'D21',request:'D10'}),
    });
  }

  async function interactionContext(user,courseId,{register='NORMAL'}={}){
    const course=await repository.ensureCourse(user.id,courseId);const resolved=await resolveAssignment(user.id,courseId);if(!resolved)throw fail('Course Teacher is not initialized.','TEACHING_D22_IDENTITY_NOT_INITIALIZED',409);
    const preferences=await repository.interactionProfile(user.id,courseId);const profile=normalizeInteractionProfile(preferences?.preferences||{});const envelope=styleEnvelope(resolved);
    return Object.freeze({course:Object.freeze({course_id:course.course_id,lifecycle_state:course.lifecycle_state,state_version:Number(course.state_version||0)}),teacherStyleEnvelope:envelope,effectiveStyle:contextualStyle(envelope,register),studentInteractionProfile:profile,teacherCode:TEACHER_CODE,precedence:Object.freeze(['authoritative_domain_rules','Teaching_Constitution','Controller_or_Interaction_Directive','TPF-08','Teacher_Identity_style','Student_Interaction_Profile']),academicTruthMutationAllowed:false});
  }

  async function updateInteractionProfile(user,courseId,input={}){
    const resolved=await resolveAssignment(user.id,courseId);if(!resolved)throw fail('Course Teacher is not initialized.','TEACHING_D22_IDENTITY_NOT_INITIALIZED',409);
    const normalized=normalizeInteractionProfile(input);
    await repository.saveInteractionProfile({studentId:user.id,courseId,teacherIdentityId:resolved.assignment.teacher_identity_id,preferences:normalized});
    return teacherSurface(user,courseId,{resolved});
  }

  async function requestTeacherChange(user,courseId,input={}){
    const current=await resolveAssignment(user.id,courseId);if(!current)throw fail('Current Course Teacher must be initialized before requesting a change.','TEACHING_D22_IDENTITY_NOT_INITIALIZED',409);
    const idempotencyKey=cleanString(input.idempotencyKey,'idempotencyKey',{max:160});
    const prior=await repository.findTeacherChangeRequestByIdempotency(user.id,courseId,idempotencyKey);
    if(prior){
      const request=await d10Service.getRequest(user,prior.request_id);
      const priorTeacherId=prior.requested_change?.teacherIdentityId||prior.requested_change?.teacher_identity_id||null;
      const replacement=priorTeacherId?await repository.identityById(user.id,priorTeacherId):null;
      if(!replacement)throw fail('Existing Teacher Change Request lost its replacement Teacher binding.','TEACHING_D22_CHANGE_IDEMPOTENCY_BINDING_INVALID',409);
      const envelope=buildStyleEnvelope({teacherIdentityRef:replacement.identity.teacher_identity_id,coreTraits:traitsFromVersion(replacement.version),familiarityLevel:'new'});
      return Object.freeze({request,replacementTeacher:Object.freeze({teacherIdentityId:replacement.identity.teacher_identity_id,displayName:replacement.identity.display_name,styleEnvelope:envelope}),academicStateChanged:false,approvalOwner:'D10_REQUEST',idempotent:true});
    }
    const course=await repository.ensureCourse(user.id,courseId);
    const replacement=await createProductIdentity(user.id,{course,broadStylePreference:input.broadStylePreference||'surprise_me'});
    if(replacement.identity.teacher_identity_id===current.assignment.teacher_identity_id)throw fail('Replacement Teacher must differ from the current Teacher.','TEACHING_D22_TEACHER_CHANGE_NOOP',409);
    const request=await d10Service.createRequest(user,{type:'TEACHER_CHANGE',courseId,requestedChange:{teacherIdentityId:replacement.identity.teacher_identity_id},explanation:input.explanation||'Student requested a Teacher change from the Teacher surface.',idempotencyKey});
    return Object.freeze({request,replacementTeacher:Object.freeze({teacherIdentityId:replacement.identity.teacher_identity_id,displayName:replacement.identity.display_name,styleEnvelope:buildStyleEnvelope({teacherIdentityRef:replacement.identity.teacher_identity_id,coreTraits:replacement.selection.traits,familiarityLevel:'new'})}),academicStateChanged:false,approvalOwner:'D10_REQUEST',idempotent:false});
  }

  async function transitionForRequest(user,requestId){
    const row=await repository.requestAndAssignment(user.id,requestId);if(!row)throw fail('Teacher Change Request not found.','TEACHING_D22_REQUEST_NOT_FOUND',404);
    if(row.request_type!=='TEACHER_CHANGE')throw fail('Request is not a Teacher Change.','TEACHING_D22_REQUEST_TYPE_INVALID',400);
    if(!['APPLIED','CLOSED'].includes(row.lifecycle_state)||!row.teacher_assignment_id)throw fail('Teacher Change has not been authoritatively applied by D10.','TEACHING_D22_TEACHER_CHANGE_NOT_APPLIED',409);
    await repository.ensureFamiliarity({studentId:user.id,teacherAssignmentId:row.teacher_assignment_id,initialLevel:'new',sourceKind:'INITIAL_ASSIGNMENT',sourceRef:`request:${requestId}`});
    const resolved=await resolveAssignment(user.id,row.course_id);
    const transition=teacherChangeTransition({displayName:row.display_name||resolved?.assignment?.display_name||'Your new Teacher',requestId});
    return Object.freeze({...transition,courseId:row.course_id,teacherIdentityId:row.teacher_identity_id,assignmentId:row.teacher_assignment_id,assignmentVersion:Number(row.assignment_version),styleEnvelope:resolved?styleEnvelope(resolved):null,transitionOwner:'D22_PRESENTATION_AFTER_D10_APPLICATION'});
  }

  async function askOutsideClass(user,courseId,input={}){
    const question=cleanString(input.question,'question',{max:4000});
    const ctx=await interactionContext(user,courseId,{register:'NORMAL'});
    if(!intelligence?.outsideClassQuestion)return Object.freeze({status:'ROUTE_HELD',routeQualification:'UNQUALIFIED_UNTIL_D30',questionAccepted:true,answer:null,teacherStyleEnvelope:ctx.teacherStyleEnvelope,studentInteractionProfile:ctx.studentInteractionProfile,academicStateChanged:false});
    const key=String(input.idempotencyKey||`d22-outside-q:${courseId}:${randomUUID()}`);
    const result=await intelligence.outsideClassQuestion({studentId:user.id,course:ctx.course,teacherStyleEnvelope:ctx.teacherStyleEnvelope,studentInteractionProfile:ctx.studentInteractionProfile,interactionDirective:{academic_mode:'OUTSIDE_CLASS_QA',approved_action:'ANSWER_COURSE_QUESTION',allowed_interaction_kinds:['EXPLAIN','CLARIFY','ORGANIZE'],assessment_help_prohibited:true,academic_state_mutation_prohibited:true},input:{question},requestKey:key});
    if(!result?.accepted||!result?.validatedResult?.output)return Object.freeze({status:'HANDOFF_REQUIRED',answer:null,academicStateChanged:false,reason:result?.reason||'MODEL_RESULT_NOT_ACCEPTED'});
    return Object.freeze({status:'ANSWER_READY',answer:result.validatedResult.output,academicStateChanged:false});
  }

  async function praise(user,courseId,evidenceDescription){const ctx=await interactionContext(user,courseId);return Object.freeze({message:evidenceSpecificPraise({evidenceDescription,envelope:ctx.teacherStyleEnvelope}),evidenceSpecific:true,academicStateChanged:false});}
  async function accountability(user,courseId,{authoritativeFact,requiredAction}){const ctx=await interactionContext(user,courseId);return Object.freeze({message:accountabilityMessage({authoritativeFact,requiredAction,envelope:ctx.teacherStyleEnvelope}),arbitraryPunishment:false,academicRuleChanged:false});}

  return Object.freeze({ensureTeacher,teacherSurface,interactionContext,updateInteractionProfile,requestTeacherChange,transitionForRequest,askOutsideClass,praise,accountability,recordAuthorizedFamiliarity:repository.recordAuthorizedFamiliarity});
}

module.exports={createD22Service};
