'use strict';
function mountD28Routes(router,{service,sendError}={}){if(!router||!service)return null;
 router.get('/operations/d28/audit-dashboard',async(req,res)=>{try{res.json(await service.auditDashboard(req.user,{limit:req.query.limit}));}catch(error){sendError(res,error,'D28 operational audit dashboard is unavailable.');}});
 router.get('/operations/d28/status',async(req,res)=>{try{await service.auditDashboard(req.user,{limit:1});res.json(service.status());}catch(error){sendError(res,error,'D28 operational status is unavailable.');}});
 return Object.freeze({readOnly:true,academicMutationRoutes:0});
}
module.exports={mountD28Routes};
