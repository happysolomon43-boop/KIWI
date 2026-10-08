'use strict';

const MIN_GAP_MINUTES = 180;
const MAX_SAME_DAY_GAP_MINUTES = 480;
const MINUTE_MS = 60000;
function normalize(slot) {
  return {kind:slot.kind||slot.slot_kind, start:Date.parse(slot.startsAt||slot.starts_at), end:Date.parse(slot.endsAt||slot.ends_at)};
}
const dayFormatters=new Map();
function localDay(ms, timezone) {
  if(!dayFormatters.has(timezone))dayFormatters.set(timezone,new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}));
  return dayFormatters.get(timezone).format(new Date(ms));
}
function spacingAllowed(start, end, slots, timezone) {
  const a=Date.parse(start), b=Date.parse(end);
  return slots.every((slot)=>{
    const other=normalize(slot);if(other.kind!=='CLASS')return true;
    const gap=(b<=other.start?other.start-b:a>=other.end?a-other.end:-1)/MINUTE_MS;
    return gap>=MIN_GAP_MINUTES && (localDay(a,timezone)!==localDay(other.start,timezone)||gap<=MAX_SAME_DAY_GAP_MINUTES);
  });
}
function assertClassSpacing(slots, timezone, {now=null}={}) {
  const classes=slots.filter((slot)=>normalize(slot).kind==='CLASS' && (!now || normalize(slot).end>Date.parse(now)))
    .sort((a,b)=>normalize(a).start-normalize(b).start);
  // Compare neighbours: the maximum applies between consecutive Classes, not
  // nonadjacent Classes separated by another lesson.
  for(let i=1;i<classes.length;i++){
    if(!spacingAllowed(classes[i].startsAt||classes[i].starts_at,classes[i].endsAt||classes[i].ends_at,[classes[i-1]],timezone)){
      const error=new Error('Teaching Classes need at least 3 hours between the end of one Class and the start of the next, and at most 8 hours between same-day Classes. Rebuild the timetable or choose another time.');
      error.code='TEACHING_D09_INTERCLASS_GAP_VIOLATION';error.status=422;throw error;
    }
  }
}
module.exports={MIN_GAP_MINUTES,MAX_SAME_DAY_GAP_MINUTES,spacingAllowed,assertClassSpacing};
