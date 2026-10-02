from pathlib import Path

INDEX_PATH = Path('index.html')
GUARD_PATH = Path('public/kiwi-integrity-session-guard.js')
TEST_PATH = Path('tests/teaching/unit/study-global-exam-integrity-lockout.test.js')

index = INDEX_PATH.read_text(encoding='utf-8')
guard = GUARD_PATH.read_text(encoding='utf-8')
test = TEST_PATH.read_text(encoding='utf-8')


def require_exact(text, token, label, count=1):
    actual = text.count(token)
    if actual != count:
        raise SystemExit(f'{label}: expected {count}, found {actual}')


# Fail closed on the exact audited shell shape before changing anything.
for label, token in {
    'legacy lock renderer': 'function _renderIntegrityExamLock(snapshot)',
    'legacy local activator': 'function _startExamIntegrityGuard()',
    'legacy activation call': 'setTimeout(_startExamIntegrityGuard, 0);',
    'legacy direct guard close': "window.KIWIIntegritySessionGuard.deactivate({ close: true })",
    'shared guard script': '/kiwi-integrity-session-guard.js',
    'manual forfeit endpoint': "apiRequest('/exams/' + AppState.tempExam.examId + '/forfeit', { method: 'POST' })",
    'page-exit warning': "window.addEventListener('beforeunload'",
}.items():
    require_exact(index, token, label)

# The local renderer and activator are one contiguous legacy block immediately
# before the page-navigation lock helper. The shared guard already owns both UI
# consequence rendering and activation.
block_start = index.index('      function _renderIntegrityExamLock(snapshot) {')
block_end = index.index('      function _lockExamPage(isReckoning) {', block_start)
index = index[:block_start] + index[block_end:]

activation_line = '        setTimeout(_startExamIntegrityGuard, 0);\n'
require_exact(index, activation_line, 'legacy activation line after block removal')
index = index.replace(activation_line, '', 1)

old_unlock = (
    "      function _unlockExamPage() {\n"
    "        _examPageLocked = false;\n"
    "        _examIsReckoning = false;\n"
    "        document.getElementById('kiwiIntegrityExamLock')?.remove();\n"
    "        if (window.KIWIIntegritySessionGuard) window.KIWIIntegritySessionGuard.deactivate({ close: true }).catch(function(){});\n"
    "      }\n"
)
new_unlock = (
    "      function _unlockExamPage() {\n"
    "        _examPageLocked = false;\n"
    "        _examIsReckoning = false;\n"
    "        const _endedExam = (typeof AppState !== 'undefined' && AppState) ? AppState.tempExam : null;\n"
    "        const _endedExamId = _endedExam && (_endedExam.examId || _endedExam.exam_id || _endedExam.id || _endedExam.sessionId || _endedExam.session_id);\n"
    "        window.dispatchEvent(new CustomEvent('kiwi:exam-ended', { detail: { examId: _endedExamId ? String(_endedExamId) : null } }));\n"
    "      }\n"
)
require_exact(index, old_unlock, 'audited _unlockExamPage block')
index = index.replace(old_unlock, new_unlock, 1)

old_exit_copy = "? 'You have an active exam. Leaving will forfeit it.'"
new_exit_copy = "? 'You have an active exam. Leaving may be recorded as a prohibited departure.'"
require_exact(index, old_exit_copy, 'legacy beforeunload exam copy')
index = index.replace(old_exit_copy, new_exit_copy, 1)

old_comment = (
    '      // Integrity Session Guard owns pagehide/background recording. A first\n'
    '      // confirmed prohibited departure warns; policy handles a later lock.\n'
    '      // Deliberate user-selected Forfeit remains a separate explicit action.\n'
)
new_comment = (
    '      // Integrity Session Guard owns exam integrity activation, pagehide/background\n'
    '      // recording, warning/lock consequences, and session closure. This shell only\n'
    '      // emits the neutral kiwi:exam-ended lifecycle signal when its navigation lock ends.\n'
    '      // Deliberate user-selected Forfeit remains a separate explicit action.\n'
)
require_exact(index, old_comment, 'integrity ownership comment')
index = index.replace(old_comment, new_comment, 1)

