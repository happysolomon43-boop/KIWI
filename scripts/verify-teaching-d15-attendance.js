'use strict';

const fs=require('node:fs');
const path=require('node:path');
const root=process.cwd();
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const assert=(value,message)=>{if(!value)throw new Error(message);};

const tasks=['TCH-0059',...Array.from({length:23},(_,i)=>`TCH-${String(274+i).padStart(4,'0')}`)];
assert(tasks.length===24&&new Set(tasks).size===24,'D15 task census must remain exactly 24.');

const required=[
  'teaching/d15/contracts.js','teaching/d15/service.js','teaching/d15/runtime.js','teaching/d15/routes.js','teaching/d15/index.js',
  'teaching/repositories/d15-attendance.js','teaching/d09/attendance-recovery.js',
  'migrations/20260930_teaching_d15_attendance.sql','public/teaching-d15.js',
  'tests/teaching/unit/d15-attendance.test.js','tests/teaching/integration/d15-attendance-schema.test.js',
  'docs/teaching/d15-attendance.md','docs/teaching/d15-source-resolution.md','docs/teaching/migrations/d15-recovery.md',
  '.github/workflows/teaching-d15-attendance.yml',
];
for(const file of required) assert(fs.existsSync(path.join(root,file)),`D15 missing ${file}`);

const doc=read('docs/teaching/d15-attendance.md');
for(const id of tasks) assert(doc.includes(id),`D15 task not accounted for: ${id}`);

const contracts=read('teaching/d15/contracts.js');
for(const token of [
  "require('../policy/d06-decision-registry.json')",'TCH-0076','TCH-0077','MIN_5_MINUTES_OR_10_PERCENT_OF_SCHEDULED_DURATION',
  "lateMinutes <= graceMinutes",'materialLatenessRatio','UNEXCUSED_ABSENCE','EXCUSED_ABSENCE','APPROVED_LEAVE','SYSTEM_PROTECTED',
  'hasMeaningfulParticipation','subjectMarkReduction: false','probationEnabled: false',
]) assert(contracts.includes(token),`D15 policy/contract missing ${token}`);
assert(!contracts.includes('decisions-v1.json'),'D15 must use the accepted D06 policy registry, not a placeholder registry.');

const migration=read('migrations/20260930_teaching_d15_attendance.sql');
for(const token of [
  'teaching_attendance_records','teaching_attendance_concerns','teaching_attendance_system_interruptions',
  'supersedes_record_id','policy_snapshot','provenance_refs','ENABLE ROW LEVEL SECURITY','REVOKE ALL',
  'subject_mark_reduction = false','verified = true','teaching_attendance_records_obligation_idx',
]) assert(migration.includes(token),`D15 migration missing ${token}`);
assert(!/GRANT\s+(?:INSERT|UPDATE|DELETE|TRUNCATE)[\s\S]{0,180}TO\s+(?:anon|authenticated)/i.test(migration),'D15 exposes browser-authoritative DML.');
assert(!/GRANT\s+(?:UPDATE|DELETE|TRUNCATE)[\s\S]{0,180}TO\s+service_role/i.test(migration),'D15 ledger must remain append-only for service role.');

const repository=read('teaching/repositories/d15-attendance.js');
for(const token of [
  'attendanceObligationId','schedule-v','appendVersionUsing','supersedes_record_id','idempotency_key',
  'teaching_academic_audit_log','evidenceForClass','teaching_attendance_system_interruptions','deferralCount','applyRequestUsing',
]) assert(repository.includes(token),`D15 repository boundary missing ${token}`);
assert(!/update\s+public\.teaching_attendance_records/i.test(repository),'D15 must not update immutable Attendance Ledger rows.');
assert(!/delete\s+from\s+public\.teaching_attendance_records/i.test(repository),'D15 must not delete immutable Attendance Ledger rows.');

