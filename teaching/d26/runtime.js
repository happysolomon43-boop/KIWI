'use strict';
const {TEACHING_EVENTS}=require('../events/names');
const {RECONCILIATION_DISPOSITIONS}=require('../runtime/constants');
function registerD26Runtime({eventRuntime,service,preparationRepository=null}={}){
  if(!eventRuntime||!service)return null;
  eventRuntime.register(TEACHING_EVENTS.NOTIFICATION_DELIVERY_DUE,{reconcile:async event=>Object.freeze({disposition:RECONCILIATION_DISPOSITIONS.ACTIONABLE,reason:'CURRENT_SOURCE_REVALIDATION_REQUIRED',metadata:{kind:event?.payload?.notification?.kind||null}}),handle:event=>service.deliverNotificationEvent(event)});
  const ppl=[];
  for(const type of [TEACHING_EVENTS.PREPARATION_REVIEW_DUE,TEACHING_EVENTS.PREPARATION_FINALIZATION_DUE]){
    if(!preparationRepository)continue;
    eventRuntime.register(type,{reconcile:async event=>{const state=await preparationRepository.getWorkspaceSnapshot(event.aggregate_id);if(!state?.workspace)return Object.freeze({disposition:RECONCILIATION_DISPOSITIONS.SUPERSEDED,reason:'WORKSPACE_MISSING'});if(Number(state.workspace.state_version)!==Number(event.aggregate_version))return Object.freeze({disposition:RECONCILIATION_DISPOSITIONS.SUPERSEDED,reason:'WORKSPACE_VERSION_CHANGED'});if(['FINALIZED','HANDED_OFF','SUPERSEDED','CANCELLED'].includes(String(state.workspace.lifecycle_state)))return Object.freeze({disposition:RECONCILIATION_DISPOSITIONS.ALREADY_SATISFIED,reason:'WORKSPACE_TERMINAL'});if(type===TEACHING_EVENTS.PREPARATION_FINALIZATION_DUE&&state.findings.some(x=>x.status==='OPEN'))return Object.freeze({disposition:RECONCILIATION_DISPOSITIONS.FAIRNESS_RECOVERY_REQUIRED,reason:'OPEN_FINDINGS_BLOCK_FINALIZATION'});return Object.freeze({disposition:RECONCILIATION_DISPOSITIONS.ACTIONABLE,reason:'CURRENT_WORKSPACE_REQUIRES_D05_CONTINUATION'});},handle:async event=>{await preparationRepository.auditNoop({workspaceId:event.aggregate_id,action:'preparation.due.reconciled',reason:'D05_CONTINUATION_REQUIRED',correlationId:event.correlation_id||null,causationId:event.event_id,safeMetadata:{event_type:event.event_type,workspace_version:event.aggregate_version,route_qualification:'UNQUALIFIED_UNTIL_D30'}});return {safeMetadata:{workspaceId:event.aggregate_id,outcome:'RECONCILED_TO_D05_CONTINUATION'}};}});ppl.push(type);
  }
  return Object.freeze({notificationEvent:TEACHING_EVENTS.NOTIFICATION_DELIVERY_DUE,pplEvents:Object.freeze(ppl)});
}
module.exports={registerD26Runtime};
