'use strict';

function createD09AttendanceRecoveryOwner({query,withTransaction,randomUUID,clock=()=>new Date()}={}){
  if(typeof query!=='function'||typeof withTransaction!=='function'||typeof randomUUID!=='function') throw new TypeError('D09 attendance recovery owner requires query, withTransaction and randomUUID.');
  const now=()=>{const v=clock();return v instanceof Date?v:new Date(v);};
  async function recordAttendanceRecoveryNeed({studentId,courseId,classId,attendanceRecordId,missedMinutes,reason,sourceTimetableVersionId=null}={}){
    const target=Math.max(0,Math.ceil(Number(missedMinutes)||0));
    return withTransaction(async(tx)=>{
      const {rows:courses}=await tx.query('select * from public.teaching_courses where student_id=$1 and course_id=$2 for update',[studentId,courseId]);
      const course=courses?.[0];if(!course?.semester_id){const e=new Error('Attendance recovery requires a Course Semester.');e.code='TEACHING_D09_RECOVERY_SEMESTER_REQUIRED';e.status=409;throw e;}
      const sourceRef=`attendance-recovery:${classId}`;
      const {rows:prior}=await tx.query(`select coalesce(sum(delta_minutes),0)::int current_minutes from public.teaching_schedule_debt_entries
        where student_id=$1 and semester_id=$2 and course_id=$3 and source_ref=$4`,[studentId,course.semester_id,courseId,sourceRef]);
      const current=Math.max(0,Number(prior?.[0]?.current_minutes)||0);const delta=target-current;
      if(delta===0) return Object.freeze({changed:false,currentMinutes:current,targetMinutes:target,sourceRef});
      const id=randomUUID();
      await tx.query(`insert into public.teaching_schedule_debt_entries(
        schedule_debt_entry_id,student_id,semester_id,course_id,timetable_version_id,delta_minutes,cause_code,source_ref,recorded_at
      ) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[id,studentId,course.semester_id,courseId,sourceTimetableVersionId,delta,
        delta>0?'ATTENDANCE_RECOVERY_REQUIRED':'ATTENDANCE_RECOVERY_CORRECTION',sourceRef,now()]);
      await tx.query(`insert into public.teaching_academic_audit_log(
        audit_id,student_id,occurred_at,actor_type,actor_id,action,entity_type,entity_id,authoritative_owner,state_version_ref,
        reason,before_ref,after_ref,provenance_refs,safe_metadata
      ) values($1,$2,$3,'SYSTEM',null,'scheduler.attendance_recovery.reconcile','SCHEDULE_DEBT',$4,'scheduler',null,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb)`,[
        randomUUID(),studentId,now(),sourceRef,String(reason||'ATTENDANCE_RECOVERY'),JSON.stringify({minutes:current}),JSON.stringify({minutes:target}),
        JSON.stringify([`attendance:${attendanceRecordId}`]),JSON.stringify({class_id:classId,delta_minutes:delta,mastery_inference:false,gradebook_mutation:false})]);
      return Object.freeze({changed:true,currentMinutes:target,targetMinutes:target,deltaMinutes:delta,sourceRef});
    });
  }
  return Object.freeze({recordAttendanceRecoveryNeed});
}
module.exports={createD09AttendanceRecoveryOwner};
