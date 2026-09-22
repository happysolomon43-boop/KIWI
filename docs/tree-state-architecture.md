# KIWI Tree State Audit and Canonical Contract

## Scope

This audit covers the existing KIWI tree data path before the PixiJS renderer is introduced. The goal is to preserve ecosystem behavior, remove state-shape duplication, and give the future renderer one stable contract.

## Existing sources of truth

The persistent ecosystem state lives in `user_stats`:

- `growth_points` is permanent progression.
- `tree_stage` is permanent maturity, stages 1 through 8.
- `tree_health` is the persisted current Vitality value, 0 through 100.
- `current_streak` is current streak context.
- `streak_milestones_earned` preserves milestone history.

Fruit is stored separately in subject-level statistics and is summed for the global tree. Global Knowledge Score is computed from card knowledge and is currently used as a canopy-density hint.

## Growth is already permanent

`ecosystem_v2.js` awards Growth Points from first-time card stage milestones. The current thresholds are:

- Stage 1 — SEEDLING: 0
- Stage 2 — SPROUT: 25
- Stage 3 — SAPLING: 100
- Stage 4 — YOUNG TREE: 300
- Stage 5 — THRIVING: 700
- Stage 6 — BLOOMING: 1200
- Stage 7 — MATURE: 2000
- Stage 8 — ANCIENT: 3000

Tree stage updates use the maximum of the existing persisted stage and the stage earned from Growth Points, so the tree cannot shrink back to a younger maturity stage when current performance declines.

## Vitality is reversible

Vitality is recomputed from current ecosystem conditions and persisted into `tree_health`.

The current formula is:

- 40% memory condition from card states
- 25% seven-day consistency
- 20% calmness, which is the inverse of average Brain pressure
- 15% recent session quality

This distinction is important for PixiJS: maturity should control the permanent physical size/structure of the tree, while Vitality should control its current health and presentation.

## Current renderer

The browser currently uses the `KiwiTree` SVG class inside `index.html`. It procedurally draws roots, trunk, branches, leaf clusters, fruit, rings, glow and particles.

The renderer consumes the legacy flat fields:

`stage`, `health`, `leaves`, `fruits`, `rings`, and `milestones`.

Stages 6–8 currently reuse the stage-5 base tree geometry and add canopy density/crown treatment. Leaf density is also influenced by global KS.

## Audit findings

The underlying ecosystem math is substantially more coherent than the rendering adapter layer.

Before this change, Dashboard and Biome independently rebuilt their own tree payloads. They duplicated stage-label arrays, leaf-count derivation, fruit/ring wiring, fallback behavior and health normalization. This creates drift risk: a future fix can update one screen while leaving the other stale.

Dashboard also started a full `buildBiomeData()` call only to obtain a tree-shaped object, then rebuilt/overrode parts of that object again after refreshing Vitality. That is unnecessary work and creates an avoidable race between a fresh Vitality refresh and the parallel biome read.

The frontend also contains demo/fallback tree state shapes. These are compatibility fallbacks, not authoritative ecosystem state.

## Canonical TreeState

`services/tree-state.js` now owns the renderer-facing state contract.

Canonical fields are:

- `schemaVersion`
- `stage`
- `stageLabel`
- `growthPoints`
- `nextStage`
- `vitality`
- `vitalityBreakdown`
- `knowledgeScore`
- `leaves`
- `fruits`
- `rings`
- `milestones`
- `streak`

For compatibility with the existing SVG renderer, `health` remains as an alias of `vitality`. It is not a second source of truth.

The builder clamps malformed input, deduplicates milestones, normalizes next-stage data and derives the existing leaf-density hint consistently from global KS when no explicit leaf count is provided.

## Boundary for the PixiJS phase

PixiJS should consume this TreeState and must not directly read database-shaped values such as `tree_health`, `tree_stage` or `growth_points`.

The renderer may derive visual presentation from the canonical state, but it should never mutate academic progression or redefine Vitality/Growth semantics.
