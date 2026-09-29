'use strict';

const {TEACHING_EVENTS}=require('../events/names');

function registerD13Runtime({publishedEvents,service}={}) {
  if (!publishedEvents || typeof publishedEvents.register!=='function') throw new TypeError('D13 runtime requires the published-event registry.');
  if (!service || typeof service.handleResponseEvaluationCommittedEvent!=='function' || typeof service.handleClassEndedEvent!=='function') {
    throw new TypeError('D13 runtime requires the Student Knowledge service.');
  }
  const evaluation=publishedEvents.register(TEACHING_EVENTS.RESPONSE_EVALUATION_COMMITTED,{
    subscriberId:'d13-skm-validated-response-evidence',
    handle:(event)=>service.handleResponseEvaluationCommittedEvent(event),
  });
  const classEnded=publishedEvents.register(TEACHING_EVENTS.CLASS_ENDED,{
    subscriberId:'d13-skm-instruction-exposure',
    handle:(event)=>service.handleClassEndedEvent(event),
  });
  return Object.freeze({registrations:Object.freeze([evaluation,classEnded])});
}

module.exports={registerD13Runtime};
