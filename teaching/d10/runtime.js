'use strict';

const { TEACHING_EVENTS } = require('../events/names');
const { RECONCILIATION_DISPOSITIONS } = require('../runtime/constants');

function registerD10DueEventHandler({eventRuntime,repository,service}={}) {
  if(!eventRuntime||typeof eventRuntime.register!=='function') throw new TypeError('D10 due-event integration requires eventRuntime.register().');
  if(!repository||typeof repository.getRequestById!=='function') throw new TypeError('D10 due-event integration requires repository.');
  if(!service||typeof service.applyDueRequest!=='function') throw new TypeError('D10 due-event integration requires service.applyDueRequest().');

  return eventRuntime.register(TEACHING_EVENTS.REQUEST_EFFECTIVE_DUE,{
    reconcile:async(event)=>{
      const request=await repository.getRequestById(event.payload?.request_id||event.aggregateId);
      if(!request) return {disposition:RECONCILIATION_DISPOSITIONS.SUPERSEDED,reason:'REQUEST_NO_LONGER_EXISTS'};
      if(['APPLIED','CLOSED'].includes(request.lifecycle_state)||request.application_ref) {
        return {disposition:RECONCILIATION_DISPOSITIONS.ALREADY_SATISFIED,reason:'REQUEST_ALREADY_APPLIED_OR_CLOSED'};
      }
      if(!['APPROVED','APPROVED_WITH_ADJUSTMENT'].includes(request.lifecycle_state)) {
        return {disposition:RECONCILIATION_DISPOSITIONS.SUPERSEDED,reason:'REQUEST_NO_LONGER_APPROVED'};
      }
      if(event.aggregateVersion!=null&&Number(event.aggregateVersion)!==Number(request.state_version)) {
        return {disposition:RECONCILIATION_DISPOSITIONS.SUPERSEDED,reason:'REQUEST_VERSION_CHANGED'};
      }
      return {disposition:RECONCILIATION_DISPOSITIONS.ACTIONABLE,metadata:{request_type:request.request_type}};
    },
    handle:async(event)=>{
      const result=await service.applyDueRequest({
        requestId:event.payload?.request_id||event.aggregateId,
        expectedVersion:event.aggregateVersion,
      });
      return {safeMetadata:{request_id:event.payload?.request_id||event.aggregateId,idempotent:Boolean(result?.idempotent)}};
    },
  });
}

module.exports={registerD10DueEventHandler};
