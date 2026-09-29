-- KIWI Teaching D10 — FK/lineage hardening
-- Forward corrective migration after the base D10 schema. D10 tables are still empty
-- at rollout, so these constraints can be added without rewriting academic history.

CREATE INDEX IF NOT EXISTS teaching_classes_course_idx
  ON public.teaching_classes(course_id);
CREATE INDEX IF NOT EXISTS teaching_classes_source_timetable_version_fk_idx
  ON public.teaching_classes(source_timetable_version_id)
  WHERE source_timetable_version_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS teaching_classes_source_timetable_slot_fk_idx
  ON public.teaching_classes(source_timetable_slot_id)
  WHERE source_timetable_slot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS teaching_classes_activation_fk_idx
  ON public.teaching_classes(activation_id)
  WHERE activation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS teaching_classes_source_request_fk_idx
  ON public.teaching_classes(source_request_id)
  WHERE source_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS teaching_courses_activation_fk_idx
  ON public.teaching_courses(activation_id)
  WHERE activation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS teaching_grading_policy_supersedes_idx
  ON public.teaching_grading_policy_versions(supersedes_grading_policy_id)
  WHERE supersedes_grading_policy_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS teaching_course_teacher_identity_idx
  ON public.teaching_course_teacher_assignments(teacher_identity_id);
CREATE INDEX IF NOT EXISTS teaching_course_teacher_supersedes_idx
  ON public.teaching_course_teacher_assignments(supersedes_teacher_assignment_id)
  WHERE supersedes_teacher_assignment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS teaching_course_teacher_request_idx
  ON public.teaching_course_teacher_assignments(source_request_id)
  WHERE source_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS teaching_course_activation_semester_idx
  ON public.teaching_course_activations(semester_id);
CREATE INDEX IF NOT EXISTS teaching_course_activation_plan_idx
  ON public.teaching_course_activations(course_plan_id);
CREATE INDEX IF NOT EXISTS teaching_course_activation_grading_policy_idx
  ON public.teaching_course_activations(grading_policy_id);
CREATE INDEX IF NOT EXISTS teaching_course_activation_timetable_idx
  ON public.teaching_course_activations(timetable_version_id);
CREATE INDEX IF NOT EXISTS teaching_course_activation_teacher_assignment_idx
  ON public.teaching_course_activations(teacher_assignment_id);
CREATE INDEX IF NOT EXISTS teaching_course_activation_teacher_identity_idx
  ON public.teaching_course_activations(teacher_identity_id);

CREATE INDEX IF NOT EXISTS teaching_course_lifecycle_course_idx
  ON public.teaching_course_lifecycle_history(course_id);
CREATE INDEX IF NOT EXISTS teaching_course_lifecycle_request_idx
  ON public.teaching_course_lifecycle_history(source_request_id)
  WHERE source_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS teaching_course_closure_course_idx
  ON public.teaching_course_closure_records(course_id);
CREATE INDEX IF NOT EXISTS teaching_course_closure_request_idx
  ON public.teaching_course_closure_records(source_request_id)
  WHERE source_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS teaching_course_admission_course_idx
  ON public.teaching_course_admission_decisions(course_id);
CREATE INDEX IF NOT EXISTS teaching_course_admission_policy_idx
  ON public.teaching_course_admission_decisions(policy_version);
CREATE INDEX IF NOT EXISTS teaching_course_admission_request_idx
  ON public.teaching_course_admission_decisions(source_request_id)
  WHERE source_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS teaching_requests_course_fk_idx
  ON public.teaching_requests(course_id)
  WHERE course_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS teaching_request_history_request_fk_idx
  ON public.teaching_request_history(request_id);

ALTER TABLE public.teaching_classes
  ADD CONSTRAINT teaching_classes_source_timetable_version_fkey
  FOREIGN KEY (source_timetable_version_id)
  REFERENCES public.teaching_timetable_versions(timetable_version_id)
  ON DELETE RESTRICT;

ALTER TABLE public.teaching_classes
  ADD CONSTRAINT teaching_classes_source_timetable_slot_fkey
  FOREIGN KEY (source_timetable_slot_id)
  REFERENCES public.teaching_timetable_slots(timetable_slot_id)
  ON DELETE RESTRICT;

ALTER TABLE public.teaching_classes
  ADD CONSTRAINT teaching_classes_activation_id_fkey
  FOREIGN KEY (activation_id)
  REFERENCES public.teaching_course_activations(activation_id)
  ON DELETE RESTRICT;

ALTER TABLE public.teaching_classes
  ADD CONSTRAINT teaching_classes_source_request_id_fkey
  FOREIGN KEY (source_request_id)
  REFERENCES public.teaching_requests(request_id)
  ON DELETE RESTRICT;

ALTER TABLE public.teaching_courses
  ADD CONSTRAINT teaching_courses_activation_id_fkey
  FOREIGN KEY (activation_id)
  REFERENCES public.teaching_course_activations(activation_id)
  ON DELETE RESTRICT;

ALTER TABLE public.teaching_course_teacher_assignments
  ADD CONSTRAINT teaching_course_teacher_assignments_source_request_id_fkey
  FOREIGN KEY (source_request_id)
  REFERENCES public.teaching_requests(request_id)
  ON DELETE RESTRICT;

ALTER TABLE public.teaching_course_lifecycle_history
  ADD CONSTRAINT teaching_course_lifecycle_history_source_request_id_fkey
  FOREIGN KEY (source_request_id)
  REFERENCES public.teaching_requests(request_id)
  ON DELETE RESTRICT;

ALTER TABLE public.teaching_course_closure_records
  ADD CONSTRAINT teaching_course_closure_records_source_request_id_fkey
  FOREIGN KEY (source_request_id)
  REFERENCES public.teaching_requests(request_id)
  ON DELETE RESTRICT;

ALTER TABLE public.teaching_course_admission_decisions
  ADD CONSTRAINT teaching_course_admission_decisions_source_request_id_fkey
  FOREIGN KEY (source_request_id)
  REFERENCES public.teaching_requests(request_id)
  ON DELETE RESTRICT;
