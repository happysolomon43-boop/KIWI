'use strict';
const contracts=require('./contracts');
const intelligence=require('./intelligence');
const {createD07Service:createBaseD07Service}=require('./service');
const {decorateCourseUniqueness}=require('./course-uniqueness-service');
const {decorateAuditIdempotency}=require('./audit-idempotency-service');
const {decorateTruncationRecovery}=require('./truncation-recovery-service');
function createD07Service(options={}){
 const unique=decorateCourseUniqueness(createBaseD07Service(options));
 const idempotent=decorateAuditIdempotency(unique);
 return decorateTruncationRecovery(idempotent,{outboxStore:options.outboxStore||null,logger:options.logger||console});
}
module.exports={...contracts,...intelligence,createD07Service};
