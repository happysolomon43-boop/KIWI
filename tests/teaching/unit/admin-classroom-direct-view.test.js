'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'../../../public');
const code=name=>fs.readFileSync(path.join(root,name),'utf8');

test('Admin walkthrough uses existing KIWI D14 Classroom, not an isolated fake or shadow route',()=>{
  const page=code('admin-classroom-test.js');
  assert.match(page,/\/teaching\/admin\/classroom-test/);
  assert.match(page,/\/source-course/);
  assert.match(page,/NORMAL_KIWI_CLASSROOM/);
  assert.match(page,/\/walkthrough/);
  assert.match(page,/openClassroom\(item\.classId/);
  assert.doesNotMatch(page,/ISOLATED_SANDBOX_ONLY|routedPath|CLASSROOM_TEST_ORIGIN|sandboxFetch/);
  assert.match(page,/await import\('\/teaching-classroom\.js/);
});

test('Read-only reviewed Classes never create a real JOIN; live entry keeps authoritative time check',()=>{
  const classroom=code('teaching-classroom.js');
  assert.match(classroom,/async function open\(classId,\{reviewOnly=false,onReviewComplete=null\}/);
  assert.match(classroom,/if\(!reviewOnly\)await kiwiApiRequest\(`\/teaching\/classes\/\$\{encodeURIComponent\(classId\)\}\/classroom\/enter`/);
  assert.match(classroom,/state\.onReviewComplete=classroomTestMode&&reviewOnly/);
  assert.match(classroom,/onReviewComplete:handler/);
  assert.match(classroom,/enter\.disabled=!item\.can_enter/);
  assert.match(classroom,/if\(state\.reviewOnly\)\{panel\.append\(notice/);
  assert.match(classroom,/openClassroom:open/);
});

test('Admin mobile UI truthfully distinguishes independent reviews and formal attendance',()=>{
  const html=code('admin-classroom-test.html');
  assert.match(html,/Join test review/);
  assert.match(html,/does not academically complete the Class/);
  assert.match(html,/record attendance/);
  assert.doesNotMatch(html,/isolated KIWI service|separately deployed KIWI instance|No verified sandbox connection/);
});

test('Admin client sequences reviews and cannot treat test review as academic Class closure',()=>{
  const page=code('admin-classroom-test.js');
  assert.match(page,/onReviewComplete/);
  assert.match(page,/await mutate\(classId,'complete'\)/);
  assert.match(page,/await mutate\(updated\.currentClassId,'start'\)/);
  assert.match(page,/reviewOnly:true/);
  assert.match(page,/realCanEnter/);
  assert.doesNotMatch(page,/controller\/close|\/classroom\/enter/);
});
