# KIWI Teaching D22 — Teacher Identity & Interaction Style

D22 implements exactly TCH-0462 through TCH-0478 from the frozen KIWI Teaching baseline.

## Authority boundary

D22 owns persistent Teacher Identity presentation state and the resolved Teacher Style Envelope. It does not own pedagogy, academic standards, marks, attendance, scheduling, assessment conditions, integrity outcomes, Course scope or progression. D10 remains the authoritative formal Request owner for Teacher Change and the existing versioned Course Teacher assignment remains the assignment lineage. D22 never creates a second Request or Course-assignment truth.

## Frozen prompt interfaces

D22 pins TPF-08 v1.2 (`b6c65e2f152c5260f822a06348de016eb6cfb61e1b8695dd4f936c014a99fb77`) and TPF-18 v1.0 (`1ea28ec7d84ded6092949bd0656f83450178386d5990077f02d033208feec7d5`). The runtime Teacher Style Envelope contains exactly `teacher_identity_ref`, warmth, directness, formality, expressiveness, humor frequency, encouragement intensity, challenge style, accountability style, conversationality and authoritative familiarity level. D22 does not modify either frozen prompt.

## Identity persistence and continuity

The existing D04 `teaching_teacher_identities` row remains the aggregate root. D22 adds append-only structured profile versions rather than replacing that root or hiding a second current identity in UI state. Existing D10 identities are backfilled to a safe balanced profile. New identities are selected from coherent product-owned profiles using only KIWI defaults, an explicit broad style preference and product presentation policy; Course subject, performance, integrity history, demographics and private Intake content are not personality inputs.

D21 repeat-attempt lineage is the current explicit continuing-Course sequence contract. When a new repeat Course has that authoritative lineage, D22 reuses the prior active Teacher by default and carries forward only authoritative familiarity state. It never treats a matching subject/title as proof of relationship continuity.

## Familiarity and interaction profile

Familiarity is append-only state tied to the authoritative Teacher assignment. It is never inferred from Course age, message count or apparent rapport. Student Interaction Profile remains separate in `teaching_interaction_preferences`; shorter explanations, more examples, filler preference and formatting can change without altering the Teacher profile, pedagogy or standards.

## Teacher Code and contextual realization

All identities share the same Teacher Code: academic honesty, no mark manipulation, no prohibited assessment help, no humiliation, no emotional manipulation, honest self-correction, accommodation respect and no arbitrary punishment. Humor is forced to `none` for failure, integrity, emergency, serious-warning, controlled-assessment and examination registers. Praise requires concrete evidence. Accountability wording communicates a supplied authoritative requirement and next action without inventing penalties.

## Teacher Change and memory truthfulness

The Teacher surface creates a D10 `TEACHER_CHANGE` Request pointing to the replacement identity. Nothing is assigned by the browser or by D22 before the Request is approved/applied. After D10 application, D22 can render a transition that explicitly preserves Course Plan, schedule, attendance, Work, Assessment history, marks and progression. A replacement Teacher may use authoritative Course records but never claims personal memory of Classes or events they did not conduct.

## Model qualification

D22 provides central Teaching Orchestrator request/validation contracts for the registry-bound TPF-18 identity/transition capabilities and TPF-08 interaction capabilities. No provider SDK is called directly. The outside-Class model route remains honestly held unless a qualified D30 intelligence runtime is injected; deterministic identity persistence and Teacher-surface state do not depend on an unqualified model route.

## Acceptance coverage

TCH-0462–TCH-0476 are pinned by the D22 verifier, unit tests and schema tests. TCH-0477 proves two different personalities cannot carry marks/grades/academic decisions. TCH-0478 proves one persistent personality can accompany different subject-owned pedagogy without flattening the pedagogical distinction.
