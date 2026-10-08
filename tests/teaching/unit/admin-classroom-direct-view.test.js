'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const publicRoot=path.resolve(__dirname,'../../../public');
const code=name=>fs.readFileSync(path.join(publicRoot,name),'utf8');

test('Admin Classroom reuses primary KIWI D14 APIs and never requires sandbox attestation',()=>{
  const page=code('admin-classroom-test.js');
  assert.match(page,/\/teaching\/admin\/classroom-test/);
  assert.match(page,/\/source-course/);
  assert.match(page,/NORMAL_KIWI_CLASSROOM/);
  assert.match(page,/\/teaching\/courses\//);
  assert.match(page,/adminPreview:true/);
  assert.doesNotMatch(page,/\/status['"`]/);
  assert.doesNotMatch(page,/routedPath|ISOLATED_SANDBOX_ONLY|CLASSROOM_TEST_ORIGIN|sandboxFetch/);
  assert.match(page,/await import\('\/teaching-classroom\.js/);
});

test('Existing class preview cannot mark attendance and does not bypass start-time rules',()=>{
  const classroom=code('teaching-classroom.js');
  assert.match(classroom,/function open\(classId,\{reviewOnly=false\}/);
  assert.match(classroom,/if\(!reviewOnly\)await kiwiApiRequest\(`\/teaching\/classes\/\$\{encodeURIComponent\(classId\)\}\/classroom\/enter`/);
  assert.match(classroom,/button\('Preview · Read only',\(\)=>open\(item\.class_id,\{reviewOnly:true\}\)/);
  assert.match(classroom,/enter\.disabled=!item\.can_enter/);
  assert.match(classroom,/if\(state\.reviewOnly\)\{panel\.append\(notice/);
  assert.match(classroom,/state\.reviewOnly\?'/);
});

test('Admin page distinguishes real Classroom participation from no-write preview',()=>{
  const html=code('admin-classroom-test.html');
  assert.match(html,/Preview<\/strong> is read-only and does not join/);
  assert.match(html,/record actual participation/);
  assert.doesNotMatch(html,/isolated KIWI service|separately deployed KIWI instance|No verified sandbox connection/);
});
