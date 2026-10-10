'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),fs=require('node:fs'),vm=require('node:vm');
const {mountClassroomPresentationRoutes}=require('../../../teaching/classroom-remodel/presentation-routes');
async function server(run){const app=express();app.use(express.json());let auth=true,calls=[],commands=[];const event={id:'e1',sequence:1,role:'teacher',type:'portion',text:'Released teaching',source_refs:[],status:'RELEASED',occurred_at:new Date().toISOString()};const snapshot={schema_version:'classroom-domain.v1',session_id:'s1',cursor:1,controller_version:1,delivery_version:2,delivery_epoch:1,control_epoch:1,delivery_state:'PRESENTING',clocks:{},permitted_actions:['pause'],transport:{reconnectBackoffMs:10}};
 app.use((req,res,next)=>{if(req.method==='POST')commands.push(req.path);if(req.headers.authorization!=='Bearer fixture')return res.status(401).json({code:'UNAUTHORIZED'});req.user={id:'owned'};next();});
 const service={snapshot:async user=>{assert.equal(user.id,'owned');return snapshot;},conversation:async(user,id,after)=>{calls.push(after);if(after>1)throw Object.assign(new Error('cursor'),{code:'CLASSROOM_CURSOR_RESET_REQUIRED',status:409});return {schema_version:'classroom-domain.v1',session_id:'s1',from_cursor:after,to_cursor:1,server_time:new Date().toISOString(),events:after===0?[event]:[]};},lease:async(user,id,input)=>({owner:user.id,intent:input.intent}),control:async()=>({accepted:true}),receipt:async()=>({semantics:'APPLICATION_RENDER_ONLY'})};
 mountClassroomPresentationRoutes(app,{service,reauthenticate:async()=>auth});const listener=app.listen(0,'127.0.0.1');await new Promise(resolve=>listener.once('listening',resolve));const base='http://127.0.0.1:'+listener.address().port;
 try{await run({base,calls,commands,setAuth:value=>{auth=value;}});}finally{listener.closeAllConnections();await new Promise(resolve=>listener.close(resolve));}}
test('HTTP routes authenticate owner, validate cursor and deliver resumable ordered SSE without private buffers',async()=>server(async({base,setAuth})=>{
 const path='/classes/c/classroom/';assert.equal((await fetch(base+path+'session')).status,401);const headers={Authorization:'Bearer fixture'};
 const delta=await (await fetch(base+path+'conversation?after=0',{headers})).json();assert.equal(delta.events[0].text,'Released teaching');assert.equal(delta.to_cursor,1);
 const invalid=await fetch(base+path+'conversation?after=1.5',{headers});assert.equal(invalid.status,409);assert.equal((await invalid.json()).code,'CLASSROOM_CURSOR_RESET_REQUIRED');
 const response=await fetch(base+path+'stream?after=0',{headers});assert.match(response.headers.get('Content-Type'),/text\/event-stream/);const reader=response.body.getReader(),decoder=new TextDecoder();let text='';while(!text.includes('classroom_delta'))text+=decoder.decode((await reader.read()).value);assert.match(text,/Released teaching/);assert.doesNotMatch(text,/private|criterion|buffer/);setAuth(false);while(!text.includes('auth_refresh_required')){const part=await reader.read();if(part.done)break;text+=decoder.decode(part.value);}assert.match(text,/auth_refresh_required/);await reader.cancel();
}));
test('fetch client consumes connected SSE and cancels without issuing a teaching command',async()=>server(async({base,calls,commands})=>{
 const abort=new AbortController(),received=[];const storage=new Map([['kiwi_auth_token','fixture']]);
 const window={KIWI_RUNTIME_CONFIG:{apiBaseUrl:base},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},setTimeout,clearTimeout,ReadableStream,TextDecoder};
 // Route shape matches the real router mount. This test proxies the prefix only.
 const fetchImpl=(url,options)=>fetch(String(url).replace('/teaching',''),options);
 const context=vm.createContext({window,fetch:fetchImpl,AbortController,TextDecoder,setTimeout,clearTimeout,console});vm.runInContext(fs.readFileSync('public/kiwi-api-client.js','utf8'),context);
 await window.KIWI_API_CLIENT.classroomTransport('c',{signal:abort.signal,onEvent:(type,data)=>{received.push([type,data]);if(type==='classroom_delta')abort.abort();}});
 assert.equal(received.filter(([type])=>type==='classroom_delta').length,1);assert.equal(received.find(([type])=>type==='classroom_delta')[1].events[0].text,'Released teaching');assert.ok(calls.every(cursor=>cursor===0||cursor===1));assert.equal(commands.length,0);
}));
test('polling fallback exposes the same ordered delta and cancels promptly',async()=>server(async({base})=>{
 const abort=new AbortController(),events=[];const window={KIWI_RUNTIME_CONFIG:{apiBaseUrl:base},localStorage:{getItem:()=> 'fixture',setItem(){},removeItem(){}},setTimeout,clearTimeout};const context=vm.createContext({window,fetch:(url,options)=>fetch(String(url).replace('/teaching',''),options),AbortController,setTimeout,clearTimeout,console});vm.runInContext(fs.readFileSync('public/kiwi-api-client.js','utf8'),context);
 await window.KIWI_API_CLIENT.classroomTransport('c',{signal:abort.signal,onEvent:(type,data)=>{if(type==='classroom_delta'){events.push(data);abort.abort();}}});assert.equal(events.length,1);assert.equal(events[0].events[0].sequence,1);
}));