# Move terminal lifecycle ownership into the shared guard. endedStudyExamId keeps
# the fallback watcher from reopening the same just-ended exam, and the in-flight
# activation record prevents the watcher/event paths from creating parallel sessions.
old_state = 'const state={active:null,listeners:[],heartbeat:null,lastHiddenAt:null,deviceRef:null,onState:null,onWarning:null,onLock:null,studyExamWatcher:null,lastStudyExamId:null};'
new_state = 'const state={active:null,listeners:[],heartbeat:null,lastHiddenAt:null,deviceRef:null,onState:null,onWarning:null,onLock:null,studyExamWatcher:null,lastStudyExamId:null,endedStudyExamId:null,studyExamActivation:null};'
require_exact(guard, old_state, 'shared guard state shape')
guard = guard.replace(old_state, new_state, 1)

lifecycle_start = guard.index('  async function ensureStudyExamGuard(){')
lifecycle_end = guard.index('\n\n  global.KIWIIntegritySessionGuard=', lifecycle_start)
old_lifecycle = guard[lifecycle_start:lifecycle_end]
require_exact(old_lifecycle, "global.addEventListener('kiwi:exam-started',tick);", 'legacy shared guard start listener')

new_lifecycle = """  async function closeStudyExamGuard(event){
    const detail=event&&event.detail&&typeof event.detail==='object'?event.detail:{};
    const currentId=studyExamId();
    const endedId=detail.examId||detail.ownerRef||currentId||state.active?.ownerRef||null;
    if(endedId)state.endedStudyExamId=String(endedId);
    if(state.active?.ownerType!=='KIWI_EXAM')return state.active;
    if(endedId&&state.active.ownerRef!==String(endedId))return state.active;
    return deactivate({close:true});
  }
  async function ensureStudyExamGuard(){
    const examId=studyExamId();
    if(!examId)return null;
    const id=String(examId);
    if(state.endedStudyExamId===id)return null;
    if(state.endedStudyExamId&&state.endedStudyExamId!==id)state.endedStudyExamId=null;
    if(state.active?.ownerType==='KIWI_EXAM'&&state.active?.ownerRef===id&&state.active?.status!=='CLOSED')return state.active;
    if(state.studyExamActivation?.id===id)return state.studyExamActivation.promise;
    let pending;
    pending=(async()=>{
      try{
        state.lastStudyExamId=id;
        const snapshot=await activate({ownerType:'KIWI_EXAM',ownerRef:id,onWarning:defaultStudyWarning,onLock:defaultStudyLock});
        if(state.endedStudyExamId===id){
          await deactivate({close:true});
          return null;
        }
        return snapshot;
      }catch(error){
        global.dispatchEvent(new CustomEvent('kiwi:integrity-session-error',{detail:{code:error.code||'STUDY_EXAM_AUTO_GUARD_FAILED',message:error.message}}));
        return null;
      }finally{
        if(state.studyExamActivation?.promise===pending)state.studyExamActivation=null;
      }
    })();
    state.studyExamActivation={id,promise:pending};
    return pending;
  }
  function enableStudyExamAutoGuard(){
    if(state.studyExamWatcher)return;
    const tick=()=>{void ensureStudyExamGuard();};
    const restart=()=>{const examId=studyExamId();if(examId)state.endedStudyExamId=null;void ensureStudyExamGuard();};
    tick();
    state.studyExamWatcher=setInterval(tick,750);
    global.addEventListener('kiwi:exam-started',restart);
    global.addEventListener('kiwi:exam-resumed',restart);
    global.addEventListener('kiwi:exam-ended',(event)=>{void closeStudyExamGuard(event);});
  }"""
guard = guard[:lifecycle_start] + new_lifecycle + guard[lifecycle_end:]

