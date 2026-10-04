'use strict';

function mountD28Routes(app, { service, requireTeachingUser, sendError } = {}) {
  if (!app || !service) return;
  const auth = typeof requireTeachingUser === 'function' ? requireTeachingUser : (_req,_res,next)=>next();
  const fail = typeof sendError === 'function' ? sendError : (res,error)=>res.status(error?.statusCode||500).json({ok:false,error:error?.code||'TEACHING_D28_FAILED'});
  app.get('/api/teaching/d28/status', auth, async (req,res)=>{ try { res.json(await service.status(req.user)); } catch(error){ fail(res,error); } });
  app.get('/api/teaching/d28/operations', auth, async (req,res)=>{ try { res.json(await service.operationsSnapshot(req.user)); } catch(error){ fail(res,error); } });
}
module.exports={mountD28Routes};
