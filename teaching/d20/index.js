'use strict';

const contracts=require('./contracts');
const intelligence=require('./intelligence');
const {createD20Service,createD20AuthorityService}=require('./assessment-boundary-service');
const {mountD20Routes}=require('./routes');

module.exports={...contracts,...intelligence,createD20Service,createD20AuthorityService,mountD20Routes};
