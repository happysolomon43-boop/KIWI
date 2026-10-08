'use strict';
const {createHash}=require('node:crypto');
const {normalizeVisualIntent}=require('./visual-intent');
const {inspectGeneratedImage,sanitizeSvg}=require('../../services/ai/visual-contracts');
const {createGenerativeImageBoardBlock,createStructuredDiagramBoardBlock,createVisualBoardFallback}=require('./visual-board-contract');
const MODES=new Set(['OPENING','DIAGNOSTIC','INSTRUCTION','GUIDED_PRACTICE','INDEPENDENT_PRACTICE','REMEDIATION']);
function binding(ctx) {
  return JSON.stringify([ctx.classRow?.class_id,ctx.classRow?.course_id,ctx.classRow?.course_state_version,ctx.classRow?.schedule_version,ctx.classRow?.source_timetable_version_id,ctx.session?.class_session_id,ctx.session?.state_version,ctx.session?.instructional_substate,ctx.session?.progress_state?.current_learning_unit_ref,ctx.plan?.course_plan_id,ctx.plan?.version_no,ctx.blueprint?.lesson_blueprint_id,ctx.blueprint?.version_no]);
}
function permitted(ctx) {
  return ctx.classRow?.lifecycle_state==='SCHEDULED'&&ctx.classRow?.course_lifecycle_state==='ACTIVE'&&ctx.classRow?.source_timetable_state==='APPROVED'&&ctx.session?.lifecycle_state==='ACTIVE'&&MODES.has(ctx.session.instructional_substate)&&ctx.blueprint?.blueprint_state==='VALIDATED';
}
function stale(){return Object.assign(new Error('Classroom visual authority changed.'),{code:'TEACHING_D14_TEACHER_TURN_STALE',status:409});}
function createD14VisualService({ai,repository,readContext,revocations,deadlineMs=25000}={}) {
  if(!ai||!repository||typeof readContext!=='function'||!revocations?.read)throw new TypeError('Classroom visuals require central AI, private persistence and authoritative readers.');
  function capabilities(){const s=ai.capabilityStatus?.()||{};return {imageGeneration:Boolean(s.imageGeneration?.configured),diagramRender:Boolean(s.diagramRender?.configured),supportedDiagramTypes:s.diagramRender?.supportedDiagramTypes||[]};}
  async function prepare({studentId,classId,context,visualRequest,turnKey}) {
    const intent=normalizeVisualIntent(visualRequest);
    if(!intent)return [];
    if(!permitted(context))throw stale();
    const expected=binding(context),abort=new AbortController();
    const pre={course_state_version:String(context.classRow.course_state_version),class_schedule_version:String(context.classRow.schedule_version),course_plan_id:context.plan?.course_plan_id,course_plan_version:context.plan?.version_no,lesson_blueprint_id:context.blueprint.lesson_blueprint_id,lesson_blueprint_version:context.blueprint.version_no};
    const envelope={trigger:{actor_id:studentId},state_reference:{aggregate_type:'teaching_class_controller',aggregate_id:classId},preconditions:pre};
    async function assertCurrent(){
      if(abort.signal.aborted)throw abort.signal.reason;
      const [ctx,cancel]=await Promise.all([readContext(studentId,classId),revocations.read(envelope,{phase:'classroom_visual'})]);
      if(!permitted(ctx)||binding(ctx)!==expected||cancel?.cancelled)throw stale();
    }
    await assertCurrent();
    const available=capabilities();
    const fallback=()=>[createVisualBoardFallback({text:'Visual unavailable. '+(intent.fallbackText||intent.altText)})];
    if(!(intent.kind==='IMAGE'?available.imageGeneration:available.diagramRender))return fallback();
    const key=createHash('sha256').update(JSON.stringify([turnKey,expected,intent])).digest('hex');
    const job=await repository.claimVisual({studentId,classId,sessionId:context.session.class_session_id,key,binding:expected});
    if(!job)return fallback();
    function block(visual){const asset={assetId:job.asset_id,src:'/api/teaching/classes/'+encodeURIComponent(classId)+'/classroom/assets/'+job.asset_id};return intent.kind==='IMAGE'?createGenerativeImageBoardBlock({visual,asset}):createStructuredDiagramBoardBlock({visual,asset});}
    if(job.state==='READY'){await assertCurrent();return [block(job.visual_metadata)];}
    if(job.state!=='GENERATING')return fallback();
    let checking=false;
    const poll=setInterval(async()=>{if(checking)return;checking=true;try{await assertCurrent();}catch(error){abort.abort(error);}finally{checking=false;}},1000);poll.unref?.();
    const timeout=setTimeout(()=>abort.abort(Object.assign(new Error('Classroom visual deadline exceeded.'),{code:'TEACHING_D14_VISUAL_TIMEOUT'})),deadlineMs);timeout.unref?.();
    try {
      const options={...intent,signal:abort.signal,beforeAttempt:assertCurrent,metadata:{studentId,classId,turnKey}};
      // Bound the Teacher turn even when a transport ignores cancellation.
      const pending=intent.kind==='IMAGE'?ai.generateImage(options):ai.renderDiagram(options);
      let onAbort;
      const cancelled=new Promise((_,reject)=>{onAbort=()=>reject(abort.signal.reason);abort.signal.addEventListener('abort',onAbort,{once:true});if(abort.signal.aborted)onAbort();});
      let visual;
      try{visual=await Promise.race([pending,cancelled]);}finally{abort.signal.removeEventListener('abort',onAbort);}
      await assertCurrent();
      if(visual.degraded){await repository.finishVisual({job,state:'FAILED'});return fallback();}
      const media=intent.kind==='IMAGE'?inspectGeneratedImage(visual.image?.data):{mimeType:'image/svg+xml',data:sanitizeSvg(visual.output?.svg)};
      const bytes=intent.kind==='IMAGE'?Buffer.from(media.data,'base64'):Buffer.from(media.data,'utf8');
      const metadata={...visual};delete metadata.image;delete metadata.output;delete metadata.credentialSlot;
      // Adapters require a successful diagram output; retain a bounded marker,
      // while actual SVG bytes stay exclusively in private binary persistence.
      if(intent.kind==='DIAGRAM')metadata.output={svg:'materialized'};
      const saved=await repository.finishVisual({job,state:'READY',bytes,mimeType:media.mimeType,metadata});
      await assertCurrent();
      if(!saved)return fallback();
      return [block(metadata)];
    }catch(error){
      await repository.finishVisual({job,state:'FAILED'});
      if(error.code==='TEACHING_D14_TEACHER_TURN_STALE'||abort.signal.reason?.code==='TEACHING_D14_TEACHER_TURN_STALE')throw stale();
      const [current,cancel]=await Promise.all([readContext(studentId,classId),revocations.read(envelope,{phase:'classroom_visual_fallback'})]);
      if(!permitted(current)||binding(current)!==expected||cancel?.cancelled)throw stale();
      return fallback();
    }finally{clearInterval(poll);clearTimeout(timeout);}
  }
  return Object.freeze({capabilities,prepare});
}
module.exports={createD14VisualService,binding,permitted};