old_export = 'global.KIWIIntegritySessionGuard=Object.freeze({activate,deactivate,refresh,current,sendEvent:send,ensureStudyExamGuard,enableStudyExamAutoGuard});'
new_export = 'global.KIWIIntegritySessionGuard=Object.freeze({activate,deactivate,refresh,current,sendEvent:send,ensureStudyExamGuard,closeStudyExamGuard,enableStudyExamAutoGuard});'
require_exact(guard, old_export, 'shared guard export shape')
guard = guard.replace(old_export, new_export, 1)

old_test = """test('legacy Study shell still loads the shared guard and has no first-pagehide auto-forfeit',()=>{
  const src=html();
  assert.match(src,/\\/kiwi-integrity-session-guard\\.js/);
  assert.match(src,/Integrity Session Guard owns pagehide\\/background recording/);
  assert.doesNotMatch(src,/pagehide — fires after the user confirms leaving[\\s\\S]{0,900}\\/forfeit/);
});
"""
new_test = """test('Study shell delegates integrity lifecycle ownership to the shared guard',()=>{
  const src=html();
  assert.match(src,/\\/kiwi-integrity-session-guard\\.js/);
  assert.match(src,/Integrity Session Guard owns exam integrity activation/);
  assert.match(src,/kiwi:exam-ended/);
  assert.doesNotMatch(src,/_startExamIntegrityGuard/);
  assert.doesNotMatch(src,/_renderIntegrityExamLock/);
  assert.doesNotMatch(src,/KIWIIntegritySessionGuard\\.activate/);
  assert.doesNotMatch(src,/KIWIIntegritySessionGuard\\.deactivate/);
  assert.doesNotMatch(src,/pagehide — fires after the user confirms leaving[\\s\\S]{0,900}\\/forfeit/);
  assert.match(src,/\\/exams\\/.*\\/forfeit/);
});

test('shared guard owns Study exam closure without watcher reactivation races',()=>{
  const src=guard();
  assert.match(src,/function closeStudyExamGuard\\(event\\)/);
  assert.match(src,/endedStudyExamId/);
  assert.match(src,/studyExamActivation/);
  assert.match(src,/global\\.addEventListener\\('kiwi:exam-ended'/);
  assert.match(src,/if\\(state\\.endedStudyExamId===id\\)return null/);
  assert.match(src,/if\\(state\\.studyExamActivation\\?\\.id===id\\)return state\\.studyExamActivation\\.promise/);
});
"""
require_exact(test, old_test, 'Study integrity regression test block')
test = test.replace(old_test, new_test, 1)

# Final source invariants.
for token in (
    '_startExamIntegrityGuard',
    '_renderIntegrityExamLock',
    'KIWIIntegritySessionGuard.activate',
    'KIWIIntegritySessionGuard.deactivate',
    'kiwiIntegrityExamLock',
):
    if token in index:
        raise SystemExit(f'legacy Study shell integrity ownership remains: {token}')

if "apiRequest('/exams/' + AppState.tempExam.examId + '/forfeit', { method: 'POST' })" not in index:
    raise SystemExit('explicit manual forfeit flow was accidentally removed')
if '/kiwi-integrity-session-guard.js' not in index:
    raise SystemExit('shared guard script was accidentally removed')
if "window.dispatchEvent(new CustomEvent('kiwi:exam-ended'" not in index:
    raise SystemExit('neutral exam-ended lifecycle signal missing')
if "global.addEventListener('kiwi:exam-ended'" not in guard:
    raise SystemExit('shared guard exam-ended owner missing')
if "state.studyExamActivation?.id===id" not in guard:
    raise SystemExit('shared guard activation de-duplication missing')

INDEX_PATH.write_text(index, encoding='utf-8')
GUARD_PATH.write_text(guard, encoding='utf-8')
TEST_PATH.write_text(test, encoding='utf-8')
print('Legacy Study exam integrity lifecycle ownership removed cleanly.')
