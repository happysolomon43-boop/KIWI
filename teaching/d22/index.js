'use strict';
const {createD22Service}=require('./service');
const {createD22Intelligence}=require('./intelligence');
module.exports={createD22Service,createD22Intelligence,...require('./contracts')};
