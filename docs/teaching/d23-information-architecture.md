# KIWI Teaching D23 — Information Architecture & Global Academic Communication

**Delivery:** D23  
**Scope:** TCH-0479–TCH-0503, TCH-0911  
**Hard predecessor:** accepted D22  
**Persistence:** **no migration**. D23 is a read/composition/presentation delivery and must not create a second owner for schedule, Course scope, Work, marks, learning inference, progression, Requests, Teacher Identity, or Class state.

## Product surface

The primary Teaching navigation is intentionally limited to **Today, Courses, Calendar, Work, Record**. Requests, Archived Courses, and Create Course are secondary destinations. Conditional remediation/resit/recovery/repeat pathways stay contextual and do not become permanent primary navigation.

Desktop uses a persistent local Teaching rail. Narrow/mobile layouts recompose to a five-destination bottom dock. Course-local navigation is **Overview, Course Plan, Work, Results, Teacher**. Course Materials is a secondary Course surface rather than a permanent local-nav destination.

The UI deliberately uses full visual freedom within KIWI coherence: high-contrast dark academic workspace, typography-led hierarchy, calm empty states, strong focus surfaces, restrained status badges, and contextual actions. Visual creativity does not change academic ownership or state semantics.

## Authoritative read model

D23 composes existing accepted owners only:

- D09 Scheduler/Calendar → official Teaching time and Class schedule.
- D08 Course Plan → official Course scope/version and plan update status.
- D10 → Course lifecycle and formal Request truth.
- D14 → Class lifecycle projection, Class Summary, private Study-note publication state.
- D16 → Assignment/Work lifecycle and deadlines.
- D17/D19 → formal Assessment definitions and student-visibility rules. Future impromptu assessments remain hidden before legitimate exposure.
- D20 Gradebook → official marks/results.
- D21 → Progression and formal Semester Record projection.
- D22 → persistent Course Teacher presentation.
- D13 remains the learning-inference owner; D23 does not relabel inference as official marks.

No D23 module issues SQL or stores new academic truth.

## TPF-19 communication boundary

D23 reuses the accepted D14 `assembleStudentFactPack` boundary for student-facing academic communication. Facts retain source owner, truth domain, semantic key, fact class, truth status, student visibility, effective state, provenance, uncertainty and provisionality. Protected content is filtered before presentation.

D23 preserves the distinctions **official/final**, **authoritative provisional**, **learning inference**, **planned**, and **unresolved**. If two facts make incompatible claims about the same semantic field, D23 surfaces a `CONFLICTED_FACTS` state and handoff policy rather than smoothing them into a false single answer.

TPF-19 remains a governed model family whose runtime route is **UNQUALIFIED until D30**. D23 therefore builds the exact Translation Directive/Fact Pack pattern and renders deterministic fact-preserving presentation without pretending that an unqualified model route executed.

## Task accounting

- **TCH-0479:** primary Today/Courses/Calendar/Work/Record navigation.
- **TCH-0480:** responsive desktop rail and mobile bottom navigation shell.
- **TCH-0481:** Today allocation into Now, Needs Action, Next, Later Today, Recently Changed.
- **TCH-0482:** calm Today empty state when nothing meaningful requires attention.
- **TCH-0483:** future impromptu/surprise assessments are not previewed.
- **TCH-0484:** restrained active Course list with Teacher/current topic/next event.
- **TCH-0485:** Course-local Overview/Course Plan/Work/Results/Teacher navigation.
- **TCH-0486:** Course Overview projection for current topic, next Class, Teacher, phase, important Work, next assessment and warnings.
- **TCH-0487:** Teacher Notes/internal notes are not exposed as a student navigation surface.
- **TCH-0488:** active Course Plan/version and scope-update notices.
- **TCH-0489:** Course Materials secondary surface.
- **TCH-0490:** Calendar composition for authoritative Classes and announced formal academic events.
- **TCH-0491:** one Class Event detail surface evolves before/during/after the Class.
- **TCH-0492:** global Work aggregation with Course-scoped reuse of the same owner.
- **TCH-0493:** Record hierarchy backed by D21/D20 official record truth.
- **TCH-0494:** Request Center remains secondary.
- **TCH-0495:** Archived Courses remain accessible without primary-workspace clutter.
- **TCH-0496:** Create Course entry reuses existing KIWI Subject → Teaching Course creation pipeline.
- **TCH-0497:** purposeful empty states for Today, Courses, Work, Record, Requests and Study surfaces.
- **TCH-0498:** reschedule/extension/Teacher-change/progression actions are contextual rather than permanent menus.
- **TCH-0499:** TPF-19 Fact Pack/Translation Directive pattern preserves final/provisional/inferred/planned/unresolved/system-failure semantics and refuses conflict smoothing.
- **TCH-0500:** stable deep-link mapping from notifications to authoritative Teaching objects/surfaces.
- **TCH-0501:** remediation/resit/recovery/repeat remain conditional pathways.
- **TCH-0502:** navigation audit is encoded in D23 unit/verifier coverage.
- **TCH-0503:** anti-clutter audit prevents internal engines from becoming user menus.
- **TCH-0911:** Calendar is the sole Teaching timetable, and Teaching Study exposes one Course/Class-filterable Study Pack collection while card selection/creation remains outside D23.

## Safety and authority invariants

- Browser/UI state is never academic truth.
- D23 does not mutate Course Plan, Calendar, Work, Gradebook, Progression, Requests, Teacher Identity or Class state.
- Unqualified TPF-19 routing is not treated as production-qualified.
- No hidden Teacher Notes, chain-of-thought, assessment blueprint, integrity signal, answer key or other protected material is surfaced.
- An empty surface is preferable to invented status.
- A partial predecessor read failure is surfaced as unavailable information rather than filled with fabricated values.

## Verification

D23 adds focused contract/service/UI unit tests, a canonical verifier, predecessor verifier chaining, full Teaching unit regressions and web-build CI. Because D23 creates no persistence, there is no D23 schema migration or rollback script; existing integration schema coverage remains predecessor-owned.
