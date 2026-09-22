# KIWI AI Orchestrator — Phase 6 VVIP Migration

Phase 6 completes the production migration to the centralized AI Orchestrator.

## VVIP tasks

The five VVIP tasks are:

- `MAIN_CBT`
- `RECKONING_CBT`
- `CBT_COMPLETION`
- `FLASHCARD_GENERATION`
- `IMPORT_IMAGE_EXTRACTION`

All five have a `FLASH` quality floor. None may silently degrade to Flash-Lite.

## Routing

The current VVIP chain is:

```text
gemini-3.8-flash
        ↓
gemini-3.7-flash
        ↓
gemini-3.6-flash
```

For a single request, the orchestrator tries every healthy independent project/key slot for the current model before moving to the next model. When it falls from one model to another, the lower model uses its own project-pool cursor.

The provider model IDs are centralized in `services/ai/model-catalog.js`; feature code does not choose model names.

## Reasoning

- Main CBT: HIGH
- Reckoning CBT: HIGH
- CBT completion/repair: HIGH
- Flashcard generation: HIGH
- Image extraction: MEDIUM

Thinking is translated by the capability adapter and is not supplied by feature code.

## CBT generation affinity

CBT generation, split theory/calculation generation, and completion/repair calls share the same opaque generation-group ID derived from the exam session.

Affinity is monotonic. If one part of an exam falls from 3.8 to 3.7, later completion passes cannot jump back to 3.8. Parallel split calls finishing out of order also cannot upgrade the affinity ceiling after a lower-model fallback has already occurred.

## Reckoning recovery

Reckoning has an additional deterministic emergency exam path.

The deterministic path is only used when:

- AI availability/capacity fails, including model unavailability, quota exhaustion, network/server failures, timeouts, or empty responses; or
- generated output cannot be parsed sufficiently to construct a usable Reckoning exam.

Safety blocks and malformed request/configuration errors are not treated as availability failures and do not trigger model/safety evasion.

If AI output is below the minimum usable threshold, Reckoning attempts deterministic recovery before allowing the generation job to fail. This prevents an AI-provider outage from trapping a learner behind a Reckoning lockout.

## Core feature contracts preserved

Main CBT keeps its scaled output budget and difficulty/custom-balance/broad-coverage prompt system.

CBT completion keeps its separate scaled output budget and explicit no-repeat contract.

Flashcard generation keeps its established 15,000-token output budget while moving model and thinking selection into the orchestrator.

Image extraction preserves multimodal `inlineData` input and MIME type handling.

## Legacy removal

After Phase 6:

```text
Direct geminiModel.generateContent calls: 0
Direct Gemini provider endpoints in index.js: 0
Provider model literals in feature code: 0
thinkingConfig overrides in feature code: 0
modelOverride calls in feature code: 0
Canonical ai.run callsites: 27
```

The legacy Gemini wrapper is no longer a fallback path.

If persistent AI-state initialization fails at startup, the orchestrator may continue with in-memory routing; the startup log explicitly says this rather than claiming that legacy AI remains available.

## Verification

Phase 6 is guarded by dedicated tests that verify:

- exactly five VVIP tasks and their contracts;
- the 3.8 → 3.7 → 3.6 quality floor;
- all configured projects are exhausted on 3.8 before a request falls to 3.7;
- main CBT vs Reckoning task separation;
- generation-group affinity;
- completion output scaling;
- VVIP card generation and multimodal image extraction;
- deterministic Reckoning recovery boundaries;
- complete removal of legacy provider routing from feature code.

Phase 5 is also re-verified after Phase 6 to make sure VVIP migration did not regress any VIP feature.
