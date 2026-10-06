-- Restore the plan-local Learning Unit ordering consumed by the D11 Lesson Controller.
-- The original D08 graph persisted Topic/Subtopic ordinals but omitted the flattened
-- Learning Unit sequence expected by classroom planning.

alter table public.teaching_learning_units
  add column if not exists sequence_no integer;

with ranked as (
  select
    u.learning_unit_id,
    row_number() over (
      partition by u.course_plan_id
      order by
        coalesce(t.ordinal, 2147483647),
        coalesce(st.ordinal, 2147483647),
        u.created_at,
        u.learning_unit_id
    ) - 1 as sequence_no
  from public.teaching_learning_units u
  left join public.teaching_topics t
    on t.topic_id = u.topic_id
   and t.student_id = u.student_id
  left join public.teaching_subtopics st
    on st.subtopic_id = u.subtopic_id
   and st.student_id = u.student_id
)
update public.teaching_learning_units u
set sequence_no = ranked.sequence_no
from ranked
where ranked.learning_unit_id = u.learning_unit_id
  and u.sequence_no is null;

create index if not exists teaching_learning_units_plan_sequence_idx
  on public.teaching_learning_units(student_id, course_plan_id, sequence_no, learning_unit_id);

comment on column public.teaching_learning_units.sequence_no is
  'Zero-based stable Learning Unit order within a Course Plan; authored by D08 and consumed by D11 lesson planning.';