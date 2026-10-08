-- Admin-only walkthrough progress for the existing KIWI Classroom.
-- This is NON-ACADEMIC review state: no attendance, grade, D11 session,
-- lesson blueprint or timetable is changed by any walkthrough operation.
CREATE TABLE IF NOT EXISTS teaching_runtime.admin_classroom_walkthroughs (
  admin_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES public.teaching_courses(course_id) ON DELETE CASCADE,
  class_id text NOT NULL REFERENCES public.teaching_classes(class_id) ON DELETE CASCADE,
  schedule_version bigint NOT NULL CHECK (schedule_version > 0),
  review_state text NOT NULL CHECK (review_state IN ('IN_PROGRESS','REVIEWED')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_id,course_id,class_id,schedule_version),
  CONSTRAINT admin_classroom_reviewed_timestamp CHECK (
    (review_state = 'REVIEWED' AND reviewed_at IS NOT NULL)
    OR (review_state = 'IN_PROGRESS' AND reviewed_at IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS admin_classroom_walkthrough_course_idx
  ON teaching_runtime.admin_classroom_walkthroughs(course_id,class_id);
ALTER TABLE teaching_runtime.admin_classroom_walkthroughs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON teaching_runtime.admin_classroom_walkthroughs FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON teaching_runtime.admin_classroom_walkthroughs TO service_role;
COMMENT ON TABLE teaching_runtime.admin_classroom_walkthroughs IS
  'Only admin Classroom walkthrough tracking. REVIEWED is a self-reported preview completion; never a real completed Class, attendance outcome or grade.';
