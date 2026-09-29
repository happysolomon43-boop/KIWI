# D14 migration recovery

Migration `20260929_teaching_d14_classroom_artifacts.sql` is additive. Before rollback, stop D14 writes and export the four D14 tables if their artifacts must be retained. Drop in dependency order: `teaching_class_study_note_versions`, `teaching_teacher_communications`, `teaching_classroom_interactions`, then `teaching_student_notebook_items`. Reverting application code before dropping tables is safe because earlier deliveries do not reference them. Never delete D11 Board, Class, Closure, D12 Response or D13 SKM records during D14 recovery.
