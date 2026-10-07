'use strict';

const { assertAcademicTimestamp } = require('../domain/time');
const {
  assertIanaTimezone, instructionalMinutes, headroomPolicy, digest,
} = require('./contracts');

const DAY_MS = 86400000;
const MINUTE_MS = 60000;
const DEFAULT_HORIZON = Object.freeze({ imminentDays:7, concreteDays:28 });

function dateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit',
    second:'2-digit', hourCycle:'h23', weekday:'short',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((p)=>p.type!=='literal').map((p)=>[p.type,p.value]));
}
function dateKey(date, timeZone) {
  const p = dateParts(date,timeZone);
  return p.year+'-'+p.month+'-'+p.day;
}
function addDateKey(key, days) {
  const [y,m,d]=key.split('-').map(Number);
  return new Date(Date.UTC(y,m-1,d+days)).toISOString().slice(0,10);
}
function weekdayOfKey(key) {
  const [y,m,d]=key.split('-').map(Number);
  return new Date(Date.UTC(y,m-1,d)).getUTCDay();
}
function localTargetMs(key, time) {
  const [y,m,d]=key.split('-').map(Number);
  const [hh,mm]=time.split(':').map(Number);
  return Date.UTC(y,m-1,d,hh,mm,0,0);
}
function matchesLocal(ms,key,time,timeZone) {
  const p=dateParts(new Date(ms),timeZone);
  return p.year+'-'+p.month+'-'+p.day===key && p.hour+':'+p.minute===time;
}
function zonedLocalToInstant(key,time,timeZone) {
  assertIanaTimezone(timeZone);
  const target=localTargetMs(key,time);
  let guess=target;
  for(let i=0;i<5;i+=1){
    const p=dateParts(new Date(guess),timeZone);
    const observed=Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute),0,0);
    const delta=target-observed;
    if(delta===0) break;
    guess+=delta;
  }
  const matches=[];
  for(let delta=-180;delta<=180;delta+=15){
    const candidate=guess+delta*MINUTE_MS;
    if(matchesLocal(candidate,key,time,timeZone)) matches.push(candidate);
  }
  if(!matches.length){
    const error=new Error('Local schedule time '+key+' '+time+' does not exist in '+timeZone+' because of a timezone transition.');
    error.code='TEACHING_D09_LOCAL_TIME_NONEXISTENT';
    error.status=422;
    throw error;
  }
  return new Date(Math.min(...matches)).toISOString();
}
function overlap(aStart,aEnd,bStart,bEnd) {
  return Date.parse(aStart)<Date.parse(bEnd) && Date.parse(bStart)<Date.parse(aEnd);
}
function minutesBetween(start,end) {
  return Math.max(0,Math.floor((Date.parse(end)-Date.parse(start))/MINUTE_MS));
}
function localDateRange(semester) {
  const tz=semester.timezone;
  const start=dateKey(new Date(semester.starts_at || semester.startsAt),tz);
  const end=dateKey(new Date((semester.ends_at || semester.endsAt)),tz);
  const out=[];
  for(let k=start;k<=end;k=addDateKey(k,1)) out.push(k);
  return out;
}
function rowValue(row, snake, camel) { return row?.[snake] ?? row?.[camel] ?? null; }

