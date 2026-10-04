'use strict';

function createD28RuntimeBridge(service){
  if(!service) return null;
  return Object.freeze({
    recordOperationalEvent: (event)=>service.recordOperationalEvent(event),
    raiseAlert: (alert)=>service.raiseAlert(alert),
  });
}
module.exports={createD28RuntimeBridge};
