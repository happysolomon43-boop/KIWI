BEGIN;

-- KIWI Teaching D21 production grant hardening.
-- Supabase production default privileges can grant service_role broad table DML
-- on newly-created public tables. D21 requires append-only/versioned academic
-- truth to remain protected at both the trigger and GRANT layers.

REVOKE UPDATE, DELETE, TRUNCATE ON
  public.teaching_course_attempts,
  public.teaching_progression_policies,
  public.teaching_progression_outcomes,
  public.teaching_progression_pathways,
  public.teaching_progression_pathway_steps,
  public.teaching_semester_gpa_snapshots
FROM service_role;

-- Pathway state is the only mutable D21 carrier. Academic identity/source
-- lineage remains protected by teaching_d21_guard_pathway_identity().
GRANT UPDATE ON public.teaching_progression_pathways TO service_role;

COMMIT;
