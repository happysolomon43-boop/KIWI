BEGIN;
-- Supabase production default privileges can be broader than isolated Postgres.
-- D22 version/familiarity truth is append-only: service_role may SELECT/INSERT only.
REVOKE UPDATE,DELETE,TRUNCATE ON TABLE
  public.teaching_teacher_identity_versions,
  public.teaching_teacher_familiarity_states
FROM service_role;
GRANT SELECT,INSERT ON TABLE
  public.teaching_teacher_identity_versions,
  public.teaching_teacher_familiarity_states
TO service_role;
COMMIT;
