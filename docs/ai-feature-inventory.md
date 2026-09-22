# KIWI AI Feature Inventory — Phase 1

This document freezes the accepted AI-feature inventory before the Gemini integration is migrated to the KIWI AI Orchestrator.

## Baseline

- Current backend: `index.js`
- Direct legacy calls to `geminiModel.generateContent(...)`: **27**
- Provider routing remains unchanged in Phase 1.
- The canonical registry lives in `services/ai/task-registry.js`.
- Model IDs, key selection, retries and provider-specific thinking configuration are intentionally **not** part of the task registry.

Two details explain why the canonical registry also contains 27 task IDs:
1. The two existing Exam Debrief call sites become one canonical `EXAM_DEBRIEF` task.
2. Reckoning generation currently shares the CBT generator, but is intentionally split into its own canonical `RECKONING_CBT` task because it requires a separate fail-safe and routing contract.

## Canonical tasks

| Canonical task | Legacy source / purpose | Class | Reasoning | Quality floor |
|---|---|---|---|---|
| `MAIN_CBT` | `generateCBTQuestions` for normal exams | VVIP | HIGH | FLASH |
| `RECKONING_CBT` | `generateCBTQuestions` when invoked for Reckoning | VVIP | HIGH | FLASH |
| `CBT_COMPLETION` | `generateCBTCompletionQuestions` | VVIP | HIGH | FLASH |
| `FLASHCARD_GENERATION` | `generateFlashcards` | VVIP | HIGH | FLASH |
| `IMPORT_IMAGE_EXTRACTION` | `extractFromImage` | VVIP | MEDIUM | FLASH |
| `QUICK_QUESTIONS` | card quick-question route | VIP | MEDIUM | FLASH |
| `STUDY_TASK_GENERATION` | `generateTasksWithGemini` | VIP | MEDIUM | FLASH_LITE |
| `CONCEPT_CLUSTERING` | `generateConceptClusters` | VIP | MEDIUM | FLASH |
| `WEEKLY_CHRONICLE` | weekly Chronicle narrative | VIP | MEDIUM | FLASH |
| `WEEKLY_ANCHOR` | weekly focus anchor | VIP | MEDIUM | FLASH_LITE |
| `MORNING_BRIEF` | daily morning guide | VIP | LOW | FLASH_LITE |
| `DAILY_INVITATIONS` | daily invitation generation | VIP | MEDIUM | FLASH_LITE |
| `BUBBLE_ADVISORY` | `generateBubbleAdvisory` | VIP | MEDIUM | FLASH |
| `PRESSURE_EXPLANATION` | `getPressureExplanation` | VIP | MEDIUM | FLASH_LITE |
| `DEEP_AUDIT` | `generateDeepAudit` | VIP | HIGH | FLASH |
| `EXAM_DEBRIEF` | background + GET debrief paths | VIP | MEDIUM | FLASH_LITE |
| `RECKONING_DEBRIEF` | Reckoning submission debrief | VIP | MEDIUM | FLASH_LITE |
| `LIVING_PERSONA` | `generateLivingPersona` | VIP | MEDIUM | FLASH |
| `WEEKLY_PERSONA` | weekly persona classification | VIP | LOW | FLASH_LITE |
| `LIVING_ACHIEVEMENTS` | `buildLivingAchievements` | VIP | MEDIUM | FLASH |
| `CARD_EXPLANATION` | `summarizeCard` | IP | MINIMAL | FLASH_LITE |
| `RECLASSIFICATION_ALERT` | `triggerReclassificationAlert` | IP | MINIMAL | FLASH_LITE |
| `MASTERY_MOMENT` | `generateMasteryMoment` | IP | MINIMAL | FLASH_LITE |
| `ZONE_DESCRIPTION` | `generateZoneDescription` | IP | LOW | FLASH_LITE |
| `HIDDEN_DISCOVERY` | `generateHiddenDiscovery` | IP | LOW | FLASH_LITE |
| `RETURN_GREETING` | `getReturnGreeting` | IP | MINIMAL | FLASH_LITE |
| `CHRONICLE_ARTIFACT` | `generateChronicleArtifact` | IP | MINIMAL | FLASH_LITE |

## Phase 1 invariants

Phase 1 must not alter production AI behavior. Tests therefore lock the current legacy assumptions that matter during migration:

- exactly 27 direct Gemini calls currently exist;
- the legacy provider transport is centralized around one Google Generative Language endpoint;
- CBT and CBT completion currently use high thinking and long timeouts;
- custom theory/calculation split generation and ratio checks remain present;
- flashcard generation currently uses high thinking and its existing long timeout;
- card explanation remains a fast/minimal-thinking path;
- the existing thought-part filtering behavior remains present.

These tests are intentionally transitional. They will be replaced by orchestrator behavioral tests as each legacy call site migrates.

## Architecture rule for later phases

A feature will eventually call only:

```js
await ai.run('TASK_ID', input);
```

Feature code must not choose a provider model, API key, fallback model, provider-specific thinking configuration, quota policy or retry algorithm.
