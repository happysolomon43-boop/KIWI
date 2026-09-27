'use strict';

const { array, object, text, failure, assertNoAuthoritySmuggling, latestVpk, validateExitConditions } = require('./contracts-core');
const { validateCoursePlanProposal } = require('./durable-plan');

function validateCanonicalCoursePlanProposal(output, { audit, sourceItems = [], vpkDecisions = [] } = {}) {
  try {
    object(output, 'Course Plan proposal');
    assertNoAuthoritySmuggling(output);
    if (!audit || (audit.status && audit.status !== 'VALIDATED_CANDIDATE')) failure('A validated Curriculum Audit is required.', 'TEACHING_D08_CURRICULUM_AUDIT_REQUIRED');
    const auditOutput = object(audit.audit_output, 'Curriculum Audit output');
    const validStatuses = new Set(['ok','unresolved_inputs','academically_infeasible_under_constraints','requires_scope_review']);
    if (!validStatuses.has(String(output.status))) failure('Course Plan proposal status is invalid.', 'TEACHING_D08_PLAN_STATUS_INVALID');
    if (typeof output.review_required !== 'boolean') failure('review_required must be boolean.');
    const reviewReasons = array(output.review_reasons || [], 'review_reasons', 200).map((item, index) => text(item, `review_reasons[${index}]`, 2000));
    const sequence = array(output.course_sequence || [], 'course_sequence', 500);
    const coverageMap = array(output.coverage_treatment_map || [], 'coverage_treatment_map', 2000);
    array(output.prerequisite_repairs || [], 'prerequisite_repairs', 500);
    array(output.assessment_window_proposals || [], 'assessment_window_proposals', 200);
    array(output.infeasibility_or_pressure || [], 'infeasibility_or_pressure', 200);
    array(output.unresolved_items || [], 'unresolved_items', 500);
    const auditUnits = new Map(array(auditOutput.learning_units || [], 'audit.learning_units', 1000).map((unit) => [String(unit.id), unit]));
    if (!auditUnits.size) failure('Curriculum Audit contains no Learning Units.', 'TEACHING_D08_CURRICULUM_AUDIT_REQUIRED');
    const latest = latestVpk(vpkDecisions);
    const plannedUnits = new Map();
    for (const [groupIndex, group] of sequence.entries()) {
      object(group, `course_sequence[${groupIndex}]`);
      if (!Number.isInteger(group.sequence_group) || group.sequence_group < 0) failure(`course_sequence[${groupIndex}].sequence_group is invalid.`);
      text(group.topic_or_phase, `course_sequence[${groupIndex}].topic_or_phase`, 1000);
      for (const [unitIndex, planned] of array(group.learning_units || [], `course_sequence[${groupIndex}].learning_units`, 1000).entries()) {
        object(planned, `course_sequence[${groupIndex}].learning_units[${unitIndex}]`);
        const ref = text(planned.learning_unit_ref, 'learning_unit_ref', 300);
        if (!auditUnits.has(ref)) failure(`Course Plan references unknown Curriculum Audit Learning Unit ${ref}.`, 'TEACHING_D08_AUDIT_UNIT_MAPPING_INVALID');
        if (plannedUnits.has(ref)) failure(`Course Plan duplicates Learning Unit ${ref}.`, 'TEACHING_D08_DUPLICATE_PLAN_UNIT');
        if (planned.required_scope !== true) failure(`Required Learning Unit ${ref} cannot be made optional by Course Plan generation.`, 'TEACHING_D08_REQUIRED_UNIT_OPTIONALIZED');
        const initial = String(planned.initial_instruction_status || '');
        if (!['teach_full','teach_compressed','validated_prior_knowledge_no_initial_instruction','unresolved'].includes(initial)) failure(`Learning Unit ${ref} has invalid initial_instruction_status.`);
        const vpk = latest.get(`LEARNING_UNIT:${ref}`);
        if (['teach_compressed','validated_prior_knowledge_no_initial_instruction'].includes(initial) && vpk?.decision_status !== 'VALIDATED_PRIOR_KNOWLEDGE') {
          failure(`Learning Unit ${ref} cannot compress or skip ordinary instruction without current VPK evidence.`, 'TEACHING_D08_VPK_COMPRESSION_UNAUTHORIZED');
        }
        const followUps = array(planned.follow_up_treatments || [], `learning_unit:${ref}.follow_up_treatments`, 100).map(String);
        if (initial === 'unresolved' && output.review_required !== true) failure(`Unresolved Learning Unit ${ref} requires review.`, 'TEACHING_D08_UNRESOLVED_PLAN_REVIEW_REQUIRED');
        if (!String(planned.evidence_goal || '').trim()) failure(`Learning Unit ${ref} requires an evidence_goal.`);
        plannedUnits.set(ref, Object.freeze({
          learning_unit_ref: ref,
          initial_instruction_status: initial,
          initial_treatment_basis: text(planned.initial_treatment_basis, `learning_unit:${ref}.initial_treatment_basis`, 4000),
          prerequisite_repair_refs: Object.freeze(array(planned.prerequisite_repair_refs || [], `learning_unit:${ref}.prerequisite_repair_refs`, 200).map(String)),
          follow_up_treatments: Object.freeze(followUps),
          prerequisite_refs: Object.freeze(array(planned.prerequisite_refs || [], `learning_unit:${ref}.prerequisite_refs`, 200).map(String)),
          instructional_emphasis: text(planned.instructional_emphasis, `learning_unit:${ref}.instructional_emphasis`, 50),
          emphasis_basis: text(planned.emphasis_basis, `learning_unit:${ref}.emphasis_basis`, 2000),
          evidence_goal: text(planned.evidence_goal, `learning_unit:${ref}.evidence_goal`, 3000),
          review_or_retention_notes: text(planned.review_or_retention_notes, `learning_unit:${ref}.review_or_retention_notes`, 3000, false),
          student_intake_accommodation_notes: text(planned.student_intake_accommodation_notes, `learning_unit:${ref}.student_intake_accommodation_notes`, 3000, false),
        }));
      }
    }
    const missingUnits = [...auditUnits.keys()].filter((ref) => !plannedUnits.has(ref));
    if (missingUnits.length) failure(`Course Plan omitted required Learning Units: ${missingUnits.join(', ')}`, 'TEACHING_D08_REQUIRED_UNIT_UNMAPPED');

    const coverageByRef = new Map();
    for (const [index, row] of coverageMap.entries()) {
      object(row, `coverage_treatment_map[${index}]`);
      const ref = text(row.required_source_or_unit_ref, `coverage_treatment_map[${index}].required_source_or_unit_ref`, 700);
      if (coverageByRef.has(ref)) failure(`Duplicate Course Plan coverage treatment ${ref}.`);
      if (row.coverage_status_claimed !== 'planned_only') failure('Course Plan generation cannot claim authoritative Coverage completion.', 'TEACHING_D08_COVERAGE_AUTHORITY_VIOLATION');
      const treatmentRefs = Object.freeze(array(row.planned_treatment_refs || [], `coverage_treatment_map:${ref}.planned_treatment_refs`, 300).map(String));
      if (!['full','partial','unresolved'].includes(String(row.mapping_completeness_proposal))) failure(`Coverage mapping ${ref} has invalid completeness.`);
      coverageByRef.set(ref, Object.freeze({ required_source_or_unit_ref: ref, planned_treatment_refs: treatmentRefs, mapping_completeness_proposal: String(row.mapping_completeness_proposal), coverage_status_claimed: 'planned_only' }));
    }
    const requiredSources = sourceItems.filter((source) => source.academically_meaningful === true || source.classification === 'ACADEMICALLY_MEANINGFUL');
    const missingSources = requiredSources.filter((source) => !coverageByRef.has(String(source.source_ref)));
    if (missingSources.length) failure(`Required meaningful source remains unmapped: ${missingSources.map((source) => source.source_ref).join(', ')}`, 'TEACHING_D08_REQUIRED_SOURCE_UNMAPPED');
    for (const source of requiredSources) {
      const ref = String(source.source_ref);
      const treatment = coverageByRef.get(ref);
      const account = (auditOutput.source_accounting || []).find((item) => String(item.source_ref) === ref);
      const allowed = new Set((account?.learning_unit_ids || []).map(String));
      if (!allowed.size) failure(`Validated Curriculum Audit lacks Learning Unit mapping for required source ${ref}.`, 'TEACHING_D08_AUDIT_SOURCE_MAPPING_REQUIRED');
      if (!treatment.planned_treatment_refs.length || treatment.planned_treatment_refs.some((unitRef) => !allowed.has(unitRef))) {
        failure(`Course Plan treatment for ${ref} is outside validated Curriculum Audit mappings.`, 'TEACHING_D08_SOURCE_TREATMENT_OUT_OF_SCOPE');
      }
    }
    if (String(output.status) === 'ok' && output.review_required === true) failure('An ok Course Plan cannot simultaneously require unresolved review.', 'TEACHING_D08_PLAN_STATUS_CONFLICT');
    return { ok: true, value: Object.freeze({ ...output, review_reasons: Object.freeze(reviewReasons) }), plannedUnits, coverageByRef };
  } catch (error) {
    return { ok: false, reason: error.code || error.message };
  }
}

