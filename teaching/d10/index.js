'use strict';
const contracts=require('./contracts');
const {createD10Service:createBaseD10Service}=require('./service');
const {decorateD10Service}=require('./flow-integrity-service');
const {decorateD10RequestExperience}=require('./request-experience-service');
const {registerD10DueEventHandler}=require('./runtime');
function createD10Service(options={}){
  return decorateD10RequestExperience(decorateD10Service(createBaseD10Service(options),options),options);
}
module.exports={...contracts,createD10Service,registerD10DueEventHandler};
