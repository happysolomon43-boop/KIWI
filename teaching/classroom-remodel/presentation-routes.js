'use strict';
const {failure}=require('./presentation-policy');
function mountClassroomPresentationRoutes(router,{service,reauthenticate}={}){
 if(!service)return {registered:false};
 const safe=(res,error)=>res.status(Number(error.status)||500).json({code:/^CLASSROOM_[A-Z_]+$/.test(error.code||'')?error.code:'CLASSROOM_REQUEST_FAILED',refreshSnapshot:error.status===409});
 const route=(method,path,handler)=>router[method]('/classes/:id/classroom/'+path,async(req,res)=>{try{res.json(await handler(req));}catch(error){safe(res,error);}});
 const cursor=req=>{if(req.query.after==null)return 0;if(!/^\d+$/.test(String(req.query.after)))throw failure('CLASSROOM_CURSOR_RESET_REQUIRED');const n=Number(req.query.after);if(!Number.isSafeInteger(n))throw failure('CLASSROOM_CURSOR_RESET_REQUIRED');return n;};
 route('get','session',req=>service.snapshot(req.user,req.params.id));
 route('get','conversation',req=>service.conversation(req.user,req.params.id,cursor(req)));
 route('post','client-lease',req=>service.lease(req.user,req.params.id,req.body));
 route('post','presentation-controls',req=>service.control(req.user,req.params.id,req.body));
 route('post','delivery-receipts',req=>service.receipt(req.user,req.params.id,req.body));
 router.get('/classes/:id/classroom/stream',async(req,res)=>{
  let timer=null,closed=false,after;
  const close=()=>{closed=true;clearTimeout(timer);if(!res.writableEnded)res.end();};
  const send=(type,payload)=>res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
  req.once('aborted',close);res.once('close',close);
  try{
   if(typeof reauthenticate!=='function')throw failure('CLASSROOM_STREAM_AUTH_UNAVAILABLE',503);
   after=cursor(req);await service.conversation(req.user,req.params.id,after);
   const initial=await service.snapshot(req.user,req.params.id);
   res.status(200).set({'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'});res.flushHeaders();
   const tick=async()=>{
    try{
     if(closed)return;
     // Re-run the shared authentication middleware; no JWT parsing or second auth authority here.
     const valid=await reauthenticate(req);if(!valid){send('auth_refresh_required',{code:'CLASSROOM_AUTH_REFRESH_REQUIRED'});return close();}
     const delta=await service.conversation(req.user,req.params.id,after);if(closed)return;
     if(delta.events.length){if(!send('classroom_delta',delta)){send('cursor_reset_required',{code:'CLASSROOM_STREAM_BACKPRESSURE'});return close();}after=delta.to_cursor;}
     const snapshot=await service.snapshot(req.user,req.params.id);if(closed)return;
     if(!send('classroom_state',{schema_version:snapshot.schema_version,session_id:snapshot.session_id,controller_version:snapshot.controller_version,delivery_version:snapshot.delivery_version,delivery_epoch:snapshot.delivery_epoch,control_epoch:snapshot.control_epoch,delivery_state:snapshot.delivery_state,clocks:snapshot.clocks,permitted_actions:snapshot.permitted_actions})){close();return;}
     timer=setTimeout(tick,snapshot.transport.reconnectBackoffMs);timer.unref?.();
    }catch(error){if(!closed){send('cursor_reset_required',{code:/^CLASSROOM_/.test(error.code||'')?error.code:'CLASSROOM_STREAM_FAILED'});close();}}
   };
   send('classroom_state',{schema_version:initial.schema_version,session_id:initial.session_id,cursor:after});await tick();
  }catch(error){if(res.headersSent)close();else{closed=true;safe(res,error);}}
 });
 return {registered:true,qualified:false};
}
module.exports={mountClassroomPresentationRoutes};