function subtractIntervals(start,end,intervals) {
  let pieces=[{start,end}];
  for(const interval of intervals){
    const bs=rowValue(interval,'starts_at','startsAt'), be=rowValue(interval,'ends_at','endsAt');
    const next=[];
    for(const piece of pieces){
      if(!overlap(piece.start,piece.end,bs,be)){ next.push(piece); continue; }
      if(Date.parse(bs)>Date.parse(piece.start)) next.push({start:piece.start,end:new Date(Math.min(Date.parse(bs),Date.parse(piece.end))).toISOString()});
      if(Date.parse(be)<Date.parse(piece.end)) next.push({start:new Date(Math.max(Date.parse(be),Date.parse(piece.start))).toISOString(),end:piece.end});
    }
    pieces=next.filter((piece)=>Date.parse(piece.end)>Date.parse(piece.start));
  }
  return pieces;
}
function buildPeriods(context) {
  const semester=context.semester;
  const tz=assertIanaTimezone(semester.timezone);
  const dates=localDateRange(semester);
  const recurring=context.availability || [];
  const blocks=context.blocks || [];
  const periods=[];
  for(const key of dates){
    const dow=weekdayOfKey(key);
    const rows=recurring.filter((row)=>Number(rowValue(row,'day_of_week','dayOfWeek'))===dow);
    const hardRecurring=rows.filter((row)=>String(row.kind)==='HARD_UNAVAILABLE');
    for(const row of rows.filter((r)=>['AVAILABLE','RECOVERY_ONLY'].includes(String(r.kind)))){
      const effectiveStart=rowValue(row,'effective_start_date','effectiveStartDate');
      const effectiveEnd=rowValue(row,'effective_end_date','effectiveEndDate');
      if(effectiveStart && key<effectiveStart) continue;
      if(effectiveEnd && key>effectiveEnd) continue;
      let start=zonedLocalToInstant(key,String(rowValue(row,'local_start','startLocal')).slice(0,5),tz);
      let end=zonedLocalToInstant(key,String(rowValue(row,'local_end','endLocal')).slice(0,5),tz);
      const semesterStart=semester.starts_at || semester.startsAt;
      const semesterEnd=semester.ends_at || semester.endsAt;
      if(Date.parse(start)<Date.parse(semesterStart)) start=new Date(semesterStart).toISOString();
      if(Date.parse(end)>Date.parse(semesterEnd)) end=new Date(semesterEnd).toISOString();
      if(Date.parse(end)<=Date.parse(start)) continue;
      const cuts=[];
      for(const hard of hardRecurring){
        cuts.push({
          startsAt:zonedLocalToInstant(key,String(rowValue(hard,'local_start','startLocal')).slice(0,5),tz),
          endsAt:zonedLocalToInstant(key,String(rowValue(hard,'local_end','endLocal')).slice(0,5),tz),
        });
      }
      for(const block of blocks){
        if(rowValue(block,'course_id','courseId')) continue;
        if(!['HARD_UNAVAILABLE','BREAK','HOLIDAY','TRAVEL'].includes(String(rowValue(block,'block_kind','kind')))) continue;
        if(overlap(start,end,rowValue(block,'starts_at','startsAt'),rowValue(block,'ends_at','endsAt'))) cuts.push(block);
      }
      for(const piece of subtractIntervals(start,end,cuts)){
        periods.push({
          key,dow,start:piece.start,end:piece.end,kind:String(row.kind),minutes:minutesBetween(piece.start,piece.end),
          preferenceWeight:Number(rowValue(row,'preference_weight','preferenceWeight'))||0,
        });
      }
    }
  }
  return periods.sort((a,b)=>Date.parse(a.start)-Date.parse(b.start) || b.preferenceWeight-a.preferenceWeight);
}
function isProtectedBlockCompatible(block,taskKind){
  const kind=String(rowValue(block,'block_kind','kind'));
  if(kind==='PROTECTED_REVISION') return taskKind==='REVISION_RESERVE';
  if(kind==='PROTECTED_ASSESSMENT') return taskKind==='ASSESSMENT_RESERVE';
  return false;
}
function conflictsForWork(context,work,task,start,end){
  return (context.blocks||[]).some((block)=>{
    const courseId=rowValue(block,'course_id','courseId');
    if(courseId && String(courseId)!==String(work.courseId)) return false;
    if(!overlap(start,end,rowValue(block,'starts_at','startsAt'),rowValue(block,'ends_at','endsAt'))) return false;
    return !isProtectedBlockCompatible(block,task.kind);
  });
}
function protectedPreference(context,work,task,start,end){
  return (context.blocks||[]).some((block)=>{
    const courseId=rowValue(block,'course_id','courseId');
    if(courseId && String(courseId)!==String(work.courseId)) return false;
    return isProtectedBlockCompatible(block,task.kind)
      && overlap(start,end,rowValue(block,'starts_at','startsAt'),rowValue(block,'ends_at','endsAt'));
  }) ? 500 : 0;
}
function topologicalUnits(courseBundle) {
  const units=courseBundle.units || [];
  const byId=new Map(units.map((u)=>[String(u.learning_unit_id),u]));
  const deps=new Map(units.map((u)=>[String(u.learning_unit_id),[]]));
  for(const edge of courseBundle.dependencies || []){
    const id=String(edge.learning_unit_id);
    const pre=String(edge.prerequisite_learning_unit_id);
    if(deps.has(id)&&byId.has(pre)) deps.get(id).push(pre);
  }
  const done=new Set(), visiting=new Set(), ordered=[];
  function visit(id){
    if(done.has(id)) return;
    if(visiting.has(id)){ const e=new Error('Learning Unit dependency cycle prevents scheduling.'); e.code='TEACHING_D09_DEPENDENCY_CYCLE'; throw e; }
    visiting.add(id);
    for(const pre of deps.get(id)||[]) visit(pre);
    visiting.delete(id); done.add(id); ordered.push(byId.get(id));
  }
  for(const id of byId.keys()) visit(id);
  return ordered;
}
function deadlineFor(courseId, deadlines, semesterEnd) {
  const rows=(deadlines||[]).filter((d)=>!rowValue(d,'course_id','courseId') || String(rowValue(d,'course_id','courseId'))===String(courseId));
  const hard=rows.filter((d)=>String(rowValue(d,'deadline_kind','kind'))==='HARD').sort((a,b)=>Date.parse(rowValue(a,'deadline_at','deadlineAt'))-Date.parse(rowValue(b,'deadline_at','deadlineAt')))[0];
  const flexible=rows.filter((d)=>String(rowValue(d,'deadline_kind','kind'))==='FLEXIBLE').sort((a,b)=>Date.parse(rowValue(a,'deadline_at','deadlineAt'))-Date.parse(rowValue(b,'deadline_at','deadlineAt')))[0];
  const hardAt=hard?rowValue(hard,'deadline_at','deadlineAt'):null;
  const flexibleAt=flexible?rowValue(flexible,'deadline_at','deadlineAt'):null;
  return { hard:hardAt, flexible:flexibleAt, target:hardAt||flexibleAt||semesterEnd, kind:hard?'HARD':flexible?'FLEXIBLE':'SEMESTER' };
}
function buildCourseWork(context) {
  const reserves=context.reserves||[];
  return (context.courses||[]).map((bundle)=>{
    const courseId=String(bundle.course.course_id);
    const units=topologicalUnits(bundle);
    const tasks=[];
    let minInstruction=0,maxInstruction=0;
    for(const unit of units){
      const load=instructionalMinutes(unit);
      minInstruction+=load.min; maxInstruction+=load.max;
      if(load.max>0) tasks.push({
        kind:'CLASS', courseId, learningUnitIds:[String(unit.learning_unit_id)],
        title:unit.title, remaining:load.max, minimum:load.min, sourceMax:load.max,
      });
    }
    let reserveMinutes=0;
    for(const reserve of reserves.filter((r)=>!rowValue(r,'course_id','courseId') || String(rowValue(r,'course_id','courseId'))===courseId)){
      const minutes=Number(reserve.minutes)||0;
      const reserveKind=String(rowValue(reserve,'reserve_kind','kind')||'REVISION');
      reserveMinutes+=minutes;
      if(minutes>0) tasks.push({
        kind:reserveKind==='ASSESSMENT'?'ASSESSMENT_RESERVE':'REVISION_RESERVE',
        courseId, learningUnitIds:[], title:reserve.kind==='ASSESSMENT'?'Assessment capacity':'Revision capacity',
        remaining:minutes, minimum:minutes, sourceMax:minutes,
      });
    }
    const deadline=deadlineFor(courseId,context.deadlines,context.semester.ends_at);
    return {
      bundle,courseId,tasks,minInstruction,maxInstruction,reserveMinutes,deadline,
      requiredMinutes:maxInstruction+reserveMinutes,
      scheduledMinutes:0,lastDate:null,
    };
  });
}
function horizonStage(start,now,settings={}) {
  const cfg={...DEFAULT_HORIZON,...(settings.horizon||{})};
  const days=Math.floor((Date.parse(start)-Date.parse(now))/DAY_MS);
  if(days<=Number(cfg.imminentDays)) return 'IMMINENT';
  if(days<=Number(cfg.concreteDays)) return 'NEAR_TERM';
  return 'DISTANT';
}
function preferenceScore(period,work,preferences) {
  let score=period.preferenceWeight||0;
  const preferredTimes=preferences?.preferredStartTimes||preferences?.preferred_start_times||[];
  const p=dateParts(new Date(period.start),work.bundle.semesterTimezone || work.bundle.course.timezone || 'UTC');
  if(preferredTimes.includes(p.hour+':'+p.minute)) score+=30;
  const preferredDays=preferences?.preferredDays||preferences?.preferred_days||[];
  if(preferredDays.map(Number).includes(period.dow)) score+=10;
  if(work.lastDate && addDateKey(work.lastDate,1)===period.key && preferences?.avoidConsecutiveSameCourseDays!==false) score-=25;
  return score;
}
function alternativesFor(reasons, context, courseWork) {
  const out=[];
  const add=(code,message,academicImpact='NONE')=>{ if(!out.some((x)=>x.code===code)) out.push({code,message,academicImpact}); };
  if(reasons.some((r)=>r.includes('AVAILABILITY')||r.includes('CAPACITY'))) add('INCREASE_AVAILABILITY','Add or widen non-conflicting availability while preserving breaks and protected time.');
  if(reasons.some((r)=>r.includes('HEADROOM'))) add('USE_RECOVERY_CAPACITY_WITH_REVIEW','A justified exception may use part of recovery headroom only while the D06 minimum remains intact.','REDUCES_RECOVERY_BUFFER');
  if(courseWork.some((w)=>w.deadline.kind==='FLEXIBLE')) add('EXTEND_FLEXIBLE_TARGET','Move a flexible target later and recalculate; hard deadlines are not moved silently.');
  add('KEEP_REQUIRED_SCOPE_AND_SURFACE_INFEASIBILITY','Keep all required Learning Units and record the schedule as infeasible rather than deleting curriculum.');
  return out;
}
function priorPlacementIndex(context, now) {
  const byStart=new Map();
  for(const slot of context.priorSlots||[]){
    const start=rowValue(slot,'starts_at','startsAt');
    const end=rowValue(slot,'ends_at','endsAt');
    if(!start||!end||Date.parse(end)<=Date.parse(now)) continue;
    const courseId=String(rowValue(slot,'course_id','courseId')||'');
    const kind=String(rowValue(slot,'slot_kind','kind')||'CLASS');
    const key=courseId+'|'+kind+'|'+start;
    const learningUnitRefs=rowValue(slot,'learning_unit_refs','learningUnitRefs')||[];
    byStart.set(key,Object.freeze({
      courseId,kind,start,end,
      learningUnitRefs:Object.freeze(Array.isArray(learningUnitRefs)?learningUnitRefs.map(String):[]),
    }));
  }
  return byStart;
}

