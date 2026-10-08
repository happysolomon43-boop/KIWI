'use strict';

// Browser-local admin walkthrough progress, separate from official D11/D14
// attendance, Class lifecycle, gradebook, timetable, and learning responses.
(function initAdminClassroomWalkthrough(root) {
  const PREFIX='kiwi:admin:classroom:walkthrough:v1:';
  const MAX_ROWS=500;

  function normalizeClassList(response) {
    const incoming=[
      ...(Array.isArray(response?.upcoming)?response.upcoming:[]),
      ...(Array.isArray(response?.history)?response.history:[]),
      ...(!response?.upcoming&&!response?.history&&Array.isArray(response?.classes)?response.classes:[]),
    ];
    const seen=new Set();
    return incoming.filter(row=>{
      if(!row||typeof row.class_id!=='string'||!row.class_id||seen.has(row.class_id))return false;
      if(!Number.isFinite(Date.parse(row.scheduled_start_at||'')))return false;
      seen.add(row.class_id);
      return true;
    }).sort((a,b)=>Date.parse(a.scheduled_start_at)-Date.parse(b.scheduled_start_at)||a.class_id.localeCompare(b.class_id));
  }
  function rowKey(row) {
    return String(row?.class_id||'')+'@'+String(row?.schedule_version??'');
  }
  function keyForCourse(courseId) {
    if(typeof courseId!=='string'||!/^[\w-]{8,100}$/.test(courseId))throw new TypeError('Valid KIWI Course ID required');
    return PREFIX+courseId;
  }
  function load(storage,courseId){
    try{
      const raw=JSON.parse(storage?.getItem(keyForCourse(courseId))||'{}');
      if(raw.version!==1||!raw.entries||typeof raw.entries!=='object'||Array.isArray(raw.entries))return {};
      return Object.fromEntries(Object.entries(raw.entries).filter(([key,v])=>
        key.length<=220&&v&&typeof v==='object'&&typeof v.openedAt==='string'
        &&(!v.completedAt||typeof v.completedAt==='string')).slice(-MAX_ROWS));
    }catch(_){return {};}
  }
  function persist(storage,courseId,entries){
    try{
      const latest=Object.fromEntries(Object.entries(entries).slice(-MAX_ROWS));
      storage?.setItem(keyForCourse(courseId),JSON.stringify({version:1,entries:latest}));
      return true;
    }catch(_){return false;}
  }
  function recordOpened(entries,row,when=new Date().toISOString()){
    if(!row?.class_id)throw new TypeError('Class required');
    const key=rowKey(row);
    return {...entries,[key]:{...entries[key],openedAt:entries[key]?.openedAt||when}};
  }
  function recordCompleted(entries,row,when=new Date().toISOString()){
    const key=rowKey(row);
    if(!entries[key]?.openedAt)throw new Error('Open a read-only preview before completing its test review.');
    return {...entries,[key]:{...entries[key],completedAt:entries[key]?.completedAt||when}};
  }
  function nextPending(classes,entries,afterClassId=null){
    const incomplete=classes.filter(row=>!entries[rowKey(row)]?.completedAt);
    if(!incomplete.length)return null;
    if(afterClassId){
      const at=classes.findIndex(row=>row.class_id===afterClassId);
      const later=incomplete.find(row=>classes.findIndex(v=>v.class_id===row.class_id)>at);
      if(later)return later;
    }
    return incomplete[0];
  }
  function summarize(classes,entries){
    const completed=classes.filter(row=>Boolean(entries[rowKey(row)]?.completedAt)).length;
    return {completed,total:classes.length,remaining:classes.length-completed};
  }
  const api=Object.freeze({normalizeClassList,rowKey,keyForCourse,load,persist,recordOpened,recordCompleted,nextPending,summarize});
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.KIWI_ADMIN_CLASSROOM_WALKTHROUGH=api;
})(typeof window!=='undefined'?window:null);
