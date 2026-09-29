# D09 Migration Recovery

Migration: 20260929_teaching_d09_scheduling.sql

The migration is additive. It adds teaching_semesters.state_version and D09 Scheduler tables. It does not rewrite Course Plans, Coverage, Classes, PPL artifacts or D06 policy.

Before any D09 row exists, recovery may drop D09 tables in reverse dependency order, drop the D09 timetable guard function/trigger, and remove teaching_semesters.state_version.

After any D09 timetable, feasibility, schedule-debt, schedule-profile, availability, block, deadline or reserve record exists, rollback by deleting history is prohibited. Use a forward corrective migration. Preserve immutable timetable/debt/feasibility history and existing PPL input-bundle lineage.

Never weaken RLS, grant browser mutation, delete required Learning Units/Coverage to make a timetable fit, rewrite an APPROVED timetable into a proposal, or fabricate SKM/Attendance truth during recovery.
