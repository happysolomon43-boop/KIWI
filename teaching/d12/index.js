'use strict';

const contracts=require('./contracts');
const intelligence=require('./intelligence');
const {createD12Service}=require('./service');
const {registerD12Runtime}=require('./runtime');

module.exports={...contracts,...intelligence,createD12Service,registerD12Runtime};
