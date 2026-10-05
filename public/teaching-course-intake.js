(function installTeachingCourseIntake(global){
  'use strict';
  const ACCEPT='.pdf,.docx,.pptx,.txt,.md,.markdown';
  const MIME={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',txt:'text/plain',md:'text/markdown',markdown:'text/markdown'};
  const ext=name=>String(name||'').split('.').pop().toLowerCase();
  const safeText=value=>String(value||'').trim();
  const list=value=>safeText(value).split(/[,\n]/).map(safeText).filter(Boolean);
  async function extract(file){
    const extension=ext(file.name),mime=MIME[extension]||file.type;
    if(!Object.values(MIME).includes(mime))throw new Error(`${file.name} is not a supported Course source.`);
    const response=await fetch('/teaching/materials/extract',{method:'POST',credentials:'same-origin',headers:{'Content-Type':mime,'X-KIWI-Filename':encodeURIComponent(file.name)},body:file});
    const result=await response.json();if(!response.ok)throw new Error(result.error||`Could not read ${file.name}.`);return result.materials||[];
  }
  function uploader(root){
    const input=root.querySelector('input[type=file]'),button=root.querySelector('[data-pick]'),queue=root.querySelector('[data-queue]');let files=[];
    input.accept=ACCEPT;input.multiple=true;
    const draw=()=>{queue.innerHTML=files.length?files.map((file,i)=>`<span class="source-chip">${file.name.replace(/[&<>]/g,'')}<button type="button" data-remove="${i}" aria-label="Remove ${file.name.replace(/[&<>]/g,'')}">×</button></span>`).join(''):'<span class="meta">No files selected</span>';};
    button.addEventListener('click',()=>input.click());input.addEventListener('change',()=>{files=[...files,...input.files];input.value='';draw();});queue.addEventListener('click',event=>{const index=event.target.dataset.remove;if(index==null)return;files.splice(Number(index),1);draw();});
    draw();return async()=>{const chunks=[];for(const file of files)chunks.push(...await extract(file));return chunks;};
  }
  function boot(){const form=document.getElementById('create-course');if(!form||form.dataset.intakeReady)return;form.dataset.intakeReady='true';const original=uploader(document.querySelector('[data-upload-role="original"]'));const supplemental=uploader(document.querySelector('[data-upload-role="supplemental"]'));form.addEventListener('submit',async event=>{event.preventDefault();const result=document.getElementById('result'),submit=form.querySelector('[type=submit]');if(!form.elements.subjectId.value){result.textContent='Choose a Subject first.';return;}submit.disabled=true;result.textContent='Preparing Course sources…';try{const [originalMaterials,supplementaryMaterials]=await Promise.all([original(),supplemental()]);originalMaterials.forEach(x=>x.sourceKind='PRIMARY_STUDY_NOTE');supplementaryMaterials.forEach(x=>x.sourceKind='STUDENT_SUPPLEMENT');const body={subjectId:form.elements.subjectId.value,title:form.elements.title.value||undefined,originalMaterials,supplementaryMaterials,intake:{originalFreeFormText:form.elements.intake.value||null,learningPreferences:list(form.elements.learningPreferences.value),difficultAreas:list(form.elements.difficultAreas.value),priorExperience:[],knownStrengths:list(form.elements.knownStrengths.value),goals:list(form.elements.goals.value),importantDeadlines:list(form.elements.importantDeadlines.value)}};const response=await fetch('/teaching/courses',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),data=await response.json();if(!response.ok)throw new Error(data.error||'Course could not be created');location.href='/teaching/courses/'+encodeURIComponent(data.course_id||data.courseId)+'/overview/view';}catch(error){result.textContent=error.message;submit.disabled=false;}});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(window);
