'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {PRIMARY_NAV,SECONDARY_NAV,COURSE_NAV,filterStudentVisibleAssessments,allocateToday,notificationDeepLink,buildStudentCommunication,contextualActions,studyPackCollection}=require('../../../teaching/d23/contracts');

test('D23 primary and secondary navigation remain intentionally small',()=>{
  assert.deepEqual(PRIMARY_NAV.map(x=>x.label),['Today','Courses','Calendar','Work','Record']);
  assert.deepEqual(COURSE_NAV.map(x=>x.label),['Overview','Course Plan','Work','Results','Teacher']);
  assert.deepEqual(SECONDARY_NAV.map(x=>x.label),['Requests','Archived Courses','Create Course']);
  for(const prohibited of ['Student Knowledge Model','Pedagogy Engine','Assessment Blueprint','Evidence Event','Course Coverage Ledger'])assert.equal([...PRIMARY_NAV,...SECONDARY_NAV,...COURSE_NAV].some(x=>x.label===prohibited),false);
});

test('D23 never previews a hidden impromptu assessment',()=>{
  const now=new Date('2026-10-03T12:00:00Z');
  const rows=[
    {assessment_id:'surprise',assessment_type:'IMPROMPTU_TEST',lifecycle_state:'DRAFT',source_lineage:{d19_measurement:{intended_class_scheduled_end_at:'2026-10-03T15:00:00Z'}}},
    {assessment_id:'test',assessment_type:'SCHEDULED_TEST',lifecycle_state:'LOCKED'},
  ];
  assert.deepEqual(filterStudentVisibleAssessments(rows,now).map(x=>x.assessment_id),['test']);
  assert.deepEqual(filterStudentVisibleAssessments([{...rows[0],lifecycle_state:'ACTIVE'}],now).map(x=>x.assessment_id),['surprise']);
});

test('Today is quiet when there is no meaningful academic attention item',()=>{
  const result=allocateToday({now:new Date('2026-10-03T12:00:00Z'),timeZone:'Africa/Lagos',calendarEvents:[],workItems:[],requests:[],recentChanges:[]});
  assert.equal(result.quiet,true);assert.deepEqual(result.now,[]);assert.deepEqual(result.needsAction,[]);assert.deepEqual(result.next,[]);
});

test('Today prioritizes active event, near-term work and the next event without inventing truth',()=>{
  const now=new Date('2026-10-03T12:00:00Z');
  const result=allocateToday({now,timeZone:'UTC',calendarEvents:[
    {id:'class:a',kind:'CLASS',title:'Chemistry',startsAt:'2026-10-03T11:30:00Z',endsAt:'2026-10-03T12:30:00Z',href:'/a'},
    {id:'class:b',kind:'CLASS',title:'Math',startsAt:'2026-10-03T14:00:00Z',endsAt:'2026-10-03T15:00:00Z',href:'/b'},
  ],workItems:[{assignmentId:'w1',title:'Problem Set',lifecycleState:'OPEN',deadline:{dueAt:'2026-10-03T20:00:00Z'}}]});
  assert.equal(result.quiet,false);assert.equal(result.now[0].id,'class:a');assert.equal(result.needsAction[0].id,'w1');assert.equal(result.next[0].id,'class:b');
});

test('TPF-19 fact-pack pattern preserves truth classes and surfaces authoritative conflicts',()=>{
  const base={truth_domain:'GRADEBOOK',semantic_key:'course_result',fact_class:'OFFICIAL_RECORD',source_owner:'D20_GRADEBOOK',visibility:'STUDENT',provenance_refs:['gradebook:1']};
  const ready=buildStudentCommunication({snapshotRef:'s1',facts:[{...base,truth_status:'AUTHORITATIVE_PROVISIONAL',effective_state:'72%'}]});
  assert.equal(ready.status,'READY_FOR_TRANSLATION');assert.equal(ready.promptFamily,'TPF-19');assert.equal(ready.routeQualification,'UNQUALIFIED_UNTIL_D30');assert.equal(ready.factPack.facts[0].provisional,true);assert.equal(ready.modelText,null);
  const conflict=buildStudentCommunication({snapshotRef:'s2',facts:[{...base,truth_status:'AUTHORITATIVE_FINAL',effective_state:'72%'},{...base,provenance_refs:['gradebook:2'],truth_status:'AUTHORITATIVE_FINAL',effective_state:'74%'}]});
  assert.equal(conflict.status,'CONFLICTED_FACTS');assert.equal(conflict.factPack.facts.length,2);assert.equal(conflict.translationDirective.conflict_policy,'SURFACE_CONFLICT_AND_HANDOFF');
});

test('deep links and contextual actions point back to authoritative objects',()=>{
  assert.equal(notificationDeepLink('CLASS','c 1'),'/teaching/classes/c%201/event/view');
  assert.equal(notificationDeepLink('REQUEST','r1'),'/teaching/requests/view?focus=r1');
  const actions=contextualActions({kind:'CLASS',state:'SCHEDULED',id:'c1'});assert.equal(actions[0].id,'reschedule');assert.match(actions[0].href,/requests\/view/);
});

test('Teaching Study collection groups existing packs by Course and Class without selecting cards',()=>{
  const groups=studyPackCollection([{courseId:'c1',courseTitle:'Chemistry',classes:[{classId:'cl1',objective:'Atoms',studyNote:{state:'VALIDATED_PRIVATE'}}]}]);
  assert.equal(groups.length,1);assert.equal(groups[0].packs[0].classId,'cl1');assert.match(groups[0].packs[0].href,/courseId=c1/);assert.match(groups[0].packs[0].href,/classId=cl1/);
});
