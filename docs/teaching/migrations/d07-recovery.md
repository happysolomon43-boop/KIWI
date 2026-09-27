# D07 migration recovery

Migrations: `20260927_teaching_d07_course_intake_curriculum_diagnostic.sql` and the forward performance-hardening migration `20260927_teaching_d07_fk_indexes.sql`.

The migration runs in one transaction. Before production application, validate on a non-production branch using D07 integration tests. Rollback before D08 data exists by dropping the three D07 tables, removing the three D07 source constraints and Draft/Semester constraint, dropping `teaching_courses.state_version`, and restoring `teaching_courses.semester_id NOT NULL`. Once Draft courses without Semesters or D07 decisions exist, recovery must preserve/export them and use a forward corrective migration; do not force a fake Semester or delete evidence.
