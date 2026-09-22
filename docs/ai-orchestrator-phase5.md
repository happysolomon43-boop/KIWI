# KIWI AI Orchestrator — Phase 5 VIP Migration

Phase 5 moves all VIP-class AI features from the legacy Gemini wrapper to live orchestrator routing.

## Live VIP tasks

- STUDY_TASK_GENERATION
- CONCEPT_CLUSTERING
- WEEKLY_CHRONICLE
- WEEKLY_PERSONA
- WEEKLY_ANCHOR
- MORNING_BRIEF
- DAILY_INVITATIONS
- BUBBLE_ADVISORY
- PRESSURE_EXPLANATION
- DEEP_AUDIT
- QUICK_QUESTIONS
- EXAM_DEBRIEF
- LIVING_PERSONA
- RECKONING_DEBRIEF
- LIVING_ACHIEVEMENTS

EXAM_DEBRIEF has two application callsites but one canonical task policy.

## Routing

VIP uses the centralized stable Flash policy:

```text
gemini-3.7-flash
        ↓
gemini-3.6-flash
        ↓
gemini-3.5-flash
```

Tasks whose registry explicitly permits degradation can continue to the Flash-Lite chain.

Task-specific output budgets remain feature inputs where needed (for example Quick Questions and the compact background Exam Debrief), while model choice, reasoning, timeout, project/key rotation, quota handling, retries, and fallback remain centralized.

## Migration status

After this phase:

```text
Legacy Gemini callsites:       4
Live orchestrator callsites:  23
```

The four remaining direct legacy callsites are VVIP generation paths:

- shared MAIN_CBT / RECKONING_CBT generator
- CBT_COMPLETION
- FLASHCARD_GENERATION
- IMPORT_IMAGE_EXTRACTION

Those remain shadow-observed until the dedicated VVIP migration phase.
