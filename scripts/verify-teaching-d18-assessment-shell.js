'use strict';

const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const core=require('../public/assessment-shell-core');
const {createKiwiExamInterface}=require('../teaching/integrations/kiwi-exam-interface');
const {createD18AssessmentShellService}=require('../teaching/d18/service');

const root=path.join(__dirname,'..');
const required=[
  'public/assessment-shell.html',
  'public/assessment-shell.css',
  'public/assessment-shell.js',
  'public/assessment-shell-core.js',
  'teaching/d18/service.js',
  'teaching/d18/routes.js',
  'tests/teaching/unit/d18-assessment-shell.test.js',
];
for(const file of required)assert.equal(fs.existsSync(path.join(root,file)),true,`missing ${file}`);

const exam=createKiwiExamInterface();
assert.equal(exam.assessmentShell.contractVersion,'d18.v1');
assert.equal(exam.assessmentShell.responsePayload.serverAutosaveRequired,true);
assert.equal(exam.assessmentShell.responsePayload.localDraftAuthoritative,false);
assert.equal(exam.assessmentShell.timing.serverTimestampsAuthoritative,true);
assert.equal(exam.assessmentShell.timing.browserTimerProjectionOnly,true);
assert.equal(exam.assessmentShell.package.lockedBeforeExposure,true);
assert.equal(exam.assessmentShell.device.oneAuthoritativeWriter,true);
assert.match(exam.buildAssessmentShellHandoff({assessmentId:'a',packageId:'p'}).targetAppPath,/assessment-shell\.html/);

const supported=new Set(exam.assessmentShell.supportedRenderers);
for(const renderer of ['mcq','short','extended','multi_part','math_working','numeric_unit','essay','source_layout','code','visual_reserved'])assert.equal(supported.has(renderer),true,`missing renderer ${renderer}`);

const sample={package_item_id:'i',response_family:'MCQ',intended_marks:1,public_item_payload:{options:['A','B']},choice_set_contract:{stable_option_ids:['a','b']},item_state:'ACTIVE'};
assert.equal(core.describeRenderer(sample).kind,'mcq');
assert.doesNotThrow(()=>core.assertBrowserSafe({public_item_payload:{prompt:'safe'}}));
assert.throws(()=>core.assertBrowserSafe({protected_payload:{answer:'x'}}));

assert.throws(()=>createD18AssessmentShellService({repository:{}}),/accepted D17 Assessment repository/);

const html=fs.readFileSync(path.join(root,'public/assessment-shell.html'),'utf8');
const browser=fs.readFileSync(path.join(root,'public/assessment-shell.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public/assessment-shell.css'),'utf8');
for(const marker of ['responseLayer','questionGrid','reviewDialog','deviceDialog','saveState','timerValue'])assert.match(html,new RegExp(marker));
for(const marker of ['replayQueue','serverOffsetMs','device_authority','idempotencyKey','core.canonicalPayload','TEACHING_ASSESSMENT_ATTEMPT'])assert.match(browser,new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
assert.match(css,/prefers-reduced-motion/);
assert.match(css,/focus-visible/);

console.log('KIWI Teaching D18 Assessment Shell verification passed.');
