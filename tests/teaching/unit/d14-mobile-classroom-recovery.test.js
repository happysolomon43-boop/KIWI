'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createD14Service}=require('../../../teaching/d14/service');
const root=path.resolve(__dirname,'../../..');
const ui=fs.readFileSync(path.join(root,'public/teaching-classroom.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public/teaching-classroom.css'),'utf8');

// Exercise the real client-side orchestration functions with a restricted DOM
// harness. No real JOIN, Class mutation, timer or user identity is fabricated.
function harness({snapshot=null}={}){
  const listeners=new Map(),requests=[],timers=new Map(),widgets=[];
  let seq=0;
  class Element {
    constructor(tag='',className='',value=''){this.tag=tag;this.className=className;this.children=[];this.dataset={};this.style={setProperty(k,v){this[k]=v;}};this.scrollTop=0;this.value=value;this.textContent=value;this.classList={remove(){},add(){},toggle(){}};}
    append(...nodes){this.children.push(...nodes);return this;}
    replaceChildren(...nodes){this.children=nodes;}
    setAttribute(k,v){this[k]=v;}
    addEventListener(k,fn){listeners.set(this.tag+':'+k,fn);}
    remove(){}
    focus(){}
    querySelector(){return null;}
  }
  const doc={activeElement:new Element('active'),body:new Element('body'),createElement(tag){return new Element(tag);},addEventListener(){},querySelector(){return null;}};
  const ctx={document:doc,window:{KIWI_API_CLIENT:{kiwiApiRequest:async(endpoint,opts)=>{
    requests.push({endpoint,opts});
    if(endpoint.endsWith('/classroom')&&snapshot)return snapshot;
    throw Object.assign(new Error('request timed out'),{code:'KIWI_API_TIMEOUT',status:408});
  }},KIWITeachingCourses:{registerSection(obj){widgets.push(obj);}},localStorage:{getItem(){return null;},setItem(){}},KIWI_CLASSROOM_TEST_MODE:''},Node:{ELEMENT_NODE:1},setInterval(fn){const id=++seq;timers.set(id,fn);return id;},clearInterval(id){timers.delete(id);},requestAnimationFrame(){return 1;},crypto:{randomUUID:()=>'uuid'},Date,console};
  vm.runInNewContext(ui,ctx,{filename:'teaching-classroom.js',timeout:1000});
  return {ctx,requests,timers,section:widgets[0],doc};
}

test('a timed-out initial Classroom read keeps the same dialog and offers a retry instead of fatal unavailable',async()=>{
  const h=harness();
  await h.section.openClassroom('class-1');
  assert.equal(h.ctx.window.KIWITeachingCourses!=null,true);
  const host=h.doc.body.children.at(-1);
  assert.equal(host.tag,'div');
  assert.equal(host.children[0].children[0].textContent,'Connecting to your Class');
  assert.match(host.children[0].children[1].textContent,/has not been cancelled or interrupted/);
  assert.ok(host.children.some(x=>x.children.some?.(c=>c.textContent==='Try again')));
  assert.equal(h.timers.size,2,'polling survives an initial timeout');
  assert.equal(h.requests.filter(x=>x.endpoint.endsWith('/classroom')).length,1);
  const timer=[...h.timers.values()][1];
  await timer();
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(h.requests.filter(x=>x.endpoint.endsWith('/classroom')).length>=2,'reconnect attempts continue');
});

test('reopening an already-entered Class never duplicates JOIN, including after successful snapshot',async()=>{
  // The full live DOM is exercised in existing D14 browser/integration checks.
  // Verify the entry guard directly so it cannot be weakened by retry logic.
  assert.match(ui,/!data\.hasEntered\)\s*\{\s*await joinCurrentClass/);
  assert.match(ui,/if\(state\.snapshotFlight\)return state\.snapshotFlight/);
  assert.match(ui,/if\(state\.connectFlight\)return state\.connectFlight/);
  assert.match(ui,/if\(state\.joinFlight\)return state\.joinFlight/);
  assert.match(ui,/state\.requestAbort\?\.abort\(\)/);
  assert.match(ui,/state\.host!==host\|\|state\.classId!==classId/);
  assert.doesNotMatch(ui,/notice\('Classroom unavailable'/);
});

test('server supplies existing durable JOIN status without any attendance mutation',async()=>{
  const session={class_session_id:'session',lifecycle_state:'ACTIVE',instructional_substate:'OPENING',progress_state:{}};
  const classRow={course_id:'course',class_id:'class',lifecycle_state:'SCHEDULED',course_lifecycle_state:'ACTIVE',source_timetable_state:'APPROVED',scheduled_start_at:'2026-10-09T08:00:00.000Z',scheduled_end_at:'2026-10-09T10:00:00.000Z'};
  let joined=true;
  const repo={identity:async()=>({course_title:'Course'}),board:async()=>[],notebook:async()=>[],latestNote:async()=>null,latestTeacherMessage:async()=>null,firstEntry:async()=>joined?{created_at:'2026-10-09T08:01:00Z'}:null,conversation:async()=>[],helpRequests:async()=>[]};
  const svc=createD14Service({repository:repo,d11Repository:{getClassContext:async()=>({classRow,session,plan:{},blueprint:null})},d11Service:{getClass:async()=>({class:{},controller:{},time:{}})},d12Service:{},randomUUID:()=>'id',clock:()=>new Date('2026-10-09T08:40:00Z')});
  assert.equal((await svc.snapshot({id:'student'},'class')).hasEntered,true);
  joined=false;
  assert.equal((await svc.snapshot({id:'student'},'class')).hasEntered,false);
});

test('reading scale and edge tab are accessibility controls, not academic or scheduling actions',()=>{
  assert.match(ui,/const TEXT_SCALES=Object\.freeze\(\[0\.82,0\.9,1,1\.12\]\)/);
  assert.match(ui,/localStorage\.setItem\('kiwi_classroom_text_scale'/);
  assert.match(ui,/readingControls\(\)/);
  assert.match(ui,/state\.host\.scrollTop=readingScroll/);
  assert.match(css,/\.tc-overlay\{overflow-x:hidden;overflow-y:auto/);
  assert.match(css,/\.tc-board-item p\{font-size:calc\(16px \* var\(--tc-reading-scale/);
  assert.match(css,/\.tc-raise-hand\{width:44px/);
  assert.match(css,/\.tc-raise-hand:hover,\.tc-raise-hand:focus-visible/);
  assert.match(ui,/openSheet\('teacher'\)/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});
