(function initTeachingReliability(window, document) {
'use strict';
if (window.KIWITeachingReliability) return;
const STORAGE_PREFIX = 'kiwi:d25:work-draft:';
const SCHEMA_VERSION = 'd25.local-work-draft.v1';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const state = { assignmentId: null, editor: null, localDraft: null, notice: null, status: null };
function safeRead(key) { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; } }
function safeWrite(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }
function safeRemove(key) { try { localStorage.removeItem(key); } catch {} }
function keyFor(id) { return `${STORAGE_PREFIX}${String(id)}`; }
function nowIso() { return new Date().toISOString(); }
function uid() { return window.crypto?.randomUUID?.() || `d25-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function ensureStatus() {
  if (state.status?.isConnected) return state.status;
  const node = document.createElement('div'); node.id='teachingReliabilityStatus'; node.className='teaching-reliability-status'; node.hidden=true;
  node.setAttribute('role','status'); node.setAttribute('aria-live','polite'); node.setAttribute('aria-atomic','true'); document.body.append(node); state.status=node; return node;
}
function status(message,{kind='info',persist=false}={}) {
  const node=ensureStatus(); node.dataset.kind=kind; node.hidden=!message; node.textContent=message||'';
  if(message&&!persist){window.clearTimeout(node._hideTimer);node._hideTimer=window.setTimeout(()=>{if(node.textContent===message)node.hidden=true;},6500);}
  window.KIWITeachingAccessibility?.announce?.(message);
}
function protectedNetworkMessage(){return 'Connection interrupted. KIWI will recover from authoritative server state. This technical failure will not be treated as an absence, late submission, wrong answer, or mark. Local recovery drafts are not official until the server confirms them.';}
function updateClassroomConnection(message,kind){
  const classroom=document.querySelector('.tc-overlay');if(!classroom)return;let host=classroom.querySelector('.tc-connection');
  if(!host){host=document.createElement('div');host.className='tc-connection teaching-reliability-inline';host.setAttribute('role','status');host.setAttribute('aria-live','polite');const header=classroom.querySelector('.tc-header');(header?.parentNode||classroom).insertBefore(host,header?.nextSibling||classroom.firstChild);}
  host.dataset.kind=kind||'info';host.hidden=!message;host.textContent=message||'';
}
function onOffline(){const message=protectedNetworkMessage();status(message,{kind:'offline',persist:true});updateClassroomConnection(message,'offline');window.dispatchEvent(new CustomEvent('kiwi:d25:connectivity',{detail:{connected:false,at:nowIso()}}));}
function onOnline(){const message='Connection restored. KIWI is re-reading authoritative server state before any queued recovery work is synchronized.';status(message,{kind:'revalidating'});updateClassroomConnection(message,'revalidating');window.dispatchEvent(new CustomEvent('kiwi:d25:connectivity',{detail:{connected:true,revalidate:true,at:nowIso()}}));window.setTimeout(()=>updateClassroomConnection('','online'),5000);}
function parseAssignmentId(url){const value=String(url||'');const match=value.match(/\/teaching\/assignments\/([^/?#]+)(?:[/?#]|$)/i);if(!match)return null;const id=decodeURIComponent(match[1]);return ['draft','submit','correction','assistance'].includes(id.toLowerCase())?null:id;}
function setAssignmentId(id){if(!id||id===state.assignmentId)return;state.assignmentId=String(id);state.localDraft=loadLocalDraft(state.assignmentId);window.setTimeout(discoverEditor,0);}
function observeNetworkResources(){if(!('PerformanceObserver' in window))return;try{const observer=new PerformanceObserver((list)=>{for(const entry of list.getEntries()){const id=parseAssignmentId(entry.name);if(id)setAssignmentId(id);}});observer.observe({type:'resource',buffered:true});}catch{}}
function loadLocalDraft(assignmentId){const row=safeRead(keyFor(assignmentId));if(!row||row.schemaVersion!==SCHEMA_VERSION||typeof row.text!=='string')return null;const age=Date.now()-Date.parse(row.updatedAt||'');if(!Number.isFinite(age)||age<0||age>MAX_AGE_MS){safeRemove(keyFor(assignmentId));return null;}return row;}
function persistLocalDraft(assignmentId,text){if(!assignmentId)return false;return safeWrite(keyFor(assignmentId),{schemaVersion:SCHEMA_VERSION,assignmentId:String(assignmentId),text:String(text||''),updatedAt:nowIso(),localRecoveryOnly:true,authoritative:false,recoveryId:uid()});}
function discardLocalDraft(assignmentId=state.assignmentId){if(!assignmentId)return;safeRemove(keyFor(assignmentId));state.localDraft=null;state.notice?.remove();state.notice=null;}
function recoveryNotice(editor,draft){
  state.notice?.remove();const box=document.createElement('section');box.className='teaching-recovery-draft';box.setAttribute('role','status');const copy=document.createElement('div');const strong=document.createElement('strong');strong.textContent='Recovered local draft available';const p=document.createElement('p');p.textContent='This text was stored on this device after an interruption. It is not part of the authoritative Assignment record until you restore it and the server confirms a save.';copy.append(strong,p);const actions=document.createElement('div');actions.className='teaching-recovery-draft__actions';
  const restore=document.createElement('button');restore.type='button';restore.textContent='Restore local draft';restore.addEventListener('click',()=>{editor.value=draft.text;editor.dispatchEvent(new Event('input',{bubbles:true}));box.remove();state.notice=null;status('Local recovery text restored for editing. It is still not official until the server confirms a save.',{kind:'warning'});editor.focus({preventScroll:true});});
  const discard=document.createElement('button');discard.type='button';discard.className='teaching-recovery-draft__discard';discard.textContent='Discard local draft';discard.addEventListener('click',()=>{discardLocalDraft();status('Local recovery draft discarded. The authoritative server record was not changed.');});actions.append(restore,discard);box.append(copy,actions);editor.closest('.tw-editor')?.prepend(box);state.notice=box;
}
function bindEditor(editor){
  if(!editor||editor.dataset.d25RecoveryBound==='true'||!state.assignmentId)return;editor.dataset.d25RecoveryBound='true';state.editor=editor;const local=loadLocalDraft(state.assignmentId);state.localDraft=local;if(local&&local.text!==editor.value)recoveryNotice(editor,local);
  editor.addEventListener('input',()=>{if(!state.assignmentId)return;const stored=persistLocalDraft(state.assignmentId,editor.value);if(!stored)status('KIWI could not preserve a local recovery draft on this device. Save to the server before leaving this page.',{kind:'error',persist:true});});
  const editorRoot=editor.closest('.tw-editor');if(editorRoot){const observer=new MutationObserver(()=>{const message=editorRoot.querySelector('.tw-message')?.textContent||'';if(/draft saved\s*·\s*version/i.test(message)){const localNow=loadLocalDraft(state.assignmentId);if(localNow&&localNow.text===editor.value){discardLocalDraft();status('Draft confirmed by the authoritative Assignment record.',{kind:'saved'});}}});observer.observe(editorRoot,{childList:true,subtree:true,characterData:true});}
}
function discoverEditor(){if(!state.assignmentId)return;const editor=document.querySelector('.tw-editor textarea');if(editor)bindEditor(editor);}
function observeTeachingUi(){const root=document.getElementById('teachingApp')||document.body;const observer=new MutationObserver(()=>{discoverEditor();if(!navigator.onLine)updateClassroomConnection(protectedNetworkMessage(),'offline');});observer.observe(root,{childList:true,subtree:true});}
function boot(){ensureStatus();observeNetworkResources();observeTeachingUi();window.addEventListener('offline',onOffline);window.addEventListener('online',onOnline);if(!navigator.onLine)onOffline();}
window.KIWITeachingReliability=Object.freeze({status,protectedNetworkMessage,localDraft:Object.freeze({load:loadLocalDraft,persist:persistLocalDraft,discard:discardLocalDraft}),contractVersion:'d25.browser-recovery.v1',localDraftsAreAuthoritative:false,timersOwnedByBrowser:false});
boot();
})(window, document);
