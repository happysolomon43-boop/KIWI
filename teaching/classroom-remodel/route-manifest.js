'use strict';
const VERSION='classroom-routes.v1';
const ROUTES=Object.freeze([
 ['GET','/classes/:id/classroom/session',3,'session'],['GET','/classes/:id/classroom/conversation',3,'transport'],['GET','/classes/:id/classroom/chapter',2,'session'],['GET','/classes/:id/classroom/stream',3,'transport'],
 ['POST','/classes/:id/classroom/client-lease',3,'presentation'],['POST','/classes/:id/classroom/presentation-controls',3,'presentation'],['POST','/classes/:id/classroom/delivery-receipts',3,'presentation'],
 ['POST','/classes/:id/classroom/messages',5,'messages'],['GET','/classes/:id/classroom/questions',5,'messages'],['POST','/classes/:id/classroom/tasks/:taskId/responses',6,'tasks'],['POST','/classes/:id/classroom/tasks/:taskId/extensions',6,'tasks'],
].map(([method,path,delivery,policyCapability])=>Object.freeze({method,path,delivery,policyCapability,auth:'existing /api/teaching ownership',qualified:false,registered:false,schemaVersion:'classroom-contracts.v1'})));
// A manifest entry is never proof that Express has registered its handler.
function assertRouteImplemented(entry,handlers){if(!entry.qualified||typeof handlers?.[entry.method+' '+entry.path]!=='function'){const e=new Error('Classroom route is not qualified and implemented');e.code='CLASSROOM_ROUTE_UNAVAILABLE';throw e;}return true;}
module.exports={VERSION,ROUTES,assertRouteImplemented};
