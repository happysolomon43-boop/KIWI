'use strict';

const contracts=require('./contracts');
const {createD19AssessmentTypeService}=require('./service');

module.exports=Object.freeze({...contracts,createD19AssessmentTypeService});
