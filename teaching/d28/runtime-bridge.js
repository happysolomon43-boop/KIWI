'use strict';
let current=null;
function setD28RuntimeService(service){current=service||null;return current;}
function getD28RuntimeService(){return current;}
module.exports={setD28RuntimeService,getD28RuntimeService};