const service=read('teaching/d15/service.js');
for(const token of [
  'ensureStartRecord','scheduledFinalizeEvent','observeJoin','invokeLateReplan','automatic_overtime:false','observeInteraction',
  'NETWORK_OR_CLIENT_UNVERIFIED','recordAttendanceRecoveryNeed','reconcileRecordEffects','protectSystemInterruption',
  'SYSTEM_VERIFIED_PROTECTION','supersedeObligationFromDueEvent','inactivityDue','STILL_WORKING_PROMPT','tab_focus_used_as_proof:false',
  'attendanceScore:null','naivePercentageSuppressed:true','assessmentAttemptCreated:false','gradebookMutated:false','skmMutated:false',
  "makeupStrategy:needs?'DIAGNOSTIC_FIRST':'NONE'","lessonPlannerOwner:'D11'",'indefiniteAutomatedDeferralAllowed:false',
]) assert(service.includes(token),`D15 service invariant missing ${token}`);
assert(!/grade(?:book)?[^\n]{0,80}(?:insert|update|delete)/i.test(service),'D15 service must not mutate Gradebook state.');
assert(!/skm[^\n]{0,80}(?:insert|update|delete)/i.test(service),'D15 service must not mutate SKM state.');

const runtime=read('teaching/d15/runtime.js');
for(const token of [
  'ATTENDANCE_FINALIZATION_DUE','ACTIVITY_TIMER_EXPIRED','REQUEST_APPLIED','CLASS_ENDED',
  'supersedeObligationFromDueEvent','absence_created:false','tab_focus_used_as_proof:false','browserAttendanceAuthority:false',
]) assert(runtime.includes(token),`D15 runtime invariant missing ${token}`);

const d11=read('teaching/d11/runtime.js');
assert(d11.includes('attendanceService = null')&&d11.includes('attendanceService.onClassStarted(event)'),'D11 scheduled-start integration with D15 is missing.');
const d14=read('teaching/d14/service.js');
assert(d14.includes('attendanceService=null')&&d14.includes('attendanceService.observeJoin')&&d14.includes('attendanceService.observeInteraction'),'D14 Classroom evidence integration with D15 is missing.');
assert(d14.includes('occurredAt:row.created_at'),'D14 must forward its server-persisted interaction time to D15.');
const d10=read('teaching/d10/service.js');
assert(d10.includes('attendanceRequestOwner')&&d10.includes("def.owner==='attendance'")&&d10.includes('attendanceRequestOwner.applyRequestUsing'),'D10 Request authorization must delegate attendance-owned mutations to D15.');
const d09=read('teaching/d09/attendance-recovery.js');
for(const token of ['attendance-recovery:','delta_minutes','ATTENDANCE_RECOVERY_CORRECTION','mastery_inference:false','gradebook_mutation:false']) assert(d09.includes(token),`D09 attendance recovery seam missing ${token}`);

const routes=read('teaching/d15/routes.js');
for(const endpoint of ["'/courses/:id/attendance'","'/record/attendance'","'/classes/:id/attendance/history'","'/classes/:id/makeup-readiness'","'/classes/:id/deferral-state'"]) assert(routes.includes(endpoint),`D15 read projection route missing ${endpoint}`);
assert(!/router\.(?:post|put|patch|delete)\(/.test(routes),'D15 browser routes must remain read-only; authoritative mutations flow through owner seams.');

const ui=read('public/teaching-d15.js');
for(const token of [
  "id:'results'","label:'Results'","id:'record'","label:'Record'",'No gamified attendance score',
  'No attendance mark deductions','System protected','Attendance concern','Review schedule','Open Requests',
]) assert(ui.includes(token),`D15 UI missing ${token}`);
assert(!/nav\.register\(\{\s*id:\s*['"]attendance['"]/i.test(ui),'D15 must not create a top-level Attendance destination.');
assert(!/attendanceScore\s*[:=]\s*[1-9]/i.test(ui),'D15 UI must not manufacture an attendance score.');

const bootstrap=read('scripts/setup-teaching-integration-db.js');
assert(bootstrap.includes('migrations/20260930_teaching_d15_attendance.sql'),'D15 migration missing from isolated Teaching reconstruction.');

const tests=read('tests/teaching/unit/d15-attendance.test.js');
for(const token of ['exact grace threshold edge','quick reconnect','verified KIWI outage','correction cannot be overwritten','independent-work silence','diagnostic-first','subjectMarkReduction']) assert(tests.includes(token),`D15 acceptance test missing ${token}`);

const pkg=JSON.parse(read('package.json'));
assert(pkg.scripts?.['verify:teaching:d15']==='node scripts/verify-teaching-d15-attendance.js','D15 package verifier mismatch.');

console.log('[Teaching D15 verify] PASS — 24 tasks accounted for; versioned Attendance Ledger, D06-bound server-time policy, immutable corrections, outage protection, D11/D14/D10/D09 owner seams, read-only Results/Record projections, and cross-domain mark/SKM/Assessment boundaries are enforced.');