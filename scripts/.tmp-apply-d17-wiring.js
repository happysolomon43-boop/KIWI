'use strict';
const fs=require('node:fs');
function edit(path,fn){const before=fs.readFileSync(path,'utf8'),after=fn(before);if(after===before)throw new Error(`No D17 wiring change applied to ${path}`);fs.writeFileSync(path,after);}
function once(text,from,to,label){if(text.includes(to))return text;if(!text.includes(from))throw new Error(`D17 wiring anchor missing: ${label}`);return text.replace(from,to);}

edit('teaching/index.js',(s)=>{
  s=once(s,'  createD16AssignmentRepository,\n} = require(\'./repositories\');','  createD16AssignmentRepository,\n  createD17AssessmentRepository,\n} = require(\'./repositories\');','teaching repo import');
  s=once(s,"const d16 = require('./d16');","const d16 = require('./d16');\nconst d17 = require('./d17');",'d17 module import');
  s=once(s,'  d16Intelligence = null,\n} = {}) {','  d16Intelligence = null,\n  d17Intelligence = null,\n} = {}) {','d17 intelligence arg');
  s=once(s,"  const d16Repository = persistentDepsReady\n    ? createD16AssignmentRepository({\n        query,\n        withTransaction,\n        randomUUID,\n        dueEventStore:d10RuntimePlatform?.eventStore || null,\n      })\n    : null;","  const d16Repository = persistentDepsReady\n    ? createD16AssignmentRepository({\n        query,\n        withTransaction,\n        randomUUID,\n        dueEventStore:d10RuntimePlatform?.eventStore || null,\n      })\n    : null;\n  const d17Repository = persistentDepsReady\n    ? createD17AssessmentRepository({ query, withTransaction, randomUUID, dueEventStore:d10RuntimePlatform?.eventStore || null })\n    : null;",'d17 repository');
  const integrityAnchor="  const d16Runtime = d16Service && d10RuntimePlatform?.eventRuntime\n    ? d16.registerD16Runtime({\n        publishedEvents:d11PublishedEventRegistry,\n        eventRuntime:d10RuntimePlatform.eventRuntime,\n        repository:d16Repository,\n        service:d16Service,\n      })\n    : null;";
  const integrityPlus=integrityAnchor+"\n\n  const d17Service = d17Repository\n    ? d17.createD17Service({ repository:d17Repository, intelligence:d17Intelligence, integrityService, randomUUID })\n    : null;\n  const d17Runtime = d17Service && d10RuntimePlatform?.eventRuntime\n    ? d17.registerD17Runtime({ eventRuntime:d10RuntimePlatform.eventRuntime, repository:d17Repository, service:d17Service })\n    : null;";
  s=once(s,integrityAnchor,integrityPlus,'d17 service/runtime');
  s=once(s,'    d16: d16Service ? Object.freeze({ repository:d16Repository, service:d16Service, runtime:d16Runtime }) : null,\n    integrity:', '    d16: d16Service ? Object.freeze({ repository:d16Repository, service:d16Service, runtime:d16Runtime }) : null,\n    d17: d17Service ? Object.freeze({ repository:d17Repository, service:d17Service, runtime:d17Runtime }) : null,\n    integrity:','d17 foundation return');
  s=once(s,'  d15,\n  d16,\n};','  d15,\n  d16,\n  d17,\n};','d17 export');
  return s;
});

edit('teaching-backend.js',(s)=>{
  s=once(s,"const { mountD16Routes } = require('./teaching/d16/routes');","const { mountD16Routes } = require('./teaching/d16/routes');\nconst { mountD17Routes } = require('./teaching/d17/routes');",'backend import');
  s=once(s,'  d16Intelligence = null,\n  teachingRuntimePlatform = null,','  d16Intelligence = null,\n  d17Intelligence = null,\n  teachingRuntimePlatform = null,','backend d17 arg');
  s=once(s,'    d16Intelligence,\n  });','    d16Intelligence,\n    d17Intelligence,\n  });','foundation d17 pass');
  const mount='  mountD16Routes(router,{foundation,sendError});';
  s=once(s,mount,mount+"\n\n  // D17 mounts formal Assessment projections/intents only. Definition, eligibility, validation,\n  // Package and Attempt truth remain server-owned; D18 will own the full Assessment Shell UX.\n  mountD17Routes(router,{foundation,sendError});",'backend d17 mount');
  return s;
});

edit('services/integrity/repository.js',(s)=>once(s,
  "    if(ownerType==='TEACHING_ASSESSMENT_ATTEMPT')throw fail('Teaching Assessment Attempt binding is reserved for the D17 Assessment owner.','KIWI_INTEGRITY_D17_OWNER_NOT_READY',409);",
  "    if(ownerType==='TEACHING_ASSESSMENT_ATTEMPT'){\n      const {rows}=await q(runner,'select a.*,d.assessment_type from public.teaching_assessment_attempts a join public.teaching_assessments d on d.assessment_id=a.assessment_id where a.student_id=$1 and a.assessment_attempt_id=$2 limit 1',[userId,ownerRef]);\n      if(!rows?.[0])throw fail('Teaching Assessment Attempt not found for integrity session.','KIWI_INTEGRITY_OWNER_NOT_FOUND',404);\n      return {kind:'TEACHING_ASSESSMENT_ATTEMPT',row:rows[0]};\n    }",'integrity D17 owner'));

edit('services/integrity/service.js',(s)=>once(s,
  "    if(ownerType==='KIWI_EXAM')return owner.row.is_reckoning?'HIGH_STAKES_EXAM':'SCHEDULED_TEST';\n    return 'HIGH_STAKES_EXAM';",
  "    if(ownerType==='KIWI_EXAM')return owner.row.is_reckoning?'HIGH_STAKES_EXAM':'SCHEDULED_TEST';\n    if(ownerType==='TEACHING_ASSESSMENT_ATTEMPT')return ['MID_SEMESTER','FINAL_EXAMINATION','RESIT'].includes(String(owner.row.assessment_type||'').toUpperCase())?'HIGH_STAKES_EXAM':'SCHEDULED_TEST';\n    return 'HIGH_STAKES_EXAM';",'integrity D17 profile'));

edit('scripts/setup-teaching-integration-db.js',(s)=>once(s,
  "  'migrations/20261002_kiwi_integrity_session_guard.sql',\n]);",
  "  'migrations/20261002_kiwi_integrity_session_guard.sql',\n  'migrations/20261002_teaching_d17_assessment_domain.sql',\n]);",'integration migration'));

edit('package.json',(s)=>{const p=JSON.parse(s);p.scripts['verify:teaching:d17']='node scripts/verify-teaching-d17-assessment-domain.js';return JSON.stringify(p,null,2)+'\n';});
console.log('D17 wiring applied.');
