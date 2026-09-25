# Teaching non-production Supabase integration-test contract

D01 integration tests must never run against the production KIWI database.

Configure CI/development with:

- `TEACHING_TEST_DATABASE_URL` — connection string for a dedicated non-production Supabase branch/project.
- `TEACHING_TEST_PROJECT_REF` — the matching non-production project reference.

The test harness rejects the production KIWI project ref and rejects connection strings containing the production ref.

No non-production branch is created automatically because Supabase branch creation has billing implications. If the variables are absent, the integration suite reports an explicit skip rather than falling back to production.

D01 integration tests are read-only foundation checks. D04 will add migration/RLS tests when Teaching persistence exists.