function stablePlacementScore(index,work,task,start,end,now,settings={}) {
  const prior=index.get(String(work.courseId)+'|'+String(task.kind)+'|'+String(start));
  if(!prior) return 0;
  if(task.kind==='CLASS'&&prior.learningUnitRefs.length){
    const taskRefs=new Set((task.learningUnitIds||[]).map(String));
    if(!prior.learningUnitRefs.some((ref)=>taskRefs.has(ref))) return 0;
  }
  const priorMinutes=minutesBetween(prior.start,prior.end);
  const candidateMinutes=minutesBetween(start,end);
  if(priorMinutes<=0||candidateMinutes<=0) return 0;
  const overlapRatio=Math.min(priorMinutes,candidateMinutes)/Math.max(priorMinutes,candidateMinutes);
  const stage=horizonStage(start,now,settings);
  const base=stage==='IMMINENT'?16:stage==='NEAR_TERM'?8:3;
  return base*overlapRatio;
}

function portfolioBalanceScore(work) {
  if(!Number.isFinite(work.requiredMinutes)||work.requiredMinutes<=0) return 0;
  return -60*(work.scheduledMinutes/work.requiredMinutes);
}

function deadlinePriorityScore(work,end) {
  if(!work.deadline?.target) return 0;
  const remainingDays=Math.max(0,(Date.parse(work.deadline.target)-Date.parse(end))/DAY_MS);
  if(work.deadline.kind==='HARD') return 24+Math.max(0,18-Math.min(18,remainingDays));
  if(work.deadline.kind==='FLEXIBLE') return 6+Math.max(0,8-Math.min(8,remainingDays/2));
  return 0;
}

