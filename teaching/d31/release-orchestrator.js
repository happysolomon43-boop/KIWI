'use strict';

const { createTeachingAIAdapter, createTeachingOrchestrator, createOrchestratorPreflight, createAuthoritativeOwnerRouter } = require('../orchestrator');
const { buildSeparatedContextLanes, asUntrustedData } = require('../security/context-lanes');
const { centralTaskFor } = require('../d30/route-policy');

function fail(message, code = 'TEACHING_D31_RELEASE_CONTEXT_UNAVAILABLE') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

// Pure, authenticated readers shared by the owner-authorized release and tests.
function createD31ReleaseReaders({query}={}) {
  if(typeof query!=='function')throw new TypeError('D31 release readers require query().');

  async function courseFor(actorId,courseId){
    if(!actorId||!courseId)fail('Authenticated Course context is required.');
    const {rows=[]}=await query('select * from public.teaching_courses where student_id=$1 and course_id=$2',[actorId,courseId]);
    if(!rows[0])fail('Course context was not found.','TEACHING_COURSE_NOT_FOUND');
    return rows[0];
  }
  async function classFor(actorId,classId){
    if(!actorId||!classId)fail('Authenticated Class context is required.');
    const {rows=[]}=await query(
      'select c.* from public.teaching_classes c join public.teaching_courses co on co.student_id=c.student_id and co.course_id=c.course_id where c.student_id=$1 and c.class_id=$2',
      [actorId,classId]);
    if(!rows[0])fail('Class context was not found.','TEACHING_CLASS_NOT_FOUND');
    return rows[0];
  }
  async function latestPlan(actorId,courseId){
    const {rows=[]}=await query("select * from public.teaching_course_plans where student_id=$1 and course_id=$2 and plan_state<>'SUPERSEDED' order by version_no desc limit 1",[actorId,courseId]);
    return rows[0]||null;
  }
  async function stateReader(envelope){
    const type=envelope?.state_reference?.aggregate_type,id=envelope?.state_reference?.aggregate_id,actorId=envelope?.trigger?.actor_id;
    if(type==='teaching_course'){
      const course=await courseFor(actorId,id);
      const fields={lifecycle_state:course.lifecycle_state,subject_snapshot_ref:course.subject_snapshot_ref||null};
      return {
        stateReference:{aggregate_type:type,aggregate_id:course.course_id,state_version:String(course.state_version)},
        preconditions:Object.fromEntries(Object.keys(envelope.preconditions||{}).map(key=>[key,fields[key]])),
      };
    }
    if(type==='teaching_class_controller'){
      const classRow=await classFor(actorId,id);
      const [course,plan,sessionRows]=await Promise.all([
        courseFor(actorId,classRow.course_id),
        latestPlan(actorId,classRow.course_id),
        query('select state_version,lifecycle_state from public.teaching_class_sessions where student_id=$1 and class_id=$2 order by created_at desc limit 1',[actorId,id])
      ]);
      const session=sessionRows.rows?.[0]||null;
      const fields={
        course_lifecycle_state:course.lifecycle_state,
        course_state_version:String(course.state_version),
        class_schedule_version:String(classRow.schedule_version),
        course_plan_id:plan?.course_plan_id||null,
        course_plan_version:plan?.version_no==null?null:String(plan.version_no),
        controller_version:session?.state_version==null?null:String(session.state_version),
      };
      return {
        stateReference:{aggregate_type:type,aggregate_id:classRow.class_id,state_version:session?String(session.state_version):String(classRow.schedule_version)},
        preconditions:Object.fromEntries(Object.keys(envelope.preconditions||{}).map(key=>[key,fields[key]])),
      };
    }
    fail('D31 release cannot authorize an unsupported academic state owner.');
  }
  async function contextAssembler({contextSpec={},accessContext={}}={}){
    const {actorId,aggregateType,classId}=accessContext;
    const boundClass=aggregateType==='teaching_class_controller'?await classFor(actorId,classId):null;
    const courseId=boundClass?.course_id||accessContext.courseId;
    const course=await courseFor(actorId,courseId);
    const trusted={},provenance=[],untrusted=[];
    async function read(ref){
      const value=String(ref?.ref||''),separator=value.indexOf(':');
      const kind=value.slice(0,separator),id=value.slice(separator+1);
      if(!id)fail('A Course context reference is missing its identity.');
      if(kind==='student-question') {
        if(!boundClass)fail('Student questions are only permitted in an authenticated Class.');
        const {rows=[]}=await query("select interaction_id,interaction_kind,body,created_at from public.teaching_classroom_interactions where student_id=$1 and class_id=$2 and interaction_id=$3 and interaction_kind in ('ASK_TEACHER','NEED_HELP')",[actorId,boundClass.class_id,id]);
        if(!rows[0])fail('Raised-hand question not found in this Class.');
        return {kind,value:rows[0]};
      }
      if(kind==='lesson-blueprint'){
        if(!boundClass)fail('Lesson blueprint requires an authenticated Class.');
        const {rows=[]}=await query("select lesson_blueprint_id,version_no,blueprint_state,objective_summary,blueprint_payload,planned_learning_unit_refs from public.teaching_lesson_blueprints where student_id=$1 and class_id=$2 and lesson_blueprint_id=$3 and blueprint_state='VALIDATED'",[actorId,boundClass.class_id,id]);
        if(!rows[0])fail('Qualified Class lesson blueprint not found.');
        return {kind,value:rows[0]};
      }
      if(kind==='course'&&id===String(course.course_id))return {kind,value:course};
      if(kind==='class'){
        if(!boundClass||id!==String(boundClass.class_id))fail('Class context is outside the authenticated active Class.');
        return {kind,value:boundClass};
      }
      const sources={
        'course-plan':['public.teaching_course_plans','course_plan_id'],
        source:['public.teaching_source_content_items','source_content_item_id'],
        'curriculum-audit':['public.teaching_curriculum_audits','curriculum_audit_id'],
        'diagnostic-plan':['public.teaching_diagnostic_plans','diagnostic_plan_id'],
        vpk:['public.teaching_validated_prior_knowledge_decisions','vpk_decision_id'],
        intake:['public.teaching_student_course_intakes','intake_id'],
        'class-closure':['public.teaching_class_closure_facts','closure_fact_id'],
        'teacher-note':['public.teaching_post_class_teacher_notes','teacher_note_id'],
      };
      const target=sources[kind];
      if(!target)fail('Unsupported Course context reference: '+kind);
      const {rows=[]}=await query('select * from '+target[0]+' where student_id=$1 and course_id=$2 and '+target[1]+'=$3',[actorId,course.course_id,id]);
      if(!rows[0])fail('Course context reference is unavailable: '+kind);
      if(kind==='course-plan'&&boundClass){
        const current=await latestPlan(actorId,course.course_id);
        if(!current||String(current.course_plan_id)!==id)fail('Class planning must use the current Course Plan.');
      }
      return {kind,value:rows[0]};
    }
    for(const ref of contextSpec.authoritative_refs||[]){
      const item=await read(ref);
      if(item.kind==='source'||item.kind==='intake')fail('Student content cannot enter the authoritative context lane.');
      trusted[ref.ref]=item.value;
    }
    for(const ref of contextSpec.provenance_refs||[]){
      const item=await read(ref);
      if(item.kind==='source'&&['PRIMARY_STUDY_NOTE','STUDENT_SUPPLEMENT'].includes(item.value.source_kind))fail('Original notes and supplements must remain untrusted data.');
      provenance.push({ref:ref.ref,data:item.value});
    }
    for(const ref of contextSpec.untrusted_refs||[]){
      const item=await read(ref);
      untrusted.push(asUntrustedData({kind:['intake','student-question'].includes(item.kind)?'student_response':'uploaded_material',data:item.value,provenance:{ref:ref.ref}}));
    }
    if((contextSpec.permission_refs||[]).length)fail('Permission context requires a dedicated authorized reader.');
    return buildSeparatedContextLanes({trustedAuthoritativeState:trusted,permissionConstraints:{},provenanceLinkedAcademicContent:provenance,untrustedContent:untrusted});
  }
  return Object.freeze({stateReader,contextAssembler});
}

