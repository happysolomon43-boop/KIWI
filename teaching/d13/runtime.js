'use strict';

const { TEACHING_EVENTS } = require('../events/names');

function registerD13Runtime({publishedEvents,service}={}){
  if(!publishedEvents||typeof publishedEvents.register!=='function')throw new TypeError('D13 runtime requires published-event registry.');
  if(!service||typeof service.handleResponseSubmittedEvent!=='function')throw new TypeError('D13 runtime requires D13 service.');
  const registration=publishedEvents.register(TEACHING_EVENTS.STUDENT_RESPONSE_SUBMITTED,{
    subscriberId:'d13-skm-evidence-application',
    handle:(event)=>service.handleResponseSubmittedEvent(event),
  });
  return Object.freeze({registration,eventType:TEACHING_EVENTS.STUDENT_RESPONSE_SUBMITTED,subscriberId:'d13-skm-evidence-application'});
}
module.exports={registerD13Runtime};
