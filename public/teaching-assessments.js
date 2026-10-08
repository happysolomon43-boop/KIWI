const {kiwiApiRequest}=window.KIWI_API_CLIENT||{};
const courses=window.KIWITeachingCourses;
const element=(tag,text,cls='')=>{const node=document.createElement(tag);node.textContent=text;node.className=cls;return node;};
courses.registerSection({id:'assessments',label:'Assessments',order:46,render:async({course,container})=>{
  const courseId=course.course_id||course.courseId;
  const heading=element('h2','Assessments'),status=element('p','Loading assessments…');status.setAttribute('role','status');
  const list=element('div','');container.append(heading,status,list);
  async function refresh(){
    try{
      const rows=await kiwiApiRequest('/teaching/assessments?courseId='+encodeURIComponent(courseId));
      if(!container.isConnected)return;
      list.replaceChildren();status.textContent=rows.length?'Your announced assessments and saved results.':'No assessments have been announced for this Course.';
      for(const row of rows){
        const card=element('article','','ti-card');card.append(element('h3',row.title),element('p',row.assessment_type.replaceAll('_',' ')));
        const schedule=row.source_lineage?.assessment_schedule||{},when=schedule.starts_at||row.source_lineage?.d19_measurement?.intended_class_scheduled_start_at;
        if(when)card.append(element('p','Opens '+new Date(when).toLocaleString()));
        const open=element('button','Start / Resume','tc-button tc-button--solid');open.type='button';
        open.addEventListener('click',async()=>{open.disabled=true;try{const handoff=await kiwiApiRequest('/teaching/assessments/'+encodeURIComponent(row.assessment_id)+'/launch');window.location.assign(handoff.targetAppPath);}catch(error){status.textContent=error.message||'This assessment is not ready yet.';open.disabled=false;}});
        if(['CANCELLED','SUPERSEDED'].includes(row.definition_state)){open.disabled=true;open.textContent='Withdrawn';}
        card.append(open);list.append(card);
      }
      const results=element('button','View Course results','tc-button tc-button--soft');results.type='button';
      results.addEventListener('click',async()=>{results.disabled=true;try{const model=await kiwiApiRequest('/teaching/gradebook/courses/'+encodeURIComponent(courseId));const panel=element('section','','ti-card');panel.append(element('h3','Course results'));if(!model.gradebookEntries.length)panel.append(element('p','No marked results yet. Submitted assessments are processed in the background.'));for(const entry of model.gradebookEntries)panel.append(element('p',`${entry.category.replaceAll('_',' ')} · ${entry.rawMarks.percentage}% · ${entry.state.replaceAll('_',' ')}`));list.append(panel);}catch(error){status.textContent=error.message||'Could not load results.';}finally{results.disabled=false;}});list.append(results);
    }catch(error){status.textContent=error.message||'Could not load assessments.';}
  }
  const reload=element('button','Refresh','tc-button tc-button--quiet');reload.type='button';reload.addEventListener('click',refresh);container.append(reload);await refresh();
}});