function createD31ReleaseOrchestrator({ runtimePlatform, query, randomUUID } = {}) {
  if (typeof query !== 'function' || typeof randomUUID !== 'function' ||
      !runtimePlatform?.orchestrationStore || !runtimePlatform?.promptControl || !runtimePlatform?.aiBoundary) {
    fail('D31 release requires the durable D05 runtime, prompt control, and an authenticated context reader.', 'TEACHING_D31_ORCHESTRATOR_REQUIRED');
  }

  const {stateReader,contextAssembler}=createD31ReleaseReaders({query});

  const aiAdapter = createTeachingAIAdapter({
    promptControl: runtimePlatform.promptControl,
    aiBoundary: runtimePlatform.aiBoundary,
    assertRouteExecutable: () => true, // The exact D31 owner mode authorizes execution; D30 qualification truth remains unchanged.
    // Production Teaching execution intentionally shares the exact MAIN_CBT
    // candidate order and provider fallback behaviour. Preparation posture is
    // qualification metadata; applying it here silently narrows MAIN_CBT to a
    // different model family than the working CBT route.
    resolveCentralTaskId: async (route) => centralTaskFor({
      capabilityId: route.capabilityId,
      familyId: route.familyId,
    }),
  });
  const orchestrator = createTeachingOrchestrator({
    promptControl: runtimePlatform.promptControl,
    aiAdapter,
    executionStore: runtimePlatform.orchestrationStore,
    stateReader,
    contextAssembler: { assemble: contextAssembler },
    preflight: createOrchestratorPreflight(),
    ownerRouter: createAuthoritativeOwnerRouter(),
    randomUUID,
  });
  return Object.freeze({
    execute(request) {
      return orchestrator.execute({
        ...request,
        accessContext: {
          actorId:request?.trigger?.actor_id,
          aggregateType:request?.stateReference?.aggregate_type,
          courseId:request?.stateReference?.aggregate_type==='teaching_course'?request.stateReference.aggregate_id:null,
          classId:request?.stateReference?.aggregate_type==='teaching_class_controller'?request.stateReference.aggregate_id:null,
        },
      });
    },
  });
}

module.exports = { createD31ReleaseOrchestrator,createD31ReleaseReaders };