function countStablePlacements(schedule,priorSlots=[]) {
  const prior=new Set((priorSlots||[]).map((slot)=>[
    String(rowValue(slot,'course_id','courseId')||''),
    String(rowValue(slot,'slot_kind','kind')||'CLASS'),
    String(rowValue(slot,'starts_at','startsAt')||''),
    String(rowValue(slot,'ends_at','endsAt')||''),
  ].join('|')));
  return (schedule||[]).filter((slot)=>prior.has([
    String(slot.courseId||''),
    String(slot.kind||'CLASS'),
    String(slot.startsAt||''),
    String(slot.endsAt||''),
  ].join('|'))).length;
}

function computeSchedule(context,{now=new Date().toISOString()}={}) {
  assertAcademicTimestamp(now,'now');
  const periods=buildPeriods(context);
  const work=buildCourseWork(context);
  const policy=headroomPolicy();
  const totalCapacity=periods.reduce((sum,p)=>sum+p.minutes,0);
  const targetCore=Math.floor(totalCapacity*policy.coreCapacityCeilingAtTarget);
  const maxCore=Math.floor(totalCapacity*(1-policy.minimumRatio));
  const required=work.reduce((sum,w)=>sum+w.requiredMinutes,0);
  const initialReasons=[];
  if(!periods.length && required>0) initialReasons.push('NO_USABLE_AVAILABILITY');
  if(required>maxCore) initialReasons.push('RECOVERY_HEADROOM_BELOW_MINIMUM');
  const scheduleLimit=Math.min(required,maxCore);
  const slots=[];
  const dayCounts=new Map();
  const preferences=context.profile?.preferences || context.preferences || {};
  const settings=context.profile?.settings||context.settings||{};
  const priorIndex=priorPlacementIndex(context,now);
  let scheduledTotal=0;
  const usable=periods.map((p)=>({...p,cursor:p.start}));
  let safety=0;
  while(scheduledTotal<scheduleLimit && work.some((w)=>w.tasks.some((t)=>t.remaining>0)) && safety<100000){
    safety+=1;
    let best=null;
    for(const period of usable){
      const cursorMs=Date.parse(period.cursor);
      if(cursorMs>=Date.parse(period.end)) continue;
      for(const w of work){
        const task=w.tasks.find((t)=>t.remaining>0);
        if(!task) continue;
        const count=dayCounts.get(period.key)||0;
        if(task.kind==='CLASS' && count>=2) continue;
        const available=minutesBetween(period.cursor,period.end);
        if(available<=0) continue;
        const minutes=Math.min(task.remaining,available,scheduleLimit-scheduledTotal);
        if(minutes<=0) continue;
        const candidateEnd=new Date(cursorMs+minutes*MINUTE_MS).toISOString();
        if(w.deadline.hard && Date.parse(candidateEnd)>Date.parse(w.deadline.hard)) continue;
        if(conflictsForWork(context,w,task,period.cursor,candidateEnd)) continue;
        const score=preferenceScore(period,w,preferences)
          + protectedPreference(context,w,task,period.cursor,candidateEnd)
          + stablePlacementScore(priorIndex,w,task,period.cursor,candidateEnd,now,settings)
          + portfolioBalanceScore(w)
          + deadlinePriorityScore(w,candidateEnd)
          - (task.kind==='CLASS' && w.lastDate===period.key?40:0)
          - (period.kind==='RECOVERY_ONLY' && task.kind!=='RECOVERY'?10000:0);
        if(period.kind==='RECOVERY_ONLY' && task.kind!=='RECOVERY') continue;
        if(!best || score>best.score || (score===best.score && Date.parse(period.cursor)<Date.parse(best.period.cursor))){
          best={period,w,task,minutes,score};
        }
      }
    }
    if(!best) break;
    const start=best.period.cursor;
    const end=new Date(Date.parse(start)+best.minutes*MINUTE_MS).toISOString();
    const count=dayCounts.get(best.period.key)||0;
    const spacingException=best.task.kind==='CLASS' && best.w.lastDate && addDateKey(best.w.lastDate,1)===best.period.key;
    slots.push({
      courseId:best.w.courseId,kind:best.task.kind,startsAt:start,endsAt:end,timezone:context.semester.timezone,
      localDate:best.period.key,learningUnitIds:[...best.task.learningUnitIds],plannedMinutes:best.minutes,
      horizonStage:horizonStage(start,now,context.profile?.settings||{}),
      exceptionCodes:Object.freeze(spacingException?['CONSECUTIVE_SAME_COURSE_DAY_PLACEMENT_REQUIRED_BY_FEASIBLE_CAPACITY']:[]),
      rationale:best.task.kind==='CLASS'
        ? 'Instructional-load allocation from the current Course Plan.'
        : 'Capacity reserved from Course start for '+best.task.kind.toLowerCase().replaceAll('_',' ')+'.',
    });
    best.task.remaining-=best.minutes;
    best.w.scheduledMinutes+=best.minutes;
    if(best.task.kind==='CLASS'){
      best.w.lastDate=best.period.key;
      dayCounts.set(best.period.key,count+1);
    }
    best.period.cursor=end;
    scheduledTotal+=best.minutes;
  }
  const stableSlotsRetained=countStablePlacements(slots,context.priorSlots||[]);
  const unscheduled=work.reduce((sum,w)=>sum+w.tasks.reduce((s,t)=>s+t.remaining,0),0);
  const reasons=[...initialReasons];
  if(unscheduled>0) reasons.push('REQUIRED_INSTRUCTIONAL_LOAD_UNSCHEDULED');
  for(const w of work){
    const last=slots.filter((s)=>s.courseId===w.courseId).sort((a,b)=>Date.parse(b.endsAt)-Date.parse(a.endsAt))[0];
    const remaining=w.tasks.reduce((sum,task)=>sum+task.remaining,0);
    if(w.deadline.hard && (remaining>0 || !last || Date.parse(last.endsAt)>Date.parse(w.deadline.hard))) reasons.push('HARD_DEADLINE_CANNOT_BE_MET:'+w.courseId);
    if(w.deadline.flexible && last && Date.parse(last.endsAt)>Date.parse(w.deadline.flexible)) reasons.push('FLEXIBLE_TARGET_PRESSURE:'+w.courseId);
  }
  const headroomRatio=required===0&&scheduledTotal===0?1:totalCapacity===0?0:Math.max(0,(totalCapacity-scheduledTotal)/totalCapacity);
  let outcome='FEASIBLE';
  if(reasons.some((r)=>r.startsWith('HARD_DEADLINE')||r==='REQUIRED_INSTRUCTIONAL_LOAD_UNSCHEDULED'||r==='NO_USABLE_AVAILABILITY'||r==='RECOVERY_HEADROOM_BELOW_MINIMUM')) outcome='INFEASIBLE';
  else if(headroomRatio<policy.targetRatio || reasons.some((r)=>r.startsWith('FLEXIBLE_TARGET_PRESSURE'))) outcome='AT_RISK';
  const debtMinutes=Math.max(0,required-scheduledTotal);
  return Object.freeze({
    outcome,
    schedule: Object.freeze(slots.sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt))),
    reasons:Object.freeze([...new Set(reasons)]),
    alternatives:Object.freeze(outcome==='FEASIBLE'?[]:alternativesFor(reasons,context,work)),
    metrics:Object.freeze({
      totalCapacityMinutes:totalCapacity,targetCoreCapacityMinutes:targetCore,minimumSafeCoreCapacityMinutes:maxCore,
      requiredMinutes:required,scheduledMinutes:scheduledTotal,unscheduledMinutes:unscheduled,
      headroomRatio:Number(headroomRatio.toFixed(4)),debtMinutes,
      courseCount:work.length,normalDailyFullClassMaximum:2,stableSlotsRetained,
    }),
    courseSummaries:Object.freeze(work.map((w)=>Object.freeze({
      courseId:w.courseId,requiredMinutes:w.requiredMinutes,scheduledMinutes:w.scheduledMinutes,
      instructionalLoadMinMinutes:w.minInstruction,instructionalLoadMaxMinutes:w.maxInstruction,
      reserveMinutes:w.reserveMinutes,deadlineKind:w.deadline.kind,targetAt:w.deadline.target,
    }))),
    policy:Object.freeze({
      headroomPolicyVersion:policy.policyVersion,targetHeadroomRatio:policy.targetRatio,minimumHeadroomRatio:policy.minimumRatio,
      hardConstraintsMayBeViolated:false,requiredContentMayBeDeleted:false,
      stableTimetablePreference:true,stabilityPolicy:'SOFT_PORTFOLIO_PREFERENCE',sameCourseSpacingPreference:true,
    }),
    stateDigest:digest({
      semester:[context.semester.semester_id,context.semester.state_version,context.semester.starts_at,context.semester.ends_at,context.semester.timezone],
      profile:context.profile?.profile_id||null,profileVersion:context.profile?.version_no||null,
      courses:work.map((w)=>[w.courseId,w.bundle.plan?.course_plan_id,w.bundle.plan?.version_no,w.requiredMinutes]),
      schedule:slots.map((slot)=>[slot.courseId,slot.kind,slot.startsAt,slot.endsAt,slot.plannedMinutes]),
      reasons,
    }),
  });
}
function validateEditedSchedule(context, existingSlots, edits,{now=new Date().toISOString()}={}) {
  const byId=new Map(existingSlots.map((s)=>[String(s.timetable_slot_id||s.slotId),{...s}]));
  for(const edit of edits||[]){
    const id=String(edit.slotId||'');
    if(!byId.has(id)){ const e=new Error('Unknown timetable slot '+id+'.'); e.status=404; e.code='TEACHING_D09_SLOT_NOT_FOUND'; throw e; }
    assertAcademicTimestamp(edit.startsAt,'edit.startsAt'); assertAcademicTimestamp(edit.endsAt,'edit.endsAt');
    if(Date.parse(edit.endsAt)<=Date.parse(edit.startsAt)){ const e=new Error('Edited slot end must be after start.'); e.status=422; e.code='TEACHING_D09_SLOT_RANGE_INVALID'; throw e; }
    byId.set(id,{...byId.get(id),starts_at:edit.startsAt,ends_at:edit.endsAt,startsAt:edit.startsAt,endsAt:edit.endsAt,
      exception_reason:edit.exceptionReason||null});
  }
  const slots=[...byId.values()].map((s)=>({
    ...s,startsAt:s.startsAt||s.starts_at,endsAt:s.endsAt||s.ends_at,courseId:s.courseId||s.course_id,kind:s.kind||s.slot_kind,
    learningUnitIds:s.learningUnitIds||s.learning_unit_refs||[],plannedMinutes:minutesBetween(s.startsAt||s.starts_at,s.endsAt||s.ends_at),
    timezone:s.timezone||context.semester.timezone,horizonStage:horizonStage(s.startsAt||s.starts_at,now,context.profile?.settings||{}),
    exceptionCodes:s.exception_reason?['STUDENT_JUSTIFIED_PREACTIVATION_EDIT']:[],rationale:s.rationale||'Pre-activation timetable edit.',
  }));
  const semesterStart=Date.parse(context.semester.starts_at),semesterEnd=Date.parse(context.semester.ends_at);
  const hardBlocks=context.blocks||[];
  const dayCounts=new Map();
  for(const slot of slots){
    if(Date.parse(slot.startsAt)<semesterStart||Date.parse(slot.endsAt)>semesterEnd){
      const e=new Error('Edited slot falls outside Semester boundaries.'); e.status=422; e.code='TEACHING_D09_HARD_SEMESTER_BOUNDARY_VIOLATION'; throw e;
    }
    for(const block of hardBlocks){
      const blockCourse=rowValue(block,'course_id','courseId');
      if(blockCourse && String(blockCourse)!==String(slot.courseId)) continue;
      if(overlap(slot.startsAt,slot.endsAt,rowValue(block,'starts_at','startsAt'),rowValue(block,'ends_at','endsAt')) && !isProtectedBlockCompatible(block,slot.kind)){
        const e=new Error('Edited slot conflicts with a hard unavailable, break, holiday, travel or protected period.'); e.status=422; e.code='TEACHING_D09_HARD_CONSTRAINT_VIOLATION'; throw e;
      }
    }
    if(slot.kind==='CLASS'){
      const key=dateKey(new Date(slot.startsAt),context.semester.timezone);
      dayCounts.set(key,(dayCounts.get(key)||0)+1);
    }
  }
  for(const [key,count] of dayCounts){
    if(count>2 && !slots.filter((s)=>s.kind==='CLASS' && dateKey(new Date(s.startsAt),context.semester.timezone)===key).every((s)=>s.exception_reason||s.exceptionCodes?.length)){
      const e=new Error('More than two full Teaching Classes in one day requires an explicit justified exception.'); e.status=422; e.code='TEACHING_D09_DAILY_CLASS_LIMIT_EXCEPTION_REQUIRED'; throw e;
    }
  }
  for(let i=0;i<slots.length;i+=1) for(let j=i+1;j<slots.length;j+=1){
    if(overlap(slots[i].startsAt,slots[i].endsAt,slots[j].startsAt,slots[j].endsAt)){
      const e=new Error('Edited timetable contains overlapping Teaching slots.'); e.status=422; e.code='TEACHING_D09_SLOT_OVERLAP'; throw e;
    }
  }
  const required=(context.courses||[]).reduce((sum,b)=>sum+topologicalUnits(b).reduce((s,u)=>s+instructionalMinutes(u).max,0),0)
    +(context.reserves||[]).reduce((s,r)=>s+(Number(r.minutes)||0),0);
  const scheduled=slots.reduce((s,x)=>s+minutesBetween(x.startsAt,x.endsAt),0);
  const periods=buildPeriods(context);
  const totalCapacity=periods.reduce((s,p)=>s+p.minutes,0);
  const policy=headroomPolicy();
  const headroomRatio=required===0&&scheduled===0?1:totalCapacity===0?0:Math.max(0,(totalCapacity-scheduled)/totalCapacity);
  const debt=Math.max(0,required-scheduled);
  const reasons=[];
  if(headroomRatio<policy.minimumRatio) reasons.push('RECOVERY_HEADROOM_BELOW_MINIMUM');
  if(debt>0) reasons.push('REQUIRED_INSTRUCTIONAL_LOAD_UNSCHEDULED');
  const outcome=reasons.length?'INFEASIBLE':headroomRatio<policy.targetRatio?'AT_RISK':'FEASIBLE';
  return Object.freeze({
    outcome,schedule:Object.freeze(slots),reasons:Object.freeze(reasons),
    alternatives:Object.freeze(outcome==='FEASIBLE'?[]:alternativesFor(reasons,context,[])),
    metrics:Object.freeze({
      totalCapacityMinutes:totalCapacity,requiredMinutes:required,scheduledMinutes:scheduled,
      unscheduledMinutes:debt,headroomRatio:Number(headroomRatio.toFixed(4)),debtMinutes:debt,
      courseCount:(context.courses||[]).length,normalDailyFullClassMaximum:2,
    }),
    policy:Object.freeze({headroomPolicyVersion:policy.policyVersion,targetHeadroomRatio:policy.targetRatio,minimumHeadroomRatio:policy.minimumRatio,
      hardConstraintsMayBeViolated:false,requiredContentMayBeDeleted:false}),
    stateDigest:digest({edit:slots.map((s)=>[s.courseId,s.startsAt,s.endsAt,s.kind]),profile:context.profile?.version_no}),
  });
}
function projectCalendarSlot(slot,currentTimeZone) {
  const zone=assertIanaTimezone(currentTimeZone);
  const start=slot.scheduled_start_at||slot.starts_at||slot.startsAt;
  const end=slot.scheduled_end_at||slot.ends_at||slot.endsAt;
  const format=(value)=>new Intl.DateTimeFormat('en-GB',{timeZone:zone,dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
  return Object.freeze({...slot,displayTimeZone:zone,displayStart:format(start),displayEnd:format(end),
    authoritativeTimestampSource:'server',displayProjectionOnly:true});
}

module.exports = {
  DEFAULT_HORIZON,dateParts,dateKey,addDateKey,weekdayOfKey,zonedLocalToInstant,overlap,minutesBetween,
  subtractIntervals,buildPeriods,topologicalUnits,buildCourseWork,priorPlacementIndex,stablePlacementScore,portfolioBalanceScore,deadlinePriorityScore,countStablePlacements,computeSchedule,validateEditedSchedule,projectCalendarSlot,
};