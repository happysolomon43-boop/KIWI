'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const ui=require('../../../teaching/d23/ui');

test('D23 shell renders desktop rail and responsive mobile bottom navigation',()=>{
  const html=ui.renderToday({quiet:true,now:[],needsAction:[],next:[],laterToday:[],recentlyChanged:[],issues:[]});
  for(const label of ['Today','Courses','Calendar','Work','Record'])assert.match(html,new RegExp(`>${label}<`));
  assert.match(html,/class="rail"/);assert.match(html,/class="mobile-dock"/);assert.match(html,/@media\(max-width:720px\)/);assert.match(html,/Nothing is pulling at you/);
});

test('D23 Course surface uses canonical local navigation and keeps internal engines out of menus',()=>{
  const html=ui.renderCourseOverview({course:{courseId:'c1',title:'Chemistry',lifecycleState:'ACTIVE'},warnings:[],importantWork:[],issues:[]});
  for(const label of ['Overview','Course Plan','Work','Results','Teacher'])assert.match(html,new RegExp(`>${label}<`));
  for(const hidden of ['Student Knowledge Model','Pedagogy Engine','Assessment Blueprint','Evidence Event'])assert.doesNotMatch(html,new RegExp(`>${hidden}<`));
  assert.match(html,/Teacher notes and internal engines are deliberately absent/);
});

test('D23 Calendar explicitly communicates sole timetable and surprise-assessment protection',()=>{
  const html=ui.renderCalendar({serverNow:'2026-10-03T12:00:00Z',currentTimeZone:'UTC',events:[],issues:[]});
  assert.match(html,/The sole Teaching timetable/);assert.match(html,/No second timetable/);assert.match(html,/Impromptu means impromptu/);
});

test('D23 Results visually preserves Gradebook versus progression versus learning-analysis distinction',()=>{
  const html=ui.renderCourseResults({courseId:'c1',results:{topics:[]},progression:{outcome:'PASS'},issues:[]});
  assert.match(html,/Official Results/);assert.match(html,/Progression/);assert.match(html,/Learning Analysis is separate/);assert.match(html,/inference is never relabelled as an official mark/i);
});

test('D23 Create Course enters the existing Subject → Course pipeline rather than duplicating Subject truth',()=>{
  const html=ui.renderCreateCourse(),client=fs.readFileSync(path.resolve(__dirname,'../../../public/teaching-course-intake.js'),'utf8');assert.match(html,/Choose the KIWI Subject/);assert.match(html,/fetch\('\/teaching\/subjects'/);assert.match(client,/fetch\('\/teaching\/courses'/);assert.match(html,/existing cards remain useful/i);
});
