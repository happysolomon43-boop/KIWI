export const node=(tag,text=null,className='')=>{const n=document.createElement(tag);if(text!==null)n.textContent=String(text);n.className=className;return n;};
export const action=(label,run)=>{const b=node('button',label);b.type='button';b.addEventListener('click',run);return b;};
export function renderChapter(chapter,{onNote}){
 const root=node('div',null,'cr-chapter-content');root.append(node('h2',chapter.title));
 for(const unit of chapter.units){const section=node('section');section.dataset.anchor=unit.anchor;section.append(node('h3',unit.title),node('p',({DEFERRED:'Deferred teaching · available for reading',OPTIONAL:'Optional depth',AVAILABLE:'Available for reading'})[unit.reading_status]||'Available for reading','cr-muted'));for(const e of unit.elements){const article=node('article',null,'cr-source');article.dataset.anchor=e.anchor;article.tabIndex=-1;
  const content=node(e.type==='code'?'pre':'p',e.text||e.alt_text||'Text representation unavailable');if(e.type==='equation')content.className='cr-equation';article.append(content);
  if(e.asset_ref)article.append(node('p',e.alt_text||'Visual reference; view the released Board representation.','cr-muted'));
  if(onNote)article.append(action('Save passage to Notebook',()=>onNote({kind:'chapter',id:chapter.id,version:chapter.version,anchor:e.anchor},e.text||e.alt_text||unit.title)));
  section.append(article);}root.append(section);}
 for(const remap of chapter.remaps||[])root.append(node('p','Revised passage: '+remap.reason,'cr-muted'));return root;
}
export function renderEvent(event,{onSource,onNote}){
 const root=node('article',null,'cr-event');root.dataset.sequence=event.sequence;root.append(node('h3',event.role==='teacher'?'Teacher':event.role==='student'?'You':'Class update'));
 if(event.type==='correction')root.append(node('p','Correction','cr-muted'));
 root.append(node('div',event.text,'cr-developed-text'));for(const ref of event.source_refs||[]){const b=action('Read linked passage',()=>onSource(ref));b.dataset.sourceAnchor=ref.anchor||'';root.append(b);}
 if(onNote)root.append(action('Save explanation to Notebook',()=>onNote({kind:'message',id:event.id,version:'1',anchor:null},event.text)));return root;
}
