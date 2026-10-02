'use strict';

const contracts=require('./contracts');
const intelligence=require('./intelligence');
const {createD20Service}=require('./service');
const {mountD20Routes}=require('./routes');

module.exports={...contracts,...intelligence,createD20Service,mountD20Routes};