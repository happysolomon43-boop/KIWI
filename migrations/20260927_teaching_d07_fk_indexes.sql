-- KIWI Teaching D07 — foreign-key index hardening
BEGIN;

CREATE INDEX teaching_curriculum_audits_student_idx
  ON public.teaching_curriculum_audits(student_id);
CREATE INDEX teaching_diagnostic_plans_student_idx
  ON public.teaching_diagnostic_plans(student_id);
CREATE INDEX teaching_diagnostic_plans_audit_idx
  ON public.teaching_diagnostic_plans(curriculum_audit_id)
  WHERE curriculum_audit_id IS NOT NULL;
CREATE INDEX teaching_vpk_course_idx
  ON public.teaching_validated_prior_knowledge_decisions(course_id);
CREATE INDEX teaching_vpk_supersedes_idx
  ON public.teaching_validated_prior_knowledge_decisions(supersedes_vpk_decision_id)
  WHERE supersedes_vpk_decision_id IS NOT NULL;

COMMIT;
