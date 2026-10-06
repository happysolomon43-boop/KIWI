'use strict';
const contracts=require('./contracts');
const intelligence=require('./intelligence');
const {createD07Service:createBaseD07Service}=require('./service');
const {decorateCourseUniqueness}=require('./course-uniqueness-service');
function createD07Service(options={}){return decorateCourseUniqueness(createBaseD07Service(options));}
module.exports={...contracts,...intelligence,createD07Service};