function materializeCoursePlanFromCanonical(proposal, { audit, sourceItems = [], vpkDecisions = [] } = {}) {
  const validated = validateCanonicalCoursePlanProposal(proposal, { audit, sourceItems, vpkDecisions });
  if (!validated.ok) return validated;
  try {
    if (proposal.status !== 'ok' || proposal.review_required === true) failure('Only an ok, review-complete Course Plan proposal may become a durable Course Plan version.', 'TEACHING_D08_PLAN_NOT_COMMIT_READY');
    const auditOutput = audit.audit_output;
    const topics = (auditOutput.topics || []).map((topic, topicIndex) => ({
      id: String(topic.id),
      title: text(topic.title || topic.id, `audit.topic:${topic.id}.title`, 500),
      ordinal: topicIndex,
      subtopics: (topic.subtopics || []).map((sub, subIndex) => ({ id: String(sub.id), title: text(sub.title || sub.id, `audit.subtopic:${sub.id}.title`, 500), ordinal: subIndex })),
    }));
    const latest = latestVpk(vpkDecisions);
    const learningUnits = (auditOutput.learning_units || []).map((unit) => {
      const ref = String(unit.id);
      const treatment = validated.plannedUnits.get(ref);
      const exit = validateExitConditions(unit);
      if (!exit.ok) failure(`Learning Unit ${ref} exit conditions failed validation.`, exit.reason);
      const compressed = ['teach_compressed','validated_prior_knowledge_no_initial_instruction'].includes(treatment.initial_instruction_status);
      return {
        id: ref,
        title: text(unit.title || ref, `audit.learning_unit:${ref}.title`, 500),
        topic_id: String(unit.topic_id),
        subtopic_id: unit.subtopic_id == null ? null : String(unit.subtopic_id),
        audit_unit_refs: [ref],
        intended_competence: text(unit.intended_competence, `audit.learning_unit:${ref}.intended_competence`, 4000),
        exit_conditions: exit.value,
        criticality: String(unit.criticality || 'MEDIUM').toUpperCase(),
        foundational: unit.foundational === true || String(unit.criticality || '').toUpperCase() === 'FOUNDATIONAL',
        instructional_load_min_minutes: Number.isInteger(unit.instructional_load_min_minutes) ? unit.instructional_load_min_minutes : 0,
        instructional_load_max_minutes: Number.isInteger(unit.instructional_load_max_minutes) ? unit.instructional_load_max_minutes : Math.max(0, Number(unit.instructional_load_min_minutes) || 0),
        instructional_mode: compressed ? 'VPK_COMPRESSED' : 'STANDARD',
        no_initial_instruction: treatment.initial_instruction_status === 'validated_prior_knowledge_no_initial_instruction',
        later_assessment_basis: compressed && latest.get(`LEARNING_UNIT:${ref}`)?.decision_status === 'VALIDATED_PRIOR_KNOWLEDGE' ? 'VALIDATED_PRIOR_KNOWLEDGE' : null,
        planning_attention: treatment.student_intake_accommodation_notes ? [treatment.student_intake_accommodation_notes] : [],
        plan_treatment: treatment,
      };
    });
    const unitIds = new Set(learningUnits.map((unit) => unit.id));
    const dependencies = (auditOutput.dependencies || []).map((dependency) => ({
      learning_unit_id: String(dependency.learning_unit_id),
      prerequisite_learning_unit_id: String(dependency.prerequisite_learning_unit_id),
      dependency_kind: String(dependency.dependency_kind || 'PREREQUISITE'),
      rationale: dependency.rationale || null,
    })).filter((dependency) => unitIds.has(dependency.learning_unit_id) && unitIds.has(dependency.prerequisite_learning_unit_id));
    const sourceMappings = [];
    const excludedSources = [];
    for (const source of sourceItems) {
      const account = (auditOutput.source_accounting || []).find((item) => String(item.source_ref) === String(source.source_ref));
      if (source.academically_meaningful === true || source.classification === 'ACADEMICALLY_MEANINGFUL') {
        sourceMappings.push({ source_ref: String(source.source_ref), learning_unit_ids: (account?.learning_unit_ids || []).map(String) });
      } else {
        excludedSources.push({ source_ref: String(source.source_ref), reason: `${source.classification || account?.classification || 'NON_REQUIRED'}: ${source.classification_reason || account?.reason || 'not required academic scope'}` });
      }
    }
    const prerequisites = (auditOutput.assumed_prerequisites || []).map((item) => {
      const ref = String(item.prerequisite_ref || item.prerequisite_learning_unit_id || item.id || item.name || '').trim();
      const current = latest.get(`PREREQUISITE:${ref}`);
      return { prerequisite_ref: ref, disclosure: String(item.description || item.rationale || item.reason || ref), validation_status: current?.decision_status === 'VALIDATED_PRIOR_KNOWLEDGE' ? 'VALIDATED_PRIOR_KNOWLEDGE' : 'UNVERIFIED' };
    }).filter((item) => item.prerequisite_ref);
    const normalized = { topics, learning_units: learningUnits, dependencies, source_mappings: sourceMappings, assumed_prerequisites: prerequisites, excluded_sources: excludedSources, planning_summary: String(proposal.student_facing_plan_summary_candidate || 'Reviewed Course Plan based on the validated Curriculum Audit.') };
    const result = validateCoursePlanProposal(normalized, { audit, sourceItems, vpkDecisions });
    if (!result.ok) return result;
    return { ...result, canonicalProposal: validated.value };
  } catch (error) {
    return { ok: false, reason: error.code || error.message };
  }
}

module.exports = { validateCanonicalCoursePlanProposal, materializeCoursePlanFromCanonical };
