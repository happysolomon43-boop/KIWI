'use strict';

// D11 PPL should not eagerly spend expensive AI-model work on the entire
// semester every time the timetable is rebuilt. Workspace creation is prompt
// and durable, but model preparation starts inside this bounded lead window.
// Due events are authoritative D02 system-time events and are revalidated
// against the live Class timetable before they can start preparation.
const PREPARATION_LEAD_HOURS=72;
const PREPARATION_LEAD_MS=PREPARATION_LEAD_HOURS*60*60*1000;
function preparationReviewDueAt(scheduledStartAt){
  const start=new Date(scheduledStartAt).getTime();
  if(!Number.isFinite(start))throw new TypeError('D11 preparation scheduling requires a valid Class start.');
  return new Date(start-PREPARATION_LEAD_MS).toISOString();
}
function shouldDeferPreparation(scheduledStartAt,now){
  const due=Date.parse(preparationReviewDueAt(scheduledStartAt));
  const instant=now instanceof Date?now.getTime():new Date(now).getTime();
  if(!Number.isFinite(instant))throw new TypeError('D11 preparation review requires authoritative current time.');
  return instant<due;
}
module.exports={PREPARATION_LEAD_HOURS,PREPARATION_LEAD_MS,preparationReviewDueAt,shouldDeferPreparation};
