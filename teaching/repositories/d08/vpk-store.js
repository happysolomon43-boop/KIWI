'use strict';

function createVpkStore({ query, randomUUID, json }) {
  async function loadControlledVpkEvidence({ studentId, courseId, targetKind, targetRef, evidenceRefs }) {
    if (!Array.isArray(evidenceRefs) || !evidenceRefs.length) return [];
    const { rows = [] } = await query(`
      select e.*
      from public.teaching_evidence_events e
      where e.student_id=$1 and e.course_id=$2 and e.evidence_event_id=any($3::text[])
        and e.independent_performance=true
        and coalesce((e.response_quality->>'controlled_for_vpk_recheck')::boolean,false)=true
        and coalesce((e.response_quality->>'contradicts_validated_prior_knowledge')::boolean,false)=true
        and (
          ($4='LEARNING_UNIT' and exists(
            select 1 from public.teaching_evidence_event_learning_units l
            where l.evidence_event_id=e.evidence_event_id and l.student_id=$1 and l.learning_unit_id=$5
          ))
          or ($4<>'LEARNING_UNIT' and e.response_quality->>'target_ref'=$5)
        )
    `, [studentId, courseId, evidenceRefs, targetKind, targetRef]);
    return rows;
  }

  async function appendVpkDowngrade({ studentId, courseId, currentDecision, downgrade }) {
    const { rows } = await query(`
      insert into public.teaching_validated_prior_knowledge_decisions(
        vpk_decision_id,student_id,course_id,target_kind,target_ref,decision_status,policy_version,validator_id,validator_version,
        evidence_refs,probe_refs,provenance_refs,decision_reasons,supersedes_vpk_decision_id
      ) values($1,$2,$3,$4,$5,'NOT_VALIDATED','validated-prior-knowledge.v1',$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12)
      returning *
    `, [randomUUID(), studentId, courseId, currentDecision.target_kind, currentDecision.target_ref, downgrade.validatorId, downgrade.validatorVersion, json(downgrade.evidenceRefs), json(downgrade.probeRefs), json(downgrade.provenanceRefs), json([...downgrade.reasons, `contradiction_policy:${downgrade.policyVersion}`]), currentDecision.vpk_decision_id]);
    return rows[0];
  }
  return Object.freeze({ loadControlledVpkEvidence, appendVpkDowngrade });
}

module.exports = { createVpkStore };
