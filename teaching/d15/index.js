'use strict';
const contracts=require('./contracts');
const {createD15Service}=require('./service');
const {registerD15Runtime}=require('./runtime');
module.exports={...contracts,createD15Service,registerD15Runtime};
