'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const PRODUCTION_PROJECT_REF = 'nqdwifqskxkblgdgeutn';

const MIGRATIONS = Object.freeze([
  'migrations/20260925_teaching_d02_runtime_primitives.sql',
  'migrations/20260925_teaching_d04_kernel_persistence.sql',
  'migrations/20260925_teaching_d04_service_role_rls_hardening.sql',
  'migrations/20260926_teaching_d05_orchestrator_runtime.sql',
  'migrations/20260926_teaching_d05_orchestration_service_rls.sql',
  'migrations/20260927_teaching_d07_course_intake_curriculum_diagnostic.sql',
  'migrations/20260927_teaching_d07_fk_indexes.sql',
  'migrations/20260928_teaching_d08_course_plan_coverage.sql',
  'migrations/20260928_teaching_d08_post_migration_hardening.sql',
  'migrations/20260929_teaching_d09_scheduling.sql',
  'migrations/20260929_teaching_d10_course_lifecycle_requests.sql',
  'migrations/20260929_teaching_d10_fk_lineage_hardening.sql',
  'migrations/20260929_platform_security_rls_hardening.sql',
]);

function requireNonProduction({ connectionString, projectRef }) {
  if (!connectionString) throw new Error('TEACHING_TEST_DATABASE_URL is required.');
  if (!projectRef) throw new Error('TEACHING_TEST_PROJECT_REF is required.');
  if (projectRef === PRODUCTION_PROJECT_REF || connectionString.includes(PRODUCTION_PROJECT_REF)) {
    throw new Error('Teaching integration bootstrap refuses the production KIWI Supabase project.');
  }
  return true;
}

function localSsl(connectionString) {
  const url = new URL(connectionString);
  return ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
    ? false
    : { rejectUnauthorized: false };
}

const FOUNDATION_SQL = String.raw`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.users (
  id text PRIMARY KEY,
  username text,
  email text,
  password_hash text,
  role text DEFAULT 'user',
  telegram_chat_id text,
  telegram_link_token text,
  notification_preferences jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  full_name text DEFAULT '',
  avatar_url text DEFAULT '',
  bio text DEFAULT '',
  is_active boolean DEFAULT true,
  is_guest boolean DEFAULT false,
  guest_expires_at timestamptz,
  last_login_at timestamptz,
  theme text DEFAULT 'dark',
  exam_reminder_days integer DEFAULT 3,
  previous_login_at timestamptz,
  is_blocked boolean DEFAULT false,
  blocked_reason text
);

CREATE TABLE IF NOT EXISTS public.subjects (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  exam_date timestamptz,
  test_date timestamptz,
  color text DEFAULT '#4F46E5',
  icon text DEFAULT '📚',
  status text DEFAULT 'active',
  archived boolean DEFAULT false,
  archived_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.exam_sessions (
  id text PRIMARY KEY,
  user_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id text PRIMARY KEY,
  user_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
`;

async function main() {
  const connectionString = process.env.TEACHING_TEST_DATABASE_URL;
  const projectRef = process.env.TEACHING_TEST_PROJECT_REF;
  requireNonProduction({ connectionString, projectRef });

  if (process.env.TEACHING_TEST_BOOTSTRAP !== '1') {
    throw new Error('Set TEACHING_TEST_BOOTSTRAP=1 to authorize destructive setup of the isolated integration database.');
  }

  const pool = new Pool({
    connectionString,
    ssl: localSsl(connectionString),
    max: 1,
    connectionTimeoutMillis: 10_000,
  });

  try {
    await pool.query(FOUNDATION_SQL);
    console.log('[Teaching integration] base KIWI/Supabase-compatible test foundation ready.');

    for (const relativePath of MIGRATIONS) {
      const absolutePath = path.resolve(__dirname, '..', relativePath);
      const sql = fs.readFileSync(absolutePath, 'utf8');
      await pool.query(sql);
      console.log(`[Teaching integration] applied ${relativePath}`);
    }

    const { rows } = await pool.query(`
      select
        (select count(*)::int
           from information_schema.tables
          where table_schema='public' and table_name like 'teaching_%') as public_teaching_tables,
        (select count(*)::int
           from information_schema.tables
          where table_schema='teaching_preparation') as preparation_tables,
        (select count(*)::int
           from information_schema.tables
          where table_schema='teaching_runtime') as runtime_tables,
        (select count(*)::int
           from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where c.relkind='r'
            and ((n.nspname='public' and c.relname like 'teaching_%')
              or n.nspname in ('teaching_preparation','teaching_protected'))
            and not c.relrowsecurity) as teaching_tables_without_rls,
        (select count(*)::int
           from information_schema.role_table_grants
          where ((table_schema='public' and table_name like 'teaching_%')
              or table_schema in ('teaching_preparation','teaching_protected'))
            and grantee in ('anon','authenticated')
            and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')) as browser_authoritative_dml
    `);

    const summary = rows[0];
    if (summary.teaching_tables_without_rls !== 0) {
      throw new Error(`Teaching integration bootstrap left ${summary.teaching_tables_without_rls} authoritative table(s) without RLS.`);
    }
    if (summary.browser_authoritative_dml !== 0) {
      throw new Error(`Teaching integration bootstrap exposed ${summary.browser_authoritative_dml} authoritative browser DML grant(s).`);
    }

    console.log('[Teaching integration] schema ready', summary);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[Teaching integration] bootstrap failed:', error);
    process.exitCode = 1;
  });
}

module.exports = {
  MIGRATIONS,
  requireNonProduction,
  localSsl,
};
