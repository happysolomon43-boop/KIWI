'use strict';

const crypto = require('node:crypto');
const { SKM_ALGORITHM_ID, SKM_ALGORITHM_VERSION } = require('../d13/state-engine');

function createD13StudentKnowledgeRepository({query,withTransaction,randomUUID,clock=()=>new Date()}={}){
  if(typeof query!=='function')throw new TypeError('D13 repository requires query().');
  if(typeof withTransaction!=='function')throw new TypeError('D13 repository requires withTransaction().');
  if(typeof randomUUID!=='function')throw new TypeError('D13 repository requires randomUUID().');

  const q=(runner,text,params=[])=>runner&&typeof runner.query==='function'?runner.query(text,params):query(text,params);
  const json=(v)=>JSON.stringify(v??null);
  function stableDigest(value){
    const canonical=(input)=>{
      if(Array.isArray(input))return input.map(canonical);
      if(input&&typeof input==='object')return Object.fromEntries(Object.keys(input).sort().map((k)=>[k,canonical(input[k])]));
      return input;
    };
    return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
  }
  function stale(message='Student Knowledge Model evidence/state changed before commit.'){
    const e=new Error(message);e.code='TEACHING_D13_STALE_KNOWLEDGE_SNAPSHOT';e.status=409;return e;
  }

  async function assertReady(){
    const {rows}=await query(
      "select to_regclass('public.teaching_evidence_events') evidence_events,"+
      " to_regclass('public.teaching_student_knowledge_state_versions') skm_versions,"+
      " to_regclass('public.teaching_skm_evidence_applications') evidence_applications,"+
      " to_regclass('public.teaching_persistent_misconception_versions') misconception_versions"
    );
    const row=rows?.[0]||{};
    if(Object.values(row).some((v)=>v==null)){
      const e=new Error('Teaching D13 persistence is not installed.');e.code='TEACHING_D13_SCHEMA_MISSING';throw e;
    }
    const columns=await query(
      "select column_name from information_schema.columns where table_schema='public' and table_name='teaching_evidence_events'"+
      " and column_name=any($1::text[])",
      [[
        'source_interpretation_ref','source_owner','task_ref','evidence_claim','demand_vector',
        'instructional_lineage_refs','support_context','answer_or_method_exposed','permitted_tools',
        'accessibility_support','control_context','confidence_sample','misconception_context',
        'prerequisite_context','path_context','evidence_validity','evidential_strength',
        'information_gain','comparability_group','redundancy','normalization_version'
      ]]
    );
    if((columns.rows||[]).length!==21){
      const e=new Error('Teaching D13 evidence normalization columns are incomplete.');e.code='TEACHING_D13_SCHEMA_MISSING';throw e;
    }
    return true;
  }

  async function getLearningUnit(studentId,learningUnitId,runner=null){
    const {rows}=await q(runner,
      "select lu.*,cp.course_id from public.teaching_learning_units lu join public.teaching_course_plans cp on cp.course_plan_id=lu.course_plan_id"+
      " where lu.student_id=$1 and lu.learning_unit_id=$2 limit 1",
      [studentId,learningUnitId]
    );
    return rows?.[0]||null;
  }

  async function latestEvaluationForResponse(studentId,responseId,runner=null){
    const {rows}=await q(runner,
      "select * from public.teaching_response_evaluations where student_id=$1 and response_id=$2 order by evaluation_version desc limit 1",
      [studentId,responseId]
    );
    return rows?.[0]||null;
  }

  async function loadEvaluationBundle(studentId,evaluationId,runner=null){
    const {rows}=await q(runner,
      "select e.*,r.response_kind,r.response_payload,r.submitted_at,r.server_received_at,r.assistance_context,"+
      " lu.title learning_unit_title,lu.intended_competence,lu.exit_conditions,lu.metadata learning_unit_metadata,lu.course_plan_id,"+
      " cp.course_id,c.class_id source_class_id"+
      " from public.teaching_response_evaluations e"+
      " join public.teaching_student_responses r on r.response_id=e.response_id and r.student_id=e.student_id"+
      " join public.teaching_learning_units lu on lu.learning_unit_id=e.learning_unit_id and lu.student_id=e.student_id"+
      " join public.teaching_course_plans cp on cp.course_plan_id=lu.course_plan_id and cp.student_id=e.student_id"+
      " join public.teaching_classes c on c.class_id=e.class_id and c.student_id=e.student_id"+
      " where e.student_id=$1 and e.evaluation_id=$2 limit 1",
      [studentId,evaluationId]
    );
    const row=rows?.[0]; if(!row)return null;
    const prior=await q(runner,
      "select pedagogy_decision_id,strategy_class,blocked_proposal,decision_state,decision_payload,created_at"+
      " from public.teaching_pedagogy_decisions where student_id=$1 and learning_unit_id=$2 and created_at<=$3"+
      " order by created_at desc limit 12",
      [studentId,row.learning_unit_id,row.created_at]
    );
    return Object.freeze({
      evaluation:Object.freeze({
        evaluation_id:row.evaluation_id,student_id:row.student_id,response_id:row.response_id,class_id:row.class_id,
        class_session_id:row.class_session_id,learning_unit_id:row.learning_unit_id,controller_version:row.controller_version,
        evaluation_version:row.evaluation_version,evaluation_state:row.evaluation_state,evaluation_payload:row.evaluation_payload,
        evaluator_confidence:row.evaluator_confidence,evidence_strength:row.evidence_strength,
        assistance_state:row.assistance_state,exposure_state:row.exposure_state,candidate_misconception:row.candidate_misconception,
        prerequisite_hypothesis:row.prerequisite_hypothesis,provenance_refs:row.provenance_refs,created_at:row.created_at,
      }),
      response:Object.freeze({
        response_id:row.response_id,response_kind:row.response_kind,response_payload:row.response_payload,
        submitted_at:row.submitted_at,server_received_at:row.server_received_at,assistance_context:row.assistance_context,
      }),
      learningUnit:Object.freeze({
        learning_unit_id:row.learning_unit_id,course_plan_id:row.course_plan_id,title:row.learning_unit_title,
        intended_competence:row.intended_competence,exit_conditions:row.exit_conditions,metadata:row.learning_unit_metadata||{},
      }),
      classRow:Object.freeze({class_id:row.source_class_id,course_id:row.course_id}),
      priorPedagogy:Object.freeze(prior.rows||[]),
    });
  }

  async function findEvidenceBySource(studentId,sourceOwner,sourceInterpretationRef,runner=null){
    const {rows}=await q(runner,
      "select * from public.teaching_evidence_events where student_id=$1 and source_owner=$2 and source_interpretation_ref=$3 limit 1",
      [studentId,sourceOwner,sourceInterpretationRef]
    );
    return rows?.[0]||null;
  }

  async function insertNormalizedEvidence({studentId,normalized,idempotencyKey=null}={}){
    return withTransaction(async(tx)=>{
      const existing=await findEvidenceBySource(studentId,normalized.sourceOwner,normalized.sourceRef,tx);
      if(existing)return Object.freeze({evidence:existing,idempotent:true});
      const unitRows=await tx.query(
        "select lu.learning_unit_id,cp.course_id from public.teaching_learning_units lu join public.teaching_course_plans cp on cp.course_plan_id=lu.course_plan_id"+
        " where lu.student_id=$1 and lu.learning_unit_id=any($2::text[])",
        [studentId,normalized.learningUnitRefs]
      );
      if((unitRows.rows||[]).length!==new Set(normalized.learningUnitRefs).size){
        const e=new Error('Normalized evidence references a Learning Unit not owned by the student.');e.code='TEACHING_D13_EVIDENCE_LEARNING_UNIT_NOT_FOUND';e.status=409;throw e;
      }
      if(unitRows.rows.some((row)=>String(row.course_id)!==String(normalized.courseId))){
        const e=new Error('Normalized evidence Course/Learning Unit ownership mismatch.');e.code='TEACHING_D13_EVIDENCE_COURSE_MISMATCH';e.status=409;throw e;
      }
      const evidenceId=randomUUID();
      const inserted=await tx.query(
        "insert into public.teaching_evidence_events("+
        "evidence_event_id,student_id,course_id,class_session_id,source_response_id,evidence_kind,evidence_purpose,formal_assessment,"+
        "independent_performance,assistance_level,response_quality,difficulty_context,novelty_context,observed_errors,provenance_refs,occurred_at,"+
        "source_interpretation_ref,source_owner,task_ref,evidence_claim,demand_vector,instructional_lineage_refs,support_context,"+
        "answer_or_method_exposed,permitted_tools,accessibility_support,control_context,confidence_sample,misconception_context,prerequisite_context,"+
        "path_context,evidence_validity,evidential_strength,information_gain,comparability_group,redundancy,normalization_version)"+
        " values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16,"+
        "$17,$18,$19,$20,$21::jsonb,$22::jsonb,$23::jsonb,$24,$25::jsonb,$26::jsonb,$27,$28::jsonb,$29::jsonb,$30::jsonb,$31::jsonb,$32,$33,$34,$35,$36,$37) returning *",
        [
          evidenceId,studentId,normalized.courseId,normalized.classSessionId,normalized.sourceResponseId,
          normalized.evidenceKind,normalized.evidencePurpose,normalized.formalAssessment,normalized.independentPerformance,normalized.assistanceLevel,
          json(normalized.responseQuality),json(normalized.difficultyContext),json(normalized.noveltyContext),json(normalized.observedErrors),json(normalized.provenanceRefs),
          normalized.occurredAt,normalized.sourceRef,normalized.sourceOwner,normalized.taskRef,normalized.evidenceClaim,json(normalized.demandVector),
          json(normalized.instructionalLineageRefs),json(normalized.supportContext),normalized.answerOrMethodExposed,json(normalized.permittedTools),
          json(normalized.accessibilitySupport),normalized.controlContext,json(normalized.confidenceSample),json(normalized.misconceptionContext),
          json(normalized.prerequisiteContext),json(normalized.pathContext),normalized.evidenceValidity,normalized.evidentialStrength,normalized.informationGain,
          normalized.comparabilityGroup,normalized.redundancy,normalized.normalizationVersion,
        ]
      );
      for(let i=0;i<normalized.learningUnitRefs.length;i+=1){
        await tx.query(
          "insert into public.teaching_evidence_event_learning_units(evidence_event_id,learning_unit_id,student_id,evidence_role)"+
          " values($1,$2,$3,$4) on conflict do nothing",
          [evidenceId,normalized.learningUnitRefs[i],studentId,i===0?'PRIMARY':'SECONDARY']
        );
      }
      return Object.freeze({evidence:inserted.rows[0],idempotent:false,idempotencyKey:idempotencyKey||null});
    });
  }

  async function currentMisconceptions(studentId,learningUnitId,runner=null){
    const {rows}=await q(runner,
      "select distinct on (misconception_record_id) * from public.teaching_persistent_misconception_versions"+
      " where student_id=$1 and (primary_learning_unit_id=$2 or affected_learning_unit_refs ? $2)"+
      " order by misconception_record_id,version_no desc",
      [studentId,learningUnitId]
    );
    return rows||[];
  }

  async function latestKnowledgeState(studentId,learningUnitId,runner=null){
    const {rows}=await q(runner,
      "select * from public.teaching_student_knowledge_state_versions where student_id=$1 and learning_unit_id=$2"+
      " order by version_no desc limit 1",
      [studentId,learningUnitId]
    );
    return rows?.[0]||null;
  }

  async function knowledgeHistory(studentId,learningUnitId,{limit=50}={},runner=null){
    const {rows}=await q(runner,
      "select * from public.teaching_student_knowledge_state_versions where student_id=$1 and learning_unit_id=$2"+
      " order by version_no asc limit $3",
      [studentId,learningUnitId,Math.max(1,Math.min(Number(limit)||50,500))]
    );
    return rows||[];
  }

  async function loadEvidenceForLearningUnit(studentId,learningUnitId,runner=null){
    const {rows}=await q(runner,
      "select e.* from public.teaching_evidence_events e join public.teaching_evidence_event_learning_units l"+
      " on l.evidence_event_id=e.evidence_event_id and l.student_id=e.student_id"+
      " where e.student_id=$1 and l.learning_unit_id=$2 order by e.occurred_at,e.evidence_event_id",
      [studentId,learningUnitId]
    );
    return rows||[];
  }

  function digestSnapshot(events,latestState){
    return stableDigest({
      event_refs:events.map((row)=>[row.evidence_event_id,row.occurred_at,row.normalization_version,row.evidence_validity,row.evidential_strength]),
      latest_state_version:latestState?Number(latestState.version_no):0,
      algorithm_version:SKM_ALGORITHM_VERSION,
    });
  }

  async function loadKnowledgeSnapshot(studentId,learningUnitId,runner=null){
    const [unit,evidence,state,misconceptions]=await Promise.all([
      getLearningUnit(studentId,learningUnitId,runner),
      loadEvidenceForLearningUnit(studentId,learningUnitId,runner),
      latestKnowledgeState(studentId,learningUnitId,runner),
      currentMisconceptions(studentId,learningUnitId,runner),
    ]);
    if(!unit)return null;
    return Object.freeze({
      unit,
      evidence:Object.freeze(evidence),
      latestState:state,
      misconceptions:Object.freeze(misconceptions),
      stateVersion:state?Number(state.version_no):0,
      evidenceDigest:digestSnapshot(evidence,state),
    });
  }

  function misconceptionChanged(current,next){
    if(!current)return true;
    const fields=['status','normalized_hypothesis','hypothesis','confidence'];
    if(fields.some((k)=>String(current[k]??'')!==String(next[k]??'')))return true;
    const jsonFields=[
      ['affected_learning_unit_refs','affected_learning_unit_refs'],
      ['supporting_evidence_refs','supporting_evidence_refs'],
      ['repair_attempt_refs','repair_attempt_refs'],
      ['independent_verification_refs','independent_verification_refs'],
      ['delayed_verification_refs','delayed_verification_refs'],
    ];
    return jsonFields.some(([a,b])=>stableDigest(current[a]||[])!==stableDigest(next[b]||[]));
  }

  async function commitKnowledgeUpdate({studentId,learningUnitId,causeEvidenceEventId,computed,snapshot}={}){
    return withTransaction(async(tx)=>{
      await tx.query("select learning_unit_id from public.teaching_learning_units where student_id=$1 and learning_unit_id=$2 for update",[studentId,learningUnitId]);
      const applied=await tx.query(
        "select a.*,s.* from public.teaching_skm_evidence_applications a left join public.teaching_student_knowledge_state_versions s"+
        " on s.knowledge_state_version_id=a.resulting_state_version_id where a.student_id=$1 and a.evidence_event_id=$2"+
        " and a.learning_unit_id=$3 and a.algorithm_version=$4 limit 1",
        [studentId,causeEvidenceEventId,learningUnitId,SKM_ALGORITHM_VERSION]
      );
      if(applied.rows?.[0])return Object.freeze({state:applied.rows[0],idempotent:true});
      const liveEvents=await loadEvidenceForLearningUnit(studentId,learningUnitId,tx);
      const liveState=await latestKnowledgeState(studentId,learningUnitId,tx);
      const liveDigest=digestSnapshot(liveEvents,liveState);
      if(String(liveDigest)!==String(snapshot.evidenceDigest) || Number(liveState?.version_no||0)!==Number(snapshot.stateVersion||0))throw stale();
      if(!liveEvents.some((row)=>String(row.evidence_event_id)===String(causeEvidenceEventId))){
        const e=new Error('Cause Evidence Event is not linked to this Learning Unit.');e.code='TEACHING_D13_CAUSE_EVIDENCE_NOT_LINKED';e.status=409;throw e;
      }
      const versionNo=Number(liveState?.version_no||0)+1;
      const versionId=randomUUID();
      const provenance=[...new Set(['evidence:'+causeEvidenceEventId,...liveEvents.map((row)=>'evidence:'+row.evidence_event_id)])];
      const inserted=await tx.query(
        "insert into public.teaching_student_knowledge_state_versions("+
        "knowledge_state_version_id,student_id,learning_unit_id,version_no,algorithm_id,algorithm_version,base_state,overlays,dimensions,"+
        "certainty_band,certainty_basis,retention_context,strongest_supported_claim,contradiction_state,evidence_event_count,evidence_cutoff_at,"+
        "path_to_success,confidence_calibration,source_evidence_digest,cause_evidence_event_id,provenance_refs)"+
        " values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19,$20,$21::jsonb) returning *",
        [
          versionId,studentId,learningUnitId,versionNo,SKM_ALGORITHM_ID,SKM_ALGORITHM_VERSION,computed.base_state,json(computed.overlays),
          json(computed.dimensions),computed.certainty_band,json(computed.certainty_basis),json(computed.retention_context),
          computed.strongest_supported_claim,Boolean(computed.contradiction_state),Number(computed.evidence_event_count||0),computed.evidence_cutoff_at,
          json(computed.path_to_success),json(computed.confidence_calibration),liveDigest,causeEvidenceEventId,json(provenance),
        ]
      );
      await tx.query(
        "insert into public.teaching_skm_evidence_applications("+
        "evidence_application_id,student_id,evidence_event_id,learning_unit_id,algorithm_id,algorithm_version,application_state,"+
        "information_gain,resulting_state_version_id,application_reason,created_at)"+
        " values($1,$2,$3,$4,$5,$6,'APPLIED',$7,$8,$9,$10)",
        [randomUUID(),studentId,causeEvidenceEventId,learningUnitId,SKM_ALGORITHM_ID,SKM_ALGORITHM_VERSION,
          liveEvents.find((row)=>String(row.evidence_event_id)===String(causeEvidenceEventId))?.information_gain||'UNKNOWN',
          versionId,'Deterministic replay-safe recomputation over all normalized evidence.',clock()]
      );
      const currentRows=await currentMisconceptions(studentId,learningUnitId,tx);
      const byId=new Map(currentRows.map((row)=>[String(row.misconception_record_id),row]));
      for(const next of computed.misconceptions||[]){
        const current=byId.get(String(next.misconception_record_id))||null;
        if(!misconceptionChanged(current,next))continue;
        const nextVersion=Number(current?.version_no||0)+1;
        await tx.query(
          "insert into public.teaching_persistent_misconception_versions("+
          "misconception_version_id,misconception_record_id,student_id,primary_learning_unit_id,normalized_hypothesis,hypothesis,version_no,status,"+
          "affected_learning_unit_refs,supporting_evidence_refs,repair_attempt_refs,independent_verification_refs,delayed_verification_refs,confidence,"+
          "algorithm_version,supersedes_misconception_version_id,cause_evidence_event_id,provenance_refs)"+
          " values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15,$16,$17,$18::jsonb)",
          [
            randomUUID(),next.misconception_record_id,studentId,learningUnitId,next.normalized_hypothesis,next.hypothesis,nextVersion,next.status,
            json(next.affected_learning_unit_refs),json(next.supporting_evidence_refs),json(next.repair_attempt_refs),
            json(next.independent_verification_refs),json(next.delayed_verification_refs),next.confidence,SKM_ALGORITHM_VERSION,
            current?.misconception_version_id||null,causeEvidenceEventId,json(next.supporting_evidence_refs.map((ref)=>'evidence:'+ref)),
          ]
        );
      }
      return Object.freeze({state:inserted.rows[0],idempotent:false});
    });
  }

  async function listCourseKnowledge(studentId,courseId,runner=null){
    const {rows}=await q(runner,
      "with current_state as ("+
      " select distinct on (s.learning_unit_id) s.* from public.teaching_student_knowledge_state_versions s"+
      " where s.student_id=$1 order by s.learning_unit_id,s.version_no desc"+
      ") select lu.learning_unit_id,lu.title,lu.intended_competence,lu.course_plan_id,"+
      " cs.knowledge_state_version_id,cs.version_no,cs.algorithm_id,cs.algorithm_version,cs.base_state,cs.overlays,cs.dimensions,"+
      " cs.certainty_band,cs.certainty_basis,cs.retention_context,cs.strongest_supported_claim,cs.contradiction_state,"+
      " cs.evidence_event_count,cs.evidence_cutoff_at,cs.path_to_success,cs.confidence_calibration,cs.created_at"+
      " from public.teaching_learning_units lu"+
      " join public.teaching_course_plans cp on cp.course_plan_id=lu.course_plan_id and cp.student_id=lu.student_id"+
      " left join current_state cs on cs.learning_unit_id=lu.learning_unit_id and cs.student_id=lu.student_id"+
      " where lu.student_id=$1 and cp.course_id=$2 and cp.plan_state<>'SUPERSEDED'"+
      " order by coalesce(lu.sequence_no,0),lu.learning_unit_id",
      [studentId,courseId]
    );
    return rows||[];
  }

  async function listCourseCurrentMisconceptions(studentId,courseId,runner=null){
    const {rows}=await q(runner,
      "select distinct on (m.misconception_record_id) m.* from public.teaching_persistent_misconception_versions m"+
      " join public.teaching_learning_units lu on lu.learning_unit_id=m.primary_learning_unit_id and lu.student_id=m.student_id"+
      " join public.teaching_course_plans cp on cp.course_plan_id=lu.course_plan_id and cp.student_id=m.student_id"+
      " where m.student_id=$1 and cp.course_id=$2 order by m.misconception_record_id,m.version_no desc",
      [studentId,courseId]
    );
    return rows||[];
  }

  return Object.freeze({
    assertReady,getLearningUnit,latestEvaluationForResponse,loadEvaluationBundle,findEvidenceBySource,insertNormalizedEvidence,
    loadEvidenceForLearningUnit,latestKnowledgeState,knowledgeHistory,currentMisconceptions,loadKnowledgeSnapshot,
    commitKnowledgeUpdate,listCourseKnowledge,listCourseCurrentMisconceptions,
  });
}

module.exports={createD13StudentKnowledgeRepository};
