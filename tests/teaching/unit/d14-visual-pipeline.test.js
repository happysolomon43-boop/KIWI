'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createD14VisualService}=require('../../../teaching/d14/visual-service');
const {normalizeVisualIntent}=require('../../../teaching/d14/visual-intent');
const {normalizeProposal}=require('../../../teaching/d14/help-intelligence');
const {lessonTeacherRequest}=require('../../../teaching/d14/lesson-intelligence');
const {createGeneratedImageResponse,createDiagramRenderRequest,createDiagramRenderResponse}=require('../../../services/ai/visual-contracts');
const {createD14Service}=require('../../../teaching/d14/service');
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl7lT8AAAAASUVORK5CYII=';
const intent={kind:'DIAGRAM',diagramType:'graphviz',source:'digraph { A -> B }',altText:'A leads to B',fallbackText:'First A, then B.'};
function fixture(prefix='one'){
 const ctx={classRow:{class_id:prefix+'-class',course_id:prefix+'-course',lifecycle_state:'SCHEDULED',course_lifecycle_state:'ACTIVE',source_timetable_state:'APPROVED',course_state_version:5,schedule_version:2,source_timetable_version_id:'tt'},session:{class_session_id:prefix+'-session',state_version:7,lifecycle_state:'ACTIVE',instructional_substate:'INSTRUCTION',progress_state:{current_learning_unit_ref:'lu'}},blueprint:{lesson_blueprint_id:'bp',version_no:2,blueprint_state:'VALIDATED'},plan:{course_plan_id:'plan',version_no:3}};
 const calls=[],jobs=new Map();
 const repository={async claimVisual(args){calls.push(['claim',args]);if(jobs.has(args.key))return jobs.get(args.key);const job={asset_id:prefix+'-asset',student_id:prefix+'-student',class_id:ctx.classRow.class_id,state:'GENERATING',lease_token:'lease',key:args.key};jobs.set(args.key,job);return job;},async finishVisual(args){calls.push(['finish',args]);const job=jobs.get(args.job.key);Object.assign(job,{state:args.state,visual_metadata:args.metadata});return {asset_id:job.asset_id};}};
 const ai={capabilityStatus:()=>({imageGeneration:{configured:true},diagramRender:{configured:true,supportedDiagramTypes:['graphviz']}}),async renderDiagram(args){calls.push(['diagram',args]);await args.beforeAttempt();return createDiagramRenderResponse({request:createDiagramRenderRequest(args),provider:'KROKI',svg:'<svg xmlns="http://www.w3.org/2000/svg"><text>A then B</text></svg>',cacheKey:'cache'});},async generateImage(args){calls.push(['image',args]);await args.beforeAttempt();return createGeneratedImageResponse({request:args,provider:'CLOUDFLARE',data:png,modelId:'model'});}};
 const service=createD14VisualService({ai,repository,readContext:async()=>ctx,revocations:{read:async()=>({cancelled:false})}});
 return {ctx,calls,jobs,repository,ai,service,args:{studentId:prefix+'-student',classId:ctx.classRow.class_id,context:ctx,visualRequest:intent,turnKey:'turn'}};
}
test('Teacher visual intent is bounded, rejects asset/provider injection and cannot accompany deferral',()=>{
 assert.deepEqual(normalizeVisualIntent(intent),intent);
 for(const value of [{...intent,src:'https://x'}, {...intent,provider:'custom'},{...intent,source:'digraph { image="https://x" }'},{...intent,source:'x'.repeat(6001)}])assert.throws(()=>normalizeVisualIntent(value));
 assert.equal(normalizeProposal({decision:'DEFER',teacherMessage:'',reason:'later',delayMinutes:1,visualRequest:intent}),null);
 assert.equal(normalizeProposal({decision:'ANSWER_NOW',teacherMessage:'First A, then B.',visualRequest:intent}).visualRequest.kind,'DIAGRAM');
});
test('general Classroom diagram generation materializes private bytes, adapts Board blocks and reuses exact turns across courses',async()=>{
 for(const prefix of ['course-a','course-b']){
  const f=fixture(prefix),blocks=await f.service.prepare(f.args);
  assert.equal(blocks[0].type,'diagram');assert.match(blocks[0].content.src,new RegExp('/'+prefix+'-class/classroom/assets/'));
  const saved=f.calls.find(c=>c[0]==='finish')[1];assert.equal(saved.mimeType,'image/svg+xml');assert.ok(Buffer.isBuffer(saved.bytes));assert.match(saved.bytes.toString(),/<svg/);
  assert.equal(JSON.stringify(blocks).includes('<svg'),false);assert.equal(saved.metadata.credentialSlot,undefined);
  assert.deepEqual(await f.service.prepare(f.args),blocks);assert.equal(f.calls.filter(c=>c[0]==='diagram').length,1);
 }
});
test('images use validated binary output and remain explicitly supplementary',async()=>{
 const f=fixture();const blocks=await f.service.prepare({...f.args,visualRequest:{kind:'IMAGE',prompt:'A conceptual illustration',altText:'Conceptual illustration'}});
 assert.equal(blocks[0].type,'image');assert.equal(blocks[0].content.academicAuthority,'SUPPLEMENTARY_ONLY');assert.equal(f.calls.find(c=>c[0]==='finish')[1].mimeType,'image/png');
});
test('protected activities and revoked parents never spend visual generation calls',async()=>{
 for(const mode of ['ASSESSMENT','CLASSWORK','BREAK','CLOSURE','INTERRUPTED']){
  const f=fixture();f.ctx.session.instructional_substate=mode;await assert.rejects(f.service.prepare(f.args),{code:'TEACHING_D14_TEACHER_TURN_STALE'});assert.equal(f.calls.length,0);
 }
 const f=fixture();const service=createD14VisualService({ai:f.ai,repository:f.repository,readContext:async()=>f.ctx,revocations:{read:async()=>({cancelled:true})}});
 await assert.rejects(service.prepare(f.args),{code:'TEACHING_D14_TEACHER_TURN_STALE'});assert.equal(f.calls.length,0);
});
test('controller, learning-unit, plan, blueprint and schedule changes discard generated output before storage',async()=>{
 for(const mutate of [c=>c.session.state_version++,c=>c.session.progress_state.current_learning_unit_ref='other',c=>c.plan.version_no++,c=>c.blueprint.version_no++,c=>c.classRow.schedule_version++]){
  const f=fixture();const generate=f.ai.renderDiagram;f.ai.renderDiagram=async args=>{const result=await generate(args);mutate(f.ctx);return result;};
  await assert.rejects(f.service.prepare(f.args),{code:'TEACHING_D14_TEACHER_TURN_STALE'});
  assert.equal(f.calls.some(c=>c[0]==='finish'&&c[1].state==='READY'),false);
 }
});
test('provider failures, missing capabilities and exhausted budget publish readable fallbacks without invented assets',async()=>{
 for(const failure of ['provider','capability','budget']){
  const f=fixture();if(failure==='provider')f.ai.renderDiagram=async()=>{throw new Error('offline');};if(failure==='capability')f.ai.capabilityStatus=()=>({});if(failure==='budget')f.repository.claimVisual=async()=>null;
  const [block]=await f.service.prepare(f.args);assert.equal(block.type,'text');assert.match(block.content.text,/Visual unavailable/);assert.match(block.content.text,/First A/);
 }
});
test('a provider ignoring cancellation cannot hold the Teacher turn past its deadline',async()=>{
 const f=fixture();f.ai.renderDiagram=()=>new Promise(()=>{});
 const service=createD14VisualService({ai:f.ai,repository:f.repository,readContext:async()=>f.ctx,revocations:{read:async()=>({cancelled:false})},deadlineMs:10});
 const keepAlive=setInterval(()=>{},100);
 try{const [block]=await service.prepare(f.args);assert.equal(block.type,'text');assert.equal(f.calls.find(c=>c[0]==='finish')[1].state,'FAILED');}
 finally{clearInterval(keepAlive);}
});
test('normal lesson Teacher turns share TPF-08 but have no fabricated student-question context',()=>{
 const f=fixture();const r=lessonTeacherRequest({...f.args,turnKey:'lesson-key',visualCapabilities:f.service.capabilities()});
 assert.equal(r.capabilityId,'teaching.pedagogy.natural_teacher_explanation_generation');assert.deepEqual(r.contextSpec.untrusted_refs,[]);assert.equal(r.outputSchema.id,'d14.lesson_teacher_turn');assert.equal(r.academicInput.question_ref,undefined);assert.match(r.academicInput.instruction,/visualRequest/);assert.equal(r.academicInput.visual_capabilities.diagramRender,true);
});
test('normal lesson turn publishes explanation and generated visual through the same authority-fenced transaction',async()=>{
 const f=fixture(),published=[];
 const service=createD14Service({repository:{teacherTurn:async()=>null,publishTeacherTurn:async args=>{published.push(args);return {communication_id:'comm'};}},d11Repository:{getClassContext:async()=>f.ctx},d11Service:{},d12Service:{},randomUUID:()=> 'id',visualService:f.service,lessonIntelligence:{decide:async()=>({decision:'ANSWER_NOW',teacherMessage:'First A, then B.',visualRequest:intent})}});
 assert.equal((await service.processLessonTurn({studentId:f.args.studentId,classId:f.args.classId,sessionId:f.ctx.session.class_session_id,controllerVersion:7})).published,true);
 assert.equal(published[0].blocks[0].type,'diagram');assert.equal(published[0].expectedBlueprintVersion,2);assert.equal(published[0].expectedScheduleVersion,2);
 f.ctx.session.instructional_substate='ASSESSMENT';assert.equal((await service.processLessonTurn({studentId:f.args.studentId,classId:f.args.classId,sessionId:f.ctx.session.class_session_id,controllerVersion:7})).noop,true);assert.equal(published.length,1);
});
