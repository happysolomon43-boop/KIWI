'use strict';
const contracts=require('./contracts');
const {createD10Service}=require('./service');
const {registerD10DueEventHandler}=require('./runtime');
module.exports={...contracts,createD10Service,registerD10DueEventHandler};
