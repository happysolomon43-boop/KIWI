'use strict';

const { TEACHING_EVENTS } = require('../events/names');

function registerD12Runtime({publishedEvents,service}={}){
  if(!publishedEvents||typeof publishedEvents.register!=='function')throw new TypeError('D12 runtime requires published-event registry.');
  if(!service||typeof service.handleResponseSubmittedEvent!=='function')throw new TypeError('D12 runtime requires D12 service.');
  const registration=publishedEvents.register(TEACHING_EVENTS.STUDENT_RESPONSE_SUBMITTED,{
    subscriberId:'d12-response-evaluation-trigger',
    handle:(event)=>service.handleResponseSubmittedEvent(event),
  });
  return Object.freeze({registration,eventType:TEACHING_EVENTS.STUDENT_RESPONSE_SUBMITTED,subscriberId:'d12-response-evaluation-trigger'});
}

module.exports={registerD12Runtime};
