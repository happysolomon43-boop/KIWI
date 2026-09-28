'use strict';

function createVpkStore({ q, withTransaction, randomUUID, clock, json }) {
  async function getVpkDecision(studentId, courseId, decisionId) {
    const { rows = [] } = await q(null, `select * from public.teaching_validated_prior_knowledge_decisions where student_id=$1 and course_id=$2 and vpk_decision_id=$3`, [studentId, courseId, decisionId]);
    return rows[0] || null;
  }

  async function loadControlledContradictionEvidence({ studentId, courseId, decision, evidenceRefs }) {
    if (!Array.isArray(evidenceRefs) || !evidenceRefs.length) return [];
    const { rows = [] } = await q(null, `
      select e.*
        from public.teaching_evidence_events e
       where e.student_id=$1 and e.course_id=$2 and e.evidence_event_id=any($3::text[])
         and (
           ($4='LEARNING_UNIT' and exists(
             select 1 from public.teaching_evidence_event_learning_units l
              where l.evidence_event_id=e.evidence_event_id and l.student_id=$1 and l.learning_unit_id=$5
           ))
           or ($4<>'LEARNING_UNIT' and e.response_quality->>'target_ref'=$5)
         )
    `, [studentId, courseId, evidenceRefs, decision.target_kind, decision.target_ref]);
    return rows;
  }

  async function supersedeVpkDecisionWithContradiction({ studentId, courseId, decision, evidenceRows }) {
    return withTransaction(async (tx) => {
      const latest = await q(tx, `
        select * from public.teaching_validated_prior_knowledge_decisions
         where student_id=$1 and course_id=$2 and target_kind=$3 and target_ref=$4
         order by decided_at desc limit 1 for update
      `, [studentId, courseId, decision.target_kind, decision.target_ref]);
      if (!latest.rows?.[0] || latest.rows[0].vpk_decision_id !== decision.vpk_decision_id || latest.rows[0].decision_status !== 'VALIDATED_PRIOR_KNOWLEDGE') {
        const error = new Error('Validated prior-knowledge state changed before contradiction reconciliation.');
        error.status = 409; error.code = 'TEACHING_D08_VPK_STALE'; throw error;
      }
      const now = clock();
      const newId = randomUUID();
      const refs = evidenceRows.map((row) => String(row.evidence_event_id));
      const { rows } = await q(tx, `
        insert into public.teaching_validated_prior_knowledge_decisions(
          vpk_decision_id,student_id,course_id,target_kind,target_ref,decision_status,policy_version,validator_id,validator_version,
          evidence_refs,probe_refs,provenance_refs,decision_reasons,decided_at,supersedes_vpk_decision_id
        ) values($1,$2,$3,$4,$5,'NOT_VALIDATED','validated-prior-knowledge.v1','d08-controlled-contradiction','1',$6::jsonb,'[]'::jsonb,$7::jsonb,$8::jsonb,$9,$10)
        returning *
      `, [
        newId, studentId, courseId, decision.target_kind, decision.target_ref, json(refs),
        json(refs.map((ref) => `evidence:${ref}`)),
        json(['LATER_CONTROLLED_EVIDENCE_CONTRADICTS_VALIDATED_PRIOR_KNOWLEDGE']), now, decision.vpk_decision_id,
      ]);
      await q(tx, `update public.teaching_course_plans set plan_state='REVIEW_REQUIRED' where student_id=$1 and course_id=$2 and plan_state='REVIEW_READY'`, [studentId, courseId]);
      await q(tx, `update public.teaching_courses set state_version=state_version+1,updated_at=$3 where student_id=$1 and course_id=$2`, [studentId, courseId, now]);
      await q(tx, `
        insert into public.teaching_academic_audit_log(
          audit_id,student_id,occurred_at,actor_type,action,entity_type,entity_id,authoritative_owner,state_version_ref,reason,
          before_ref,after_ref,provenance_refs,safe_metadata
        ) values($1,$2,$3,'SYSTEM','VALIDATED_PRIOR_KNOWLEDGE_REVOKED','VALIDATED_PRIOR_KNOWLEDGE',$4,'Course Plan/Coverage',$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb)
      `, [
        randomUUID(), studentId, now, newId, `vpk:${newId}`,
        'Later controlled evidence contradicted the prior-knowledge decision; history was superseded, not rewritten.',
        json({ vpk_decision_id: decision.vpk_decision_id, decision_status: decision.decision_status }),
        json({ vpk_decision_id: newId, decision_status: 'NOT_VALIDATED' }),
        json(refs.map((ref) => `evidence:${ref}`)), json({ supersedes_vpk_decision_id: decision.vpk_decision_id }),
      ]);
      return rows[0];
    });
  }

  return Object.freeze({ getVpkDecision, loadControlledContradictionEvidence, supersedeVpkDecisionWithContradiction });
}

module.exports = { createVpkStore };
