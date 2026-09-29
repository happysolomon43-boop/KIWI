-- KIWI platform security hardening.
-- Closes all currently reported Supabase RLS lints without introducing browser
-- authority. The backend uses a direct PostgreSQL DATABASE_URL connection.
-- Existing RLS-enabled/no-policy tables are already default-deny to browser
-- PostgREST roles; this migration makes that denial explicit and revokes grants.
-- Five legacy public tables that had RLS disabled are brought under the same
-- server-authoritative posture.

DO $$
DECLARE
  r record;
BEGIN
  -- Legacy public tables that were exposed to PostgREST without RLS.
  FOR r IN
    SELECT unnest(ARRAY[
      'background_jobs',
      'biome_zones',
      'biome_zone_descriptions',
      'onboarding_state',
      'notifications'
    ]::text[]) AS table_name
  LOOP
    IF to_regclass(format('public.%I', r.table_name)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.table_name);
    END IF;
  END LOOP;

  -- Make every current default-deny RLS table explicit, and remove browser
  -- table privileges as defense in depth. Service/backend database owners with
  -- BYPASSRLS continue to operate through the existing server-side DB layer.
  FOR r IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r'
       AND c.relrowsecurity
       AND n.nspname IN ('public', 'teaching_runtime')
       AND NOT EXISTS (
         SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid
       )
     ORDER BY n.nspname, c.relname
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM anon, authenticated',
      r.schema_name,
      r.table_name
    );

    EXECUTE format(
      'CREATE POLICY kiwi_browser_deny_all ON %I.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
      r.schema_name,
      r.table_name
    );
  END LOOP;
END
$$;
