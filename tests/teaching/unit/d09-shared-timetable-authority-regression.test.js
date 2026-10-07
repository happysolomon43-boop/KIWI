'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ensureInstructionalLoads,
  missingInstructionalLoads,
  scopeRef,
} = require('../../../teaching/d09/schedule-preparation');
const { schedulingRequest } = require('../../../teaching/d09/intelligence');

function course(id='c1', state='DRAFT') {
  return {
    course_id:id,
    student_id:'student-1',
    state_version:1,
    subject_snapshot_ref:'subject:s1:v1',
    lifecycle_state:state,
    semester_id:'sem1',
  };
}

function bundle(id='c1', count=6) {
  return {
    course:course(id),
    plan:{course_plan_id:`${id}-plan`,version_no:1,plan_state:'REVIEW_READY',source_snapshot_ref:'subject:s1:v1'},
    units:Array.from({length:count},(_,index)=>({
      learning_unit_id:`${id}-u${index+1}`,
      title:`Unit ${index+1}`,
      intended_competence:`Competence ${index+1}`,
      criticality:'major',
      foundational:index===0,
      instructional_load_min_minutes:0,
      instructional_load_max_minutes:0,
      exit_conditions:[{criterion:'Demonstrate the intended competence.'}],
      metadata:{instructional_treatment:'FULL_INSTRUCTION'},
    })),
    dependencies:[],
    coverage:[],
    scopeChanges:[],
    semesterTimezone:'UTC',
  };
}

function contextWithUnits(count=6) {
  const item=bundle('c1',count);
  return {
    course:item.course,
    semester:{semester_id:'sem1',state_version:1,starts_at:'2026-10-01T00:00:00Z',ends_at:'2026-12-01T00:00:00Z',timezone:'UTC'},
    profile:{profile_id:'profile1',version_no:1,preferences:{},settings:{}},
    availability:[{day_of_week:1,local_start:'09:00',local_end:'17:00',kind:'AVAILABLE'}],
    blocks:[],deadlines:[],reserves:[],courses:[item],unresolvedCourses:[],priorSlots:[],inheritedDefault:false,
  };
}

test('D09 workload preparation adaptively splits a MAX_TOKENS batch and persists bounded progress', async () => {
  const context=contextWithUnits(6);
  const callSizes=[];
  let execution=0;
  const intelligence={
    async execute(args){
      const refs=[...(args.instructionalLoadTargetRefs||[])];
      callSizes.push(refs.length);
      if(refs.length>2){
        const error=new Error('Central KIWI AI returned an incomplete Teaching artifact (MAX_TOKENS).');
        error.code='TEACHING_AI_OUTPUT_TRUNCATED';
        throw error;
      }
      execution+=1;
      return {
        accepted:true,
        executionId:`exec-${execution}`,
        validatedResult:{output:{capacity_analysis:{instructional_load_estimates:refs.map((ref)=>({
          scope_ref:ref,
          effort_range:{min:45,max:75,unit:'minutes'},
          estimate_basis:['intended competence','exit evidence'],
          uncertainty:'medium',
        }))}}},
      };
    },
  };
  const repository={
    async saveInstructionalLoadEstimates({estimates}){
      for(const estimate of estimates){
        const unit=context.courses.flatMap((item)=>item.units).find((item)=>item.learning_unit_id===estimate.learningUnitId);
        unit.instructional_load_min_minutes=estimate.minMinutes;
        unit.instructional_load_max_minutes=estimate.maxMinutes;
      }
    },
    async getSchedulingContext(){return context;},
  };
  const requireReadyContext=(value,courseId)=>{
    const found=value.courses.find((item)=>item.course.course_id===courseId);
    assert.ok(found);
    return found;
  };

  const prepared=await ensureInstructionalLoads({
    user:{id:'student-1'},
    courseId:'c1',
    initialContext:context,
    intelligence,
    repository,
    requireReadyContext,
    maxBatchSize:6,
  });

  assert.equal(callSizes[0],6);
  assert.ok(callSizes.some((size)=>size<6),'truncated batch should be split');
  assert.ok(callSizes.filter((size)=>size<=2).length>=2,'bounded sub-batches should eventually succeed');
  assert.equal(missingInstructionalLoads(prepared).length,0);
  assert.ok(prepared.courses[0].units.every((unit)=>unit.instructional_load_max_minutes===75));
});

test('TPF-10 instructional-load requests can target a bounded subset with completion headroom', () => {
  const context=contextWithUnits(5);
  const targetRefs=[
    scopeRef('c1','c1-u2'),
    scopeRef('c1','c1-u4'),
  ];
  const request=schedulingRequest({
    course:context.course,
    context,
    taskMode:'instructional_load_estimation',
    instructionalLoadTargetRefs:targetRefs,
  });

  assert.deepEqual(
    request.academicInput.estimate_only_these_learning_units.map((item)=>item.scope_ref),
    targetRefs
  );
  assert.ok(request.generation.maxOutputTokens>=16000);
  assert.ok(request.generation.maxOutputTokens<=24000);
  assert.ok(request.generation.structuredOutput.schema);
});

test('production D09 composition has one ordinary Semester rebuild owner', () => {
  const root=path.resolve(__dirname,'../../..');
  const base=fs.readFileSync(path.join(root,'teaching/d09/service.js'),'utf8');
  const integrity=fs.readFileSync(path.join(root,'teaching/d09/flow-integrity-service.js'),'utf8');
  const index=fs.readFileSync(path.join(root,'teaching/d09/index.js'),'utf8');

  assert.match(base,/async function rebuildSharedSemesterTimetable/);
  assert.match(base,/ensureInstructionalLoads\(\{/);
  assert.match(base,/planningContextAt\(context,now\)/);
  assert.match(base,/recalculateAfterCoursePlanChange[\s\S]*rebuildSharedSemesterTimetable/);
  assert.doesNotMatch(integrity,/async function recalculateAfterCoursePlanChange/);
  assert.match(integrity,/return base\.proposeTimetable\(user, courseId\)/);
  assert.match(index,/decorateD09Service\(createBaseD09Service\(options\),options\)/);
});

test('active Semester draft planning preserves approved authority while future proposals reflow', () => {
  const root=path.resolve(__dirname,'../../..');
  const repository=fs.readFileSync(path.join(root,'teaching/repositories/d09-scheduling.js'),'utf8');
  const service=fs.readFileSync(path.join(root,'teaching/d09/service.js'),'utf8');

  assert.match(repository,/const preserveApprovedAuthority=activatedRows\.length>0/);
  assert.match(repository,/preserveApprovedAuthority[\s\S]*timetable_state in \('PROPOSED','EDITED_PROPOSAL'\)/);
  assert.match(repository,/\(!authoritativeView && String\(latest\.timetable\.profile_id\)!==String\(context\.profile\?\.profile_id\|\|''\)\)/);
  assert.match(service,/source=expansion[\s\S]*'COURSE_ADMISSION_EXPANSION_PROPOSAL'/);
  assert.match(service,/changesSharedAuthority\|\|touchesActivatedSibling/);
});
