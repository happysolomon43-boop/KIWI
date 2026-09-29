-- KIWI Teaching D11 — foreign-key lineage/index hardening
-- Forward-only performance hardening after the base D11 additive migration.

CREATE INDEX IF NOT EXISTS teaching_class_closure_facts_course_fk_idx
  ON public.teaching_class_closure_facts(course_id);

CREATE INDEX IF NOT EXISTS teaching_class_sessions_class_fk_idx
  ON public.teaching_class_sessions(class_id);
CREATE INDEX IF NOT EXISTS teaching_class_sessions_course_fk_idx
  ON public.teaching_class_sessions(course_id);
CREATE INDEX IF NOT EXISTS teaching_class_sessions_plan_fk_idx
  ON public.teaching_class_sessions(course_plan_id);
CREATE INDEX IF NOT EXISTS teaching_class_sessions_timetable_fk_idx
  ON public.teaching_class_sessions(source_timetable_version_id);
CREATE INDEX IF NOT EXISTS teaching_class_sessions_blueprint_fk_idx
  ON public.teaching_class_sessions(lesson_blueprint_id);

CREATE INDEX IF NOT EXISTS teaching_class_summaries_class_fk_idx
  ON public.teaching_class_summaries(class_id);

CREATE INDEX IF NOT EXISTS teaching_lesson_blueprints_plan_fk_idx
  ON public.teaching_lesson_blueprints(course_plan_id);
CREATE INDEX IF NOT EXISTS teaching_lesson_blueprints_supersedes_fk_idx
  ON public.teaching_lesson_blueprints(supersedes_lesson_blueprint_id);
CREATE INDEX IF NOT EXISTS teaching_lesson_blueprints_timetable_fk_idx
  ON public.teaching_lesson_blueprints(source_timetable_version_id);

CREATE INDEX IF NOT EXISTS teaching_post_class_teacher_notes_class_fk_idx
  ON public.teaching_post_class_teacher_notes(class_id);
CREATE INDEX IF NOT EXISTS teaching_post_class_teacher_notes_course_fk_idx
  ON public.teaching_post_class_teacher_notes(course_id);
