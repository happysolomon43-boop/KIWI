# D15 migration recovery

Migration `20260930_teaching_d15_attendance.sql` is additive and introduces three D15-owned authoritative tables: `teaching_attendance_records`, `teaching_attendance_concerns`, and `teaching_attendance_system_interruptions`.

Before any rollback, stop D15 Attendance writes and durable Attendance due-event processing. Preserve/export all three D15 tables and the related `teaching_academic_audit_log` entries when attendance history must remain recoverable. Because attendance corrections are immutable superseding versions, do not “roll back” a student correction by deleting only the latest ledger row.

Application rollback should occur before schema removal so D09–D14 no longer call D15 seams. Earlier owner data must remain intact: do not delete D09 timetable/schedule-debt records, D10 Requests, D11 Classes/Class Sessions/Closure facts, D12 Responses, D13 SKM records, or D14 Classroom interactions.

If schema removal is explicitly authorized after data preservation, drop D15 objects in dependency-safe order: `teaching_attendance_concerns`, `teaching_attendance_system_interruptions`, then `teaching_attendance_records`. D15 has foreign keys into predecessor owner tables; predecessor tables are not part of this rollback.

If a D15 release is reverted after Attendance recovery debt has been reconciled into D09, retain D09 schedule-debt history. Reconstructing D15 later must reconcile authoritative current attendance facts back through the D09 owner rather than deleting scheduler audit history.

A failed/partial deployment must fail closed: browser roles still receive no authoritative Attendance DML, an unknown/failed system interruption must not be retroactively declared system-protected without trusted evidence, and no attendance record may be converted into Gradebook, SKM, or Assessment Attempt truth during recovery.