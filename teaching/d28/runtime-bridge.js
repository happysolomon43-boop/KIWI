'use strict';
let activeService=null;
function registerD28RuntimeService(service){activeService=service||null;return activeService;}
function getD28RuntimeService(){return activeService;}
module.exports={registerD28RuntimeService,getD28RuntimeService};
