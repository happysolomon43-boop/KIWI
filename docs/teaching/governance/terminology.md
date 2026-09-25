# Canonical Teaching Terminology

These definitions preserve Blueprint product meaning. Internal code identifiers may be more specific, but internal enum names never automatically become student-facing labels.

- **Teaching** — the overall KIWI feature/system for structured AI-led Courses. It is broader than the AI Teacher.
- **Semester** — a grouping of Teaching Courses for shared scheduling, workload coordination, reporting and GPA where applicable.
- **Course** — a bounded academic programme built around a KIWI Subject and agreed scope, with Course Plan, timetable, Teacher Identity, Classes, Work, assessments, Gradebook, attendance, evidence, progression rules and an end state.
- **Course Attempt** — the historical academic attempt for a Course. Repeat creates a new linked attempt/equivalent object rather than overwriting the old one; new formal marks reset while useful pedagogical knowledge may carry.
- **Class** — one scheduled live meeting for a Course, with authoritative start/duration, attendance implications and an active session when joined.
- **Lesson** — the instructional plan/content executed within a Class. Scheduling UI normally says Class rather than mixing Class and Lesson.
- **Course Plan** — the student-facing Scheme of Work / approved scope representation, including meaningful curriculum structure, progress and major assessment milestones.
- **Topic** — a visible meaningful curriculum area.
- **Subtopic** — a useful visible subdivision of a Topic.
- **Learning Unit** — the smallest coherent internal knowledge/skill unit that can be taught and independently demonstrated sufficiently for a meaningful learning judgment.
- **Work** — student-facing umbrella for academic items requiring output outside ordinary live teaching.
- **Assignment** — an outside-Class academic task with instructions, deadline, assistance rules, response/submission state and feedback.
- **Homework** — an Assignment type used for purposeful learning outside Class.
- **Classwork** — designated Work completed during Class; it may be graded or ungraded, and graded status must be explicit before the student begins.
- **Assessment** — an intentional academic measurement event with scope, purpose, resource rules, timing, response rules, rubric/marking logic and intended result use.
- **Diagnostic** — a non-grade Assessment used for prior knowledge, prerequisites, readiness, retention or diagnosing difficulty.
- **Test** — a formal assessment normally covering a defined recent curriculum range, narrower than a major cumulative exam.
- **Impromptu Test** — an unannounced governed formal assessment primarily for unprepared retrieval/retention; surprise to the student is not randomness in system governance.
- **Mid-Semester Assessment** — a cumulative checkpoint over legitimately taught/validated material so far.
- **Final Examination** — the strongest normal cumulative terminal assessment, sampling the full eligible Course Plan according to importance and appropriate integration/transfer.
- **Make-Up** — an equivalent replacement assessment for one legitimately missed; not a Resit.
- **Resit** — a new formal attempt after a valid completed assessment/course result fails the required standard and policy permits another attempt; not an ordinary retry.
- **Correction** — learning-oriented repair of prior Work; does not silently erase the original attempt.
- **Remediation** — targeted repair of a relatively narrow weakness; not equivalent to Course failure.
- **Recovery** — broader repair than Remediation where weakness is substantial but full Repeat is not yet necessary.
- **Repeat** — a new Course Attempt after allowed repair pathways are insufficient; secure prior learning may be compressed rather than pretended absent.
- **Results** — Course-level student-facing official academic results with Learning Analysis clearly separated.
- **Record** — historical academic area across Courses/Semesters, not live lesson operation.
- **Request** — a formal proposed change that must be evaluated/decided before authoritative academic state changes.

## Internal labels are not public language

Code may use enums such as `LU_BLOCKED_PREREQ`, controller substates, moderation states, confidence labels or recovery-capacity indicators. Those values are not automatically valid UI copy.

Student-facing communication must translate internal state into understandable academic language without inventing a second truth. Examples include “We need to repair an earlier skill before continuing” or “Marking in progress” rather than raw internal state names.

This rule applies to UI, notifications, AI Teacher wording, summaries and support surfaces.
