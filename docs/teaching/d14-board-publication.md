# D14 authoritative Board publication — live-class correction

## Defect and confirmed incident

In the October 9 GST live Class, `teaching_teacher_communications` contained two published, valid instructional messages while the session had zero `teaching_board_scenes` and zero `teaching_board_items`. D14 published a Board scene only when `visualService.prepare()` produced visual blocks. A normal `ANSWER_NOW` turn with `visualRequest=null` therefore produced speech without a Board. D11 had already supplied a current Lesson Blueprint, so the bug was D14 publication, not a reason to regenerate PPL work.

## General rules

1. D14's existing authoritative Teacher-message transaction is the single publication owner for both the spoken explanation and Board items. The transaction already checks the Course/Class/approved timetable, current Course Plan and Blueprint, the Controller version and instructional mode, and uses the Teacher-turn idempotency key.
2. A normal lesson AI proposal can include **optional bounded Board notation** (`boardBlocks`): at most four independently readable `text`, `equation`, `worked_solution`, or `comparison` blocks. Each block passes D14's existing Board validation. Invalid optional notation is discarded rather than persisted.
3. When no text or other nonvisual notation is available, the repository adds a `text` Board item containing the **already validated Teacher message**. This is evidence-backed display, not a newly generated explanation. The normal Teacher message remains intact. A successful image/diagram never replaces readable text. Raised-hand `ANSWER_NOW` replies get the same invariant.
4. The existing transaction atomically inserts a published Teacher communication, one ordered Board scene and its validated items, or none of them. Publication and idempotent retries cannot silently strand new Teacher messages without Board content.
5. Do **not** publish in protected activity modes or after Course/Class/Plan/Blueprint/Controller authority changes. Visual security, private asset retrieval, personal Notebook Board references, attendance, grades, PPL validation, and timetable rules remain unchanged.

## Existing published Turns

Already-published Teacher messages should not be re-generated or duplicated to recover their Board. The October 9 active GST session was verified against current Course/approved timetable authority, and its two previously published Teacher messages were restored as two ordered, provenance-linked text Board scenes using a narrowly scoped database transaction. The recovery added no new Teacher communications or academic progress. Normal subsequent reads project these persisted scenes through the existing D14 Board endpoint, including in mobile UI.

## Verification

The D14 Board regression covers multiple Courses, optional and malformed model notation, text fallback without a visual provider, separate equation/text blocks, atomic publication, idempotent retries and cancellation/restricted-state fences. Teaching D14, D11, D12, D05, D28 and integration workflows remain the merge gates. Real provider behavior and live client presentation are separate operational verification from unit or CI success.
