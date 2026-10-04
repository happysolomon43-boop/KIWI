(function installTeachingUnifiedUpload(global){
'use strict';

const apiClient=global.KIWI_API_CLIENT||{};
const apiRequest=apiClient.kiwiApiRequest;
const rawRequest=apiClient.kiwiApiRawRequest;
const MAX_FILES=8;
const MAX_FILE_BYTES=10*1024*1024;
const ACCEPT='.pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown';
const MIME_BY_EXTENSION=Object.freeze({
  pdf:'application/pdf',
  docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt:'text/plain',
  md:'text/markdown',
});
let queuedFiles=[];

function ext(name){const value=String(name||'');const i=value.lastIndexOf('.');return i<0?'':value.slice(i+1).toLowerCase();}
function mimeFor(file){return MIME_BY_EXTENSION[ext(file.name)]||String(file.type||'').toLowerCase();}
function fileKey(file){return `${file.name}:${file.size}:${file.lastModified||0}`;}
function prettyBytes(bytes){const n=Number(bytes)||0;if(n<1024)return `${n} B`;if(n<1024*1024)return `${Math.round(n/102.4)/10} KB`;return `${Math.round(n/104857.6)/10} MB`;}
function announce(message){global.KIWITeachingAccessibility?.announce?.(message);}

function validateClientFile(file){
  const extension=ext(file.name);
  if(!MIME_BY_EXTENSION[extension])return `${file.name} is not a supported Course material. Use PDF, DOCX, TXT, or Markdown.`;
  if(!file.size)return `${file.name} is empty.`;
  if(file.size>MAX_FILE_BYTES)return `${file.name} is larger than 10 MB.`;
  return null;
}

function addFiles(files,root){
  const incoming=Array.from(files||[]);
  const errors=[];
  const existing=new Set(queuedFiles.map(fileKey));
  for(const file of incoming){
    const error=validateClientFile(file);
    if(error){errors.push(error);continue;}
    if(existing.has(fileKey(file)))continue;
    if(queuedFiles.length>=MAX_FILES){errors.push(`You can add up to ${MAX_FILES} course-material files at once.`);break;}
    queuedFiles.push(file);existing.add(fileKey(file));
  }
  renderQueue(root);
  const status=root.querySelector('[data-upload-status]');
  if(errors.length){status.textContent=errors[0];status.dataset.kind='error';announce(errors[0]);}
  else if(incoming.length){status.textContent=`${queuedFiles.length} file${queuedFiles.length===1?'':'s'} ready to add.`;status.dataset.kind='ready';announce(status.textContent);}
}

function renderQueue(root){
  const list=root.querySelector('[data-upload-list]');
  const empty=root.querySelector('[data-upload-empty]');
  if(!list||!empty)return;
  list.replaceChildren();
  empty.hidden=queuedFiles.length>0;
  queuedFiles.forEach((file,index)=>{
    const row=document.createElement('div');row.className='tu-upload-file';
    const icon=document.createElement('span');icon.className='tu-upload-file__icon';icon.textContent=ext(file.name).toUpperCase();icon.setAttribute('aria-hidden','true');
    const copy=document.createElement('div');copy.className='tu-upload-file__copy';
    const name=document.createElement('strong');name.textContent=file.name;
    const meta=document.createElement('span');meta.textContent=`${ext(file.name).toUpperCase()} · ${prettyBytes(file.size)}`;
    copy.append(name,meta);
    const remove=document.createElement('button');remove.type='button';remove.className='tu-upload-file__remove';remove.textContent='Remove';remove.setAttribute('aria-label',`Remove ${file.name}`);
    remove.addEventListener('click',()=>{queuedFiles.splice(index,1);renderQueue(root);const status=root.querySelector('[data-upload-status]');status.textContent=queuedFiles.length?`${queuedFiles.length} file${queuedFiles.length===1?'':'s'} ready to add.`:'No supplementary files selected.';status.dataset.kind='';announce(`${file.name} removed.`);});
    row.append(icon,copy,remove);list.append(row);
  });
}

async function uploadFile(file,status){
  status.textContent=`Validating and reading ${file.name}…`;status.dataset.kind='working';announce(status.textContent);
  return rawRequest('/teaching/materials/extract',{
    method:'POST',
    headers:{
      'Content-Type':mimeFor(file),
      'X-KIWI-Filename':encodeURIComponent(file.name),
    },
    body:file,
    timeoutMs:60_000,
  });
}

function signalsFromForm(){
  const split=typeof splitSignals==='function'?splitSignals:(value)=>String(value||'').split(',').map(x=>x.trim()).filter(Boolean);
  return {
    originalFreeFormText:document.getElementById('teachingIntakeText')?.value||'',
    learningPreferences:split(document.getElementById('teachingPreferences')?.value||''),
    difficultAreas:split(document.getElementById('teachingDifficult')?.value||''),
    priorExperience:split(document.getElementById('teachingPrior')?.value||''),
    knownStrengths:split(document.getElementById('teachingStrengths')?.value||''),
    goals:split(document.getElementById('teachingGoals')?.value||''),
    importantDeadlines:split(document.getElementById('teachingDeadlines')?.value||''),
  };
}

function showMessage(node,message,kind=''){
  if(typeof showSetupMessage==='function')showSetupMessage(node,message,kind||undefined);
  else{node.textContent=message;node.dataset.kind=kind;}
}

async function submitWithFiles(event,form,root){
  if(!queuedFiles.length)return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const select=document.getElementById('teachingSubject');
  const submit=form.querySelector('button[type="submit"]');
  const message=form.querySelector('footer [role="status"]')||form.querySelector('[role="status"]');
  const status=root.querySelector('[data-upload-status]');
  if(!select?.value){showMessage(message,'Choose an existing KIWI Subject.','error');select?.focus();return;}
  submit.disabled=true;
  root.dataset.busy='true';
  try{
    const supplementaryMaterials=[];
    for(let i=0;i<queuedFiles.length;i+=1){
      status.textContent=`Reading ${i+1} of ${queuedFiles.length}: ${queuedFiles[i].name}`;status.dataset.kind='working';
      const extracted=await uploadFile(queuedFiles[i],status);
      supplementaryMaterials.push(...(Array.isArray(extracted?.materials)?extracted.materials:[]));
    }
    status.textContent='Materials validated. Creating your course draft…';status.dataset.kind='working';
    showMessage(message,'Creating the draft and preserving its source inventory…');
    const course=await apiRequest('/teaching/courses',{method:'POST',body:{subjectId:select.value,supplementaryMaterials}});
    const intakeSignals=signalsFromForm();
    const result=await apiRequest(`/teaching/courses/${course.course_id}/intake`,{method:'POST',body:intakeSignals});
    queuedFiles=[];
    if(typeof teachingWorkspace!=='undefined'&&Array.isArray(teachingWorkspace.courses))teachingWorkspace.courses.push(course);
    if(typeof renderIntakeSuccess==='function')renderIntakeSuccess(course,result.extractionStatus,intakeSignals);
    announce('Course draft created with supplementary materials.');
  }catch(error){
    const messageText=error?.message||'Course materials could not be added safely.';
    status.textContent=messageText;status.dataset.kind='error';
    showMessage(message,messageText,'error');announce(messageText);
    submit.disabled=false;
  }finally{root.dataset.busy='false';}
}

function buildUploader(form){
  const root=document.createElement('section');root.className='tu-upload';root.dataset.teachingUnifiedUpload='true';
  root.innerHTML=`
    <div class="tu-upload__head">
      <div><span class="tu-upload__eyebrow">Optional course sources</span><h2>Add course materials</h2><p>Add lecture notes, a syllabus, handouts, or other useful source material. These enrich the selected KIWI Subject; they never replace it or count as mastery evidence.</p></div>
      <span class="tu-upload__secure" aria-label="Server validated">Validated upload</span>
    </div>
    <div class="tu-upload__drop" tabindex="0" role="button" aria-label="Choose supplementary course material files">
      <input type="file" data-upload-input hidden multiple accept="${ACCEPT}">
      <span class="tu-upload__plus" aria-hidden="true">＋</span>
      <strong>Choose files or drop them here</strong>
      <span>PDF, DOCX, TXT, Markdown · up to 10 MB each · ${MAX_FILES} files max</span>
    </div>
    <div class="tu-upload__empty" data-upload-empty>No supplementary files selected. You can create the course using only your KIWI Subject.</div>
    <div class="tu-upload__list" data-upload-list aria-live="polite"></div>
    <div class="tu-upload__status" data-upload-status role="status" aria-live="polite">No supplementary files selected.</div>`;
  const input=root.querySelector('[data-upload-input]');
  const drop=root.querySelector('.tu-upload__drop');
  const choose=()=>input.click();
  drop.addEventListener('click',(event)=>{if(event.target!==input)choose();});
  drop.addEventListener('keydown',(event)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();choose();}});
  input.addEventListener('change',()=>{addFiles(input.files,root);input.value='';});
  for(const name of ['dragenter','dragover'])drop.addEventListener(name,(event)=>{event.preventDefault();drop.dataset.drag='true';});
  for(const name of ['dragleave','drop'])drop.addEventListener(name,(event)=>{event.preventDefault();drop.dataset.drag='false';});
  drop.addEventListener('drop',(event)=>addFiles(event.dataTransfer?.files,root));
  form.addEventListener('submit',(event)=>submitWithFiles(event,form,root),true);
  return root;
}

function decorateIntake(){
  if(typeof apiRequest!=='function'||typeof rawRequest!=='function')return;
  const select=document.getElementById('teachingSubject');
  const form=select?.closest('form');
  if(!form||form.querySelector('[data-teaching-unified-upload]'))return;
  queuedFiles=[];
  const uploader=buildUploader(form);
  const subjectSection=select.closest('.teaching-form__section');
  subjectSection?.insertAdjacentElement('afterend',uploader);
}

const observer=new MutationObserver(decorateIntake);
observer.observe(document.documentElement,{childList:true,subtree:true});
decorateIntake();
})(window);
