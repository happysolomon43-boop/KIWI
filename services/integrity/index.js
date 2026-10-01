'use strict';
const contracts=require('./contracts');
const {createIntegrityRepository}=require('./repository');
const {createIntegrityService}=require('./service');
const {mountIntegrityRoutes}=require('./routes');
module.exports=Object.freeze({...contracts,createIntegrityRepository,createIntegrityService,mountIntegrityRoutes});
