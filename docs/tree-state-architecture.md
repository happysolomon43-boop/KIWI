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


## Continuous growth model

Tree stages are now milestone labels, not visual replacement models.

`services/vine-growth-model.js` now defines the canonical continuous biological growth contract. `services/tree-growth-model.js` remains only as a compatibility bridge for pre-vine consumers. Each milestone has a visual-maturity anchor:

- Seedling: 0.00
- Sprout: 0.12
- Sapling: 0.26
- Young Tree: 0.43
- Thriving: 0.61
- Blooming: 0.75
- Mature: 0.89
- Ancient: 1.00

The anchors intentionally are not `growth_points / 3000`. KIWI's Growth Point intervals widen sharply at higher stages, so a raw linear mapping would compress the early tree into a tiny visual range. Instead, Growth Points determine progress inside the current milestone interval, and that interval is smoothly mapped between the two visual-maturity anchors.

`growthProgress` is the raw 0..1 progress inside the current stage interval.

`overallGrowthProgress` is the continuous 0..1 biological maturity used by the future renderer.

A smootherstep interpolation is used at milestone boundaries, which has zero velocity at both ends of each interval. This means crossing 99 → 100 GP or 299 → 300 GP changes the stage label but does not create a geometry snap.

At Ancient, `overallGrowthProgress` is 1.0. Growth beyond 3000 GP is represented by `postAncientGrowth`, an asymptotic 0..1 signal. This allows subtle long-term thickening and root expansion without inventing a ninth stage.

## Permanent kiwifruit-vine morphology

All structural values are normalized 0..1 and are deterministic functions of continuous maturity.

The canonical `vineStructure` object describes a trained woody kiwifruit climber rather than a freestanding tree:

- `rootEstablishment`
- `baseStemThickness`
- `woodyMaturity`
- `mainStemReach`
- `cordonReach`
- `cordonThickness`
- `lateralShootDevelopment`
- `vineComplexity`
- `foliageCapacity`
- `floweringCapacity`
- `fruitingCapacity`

The model establishes roots and the vertical leader first. Once the leader reaches its support, horizontal cordons extend and thicken. Lateral shoots then multiply along those permanent arms, increasing the usable foliage network. Flowering and fruiting capacity arrive later than the basic woody framework.

No Vitality value participates in these equations. A low-Vitality Ancient vine remains structurally Ancient.

For compatibility with the current SVG renderer, `structuralGrowth` is still emitted as an exact legacy mapping:

- `trunkHeight` → `mainStemReach`
- `trunkThickness` → `baseStemThickness`
- `rootSpread` → `rootEstablishment`
- `branchDevelopment` → `cordonReach`
- `branchComplexity` → `vineComplexity`
- `canopyCapacity` → `foliageCapacity`
- `barkMaturity` → `woodyMaturity`
- `fruitingCapacity` → `fruitingCapacity`

These aliases are transitional and are not the contract the future PixiJS renderer should use.

## Reversible vine health

Vitality is normalized to 0..1 and converted into the canonical `vineHealth` object:

- `leafDensity`
- `leafRetention`
- `leafDroop`
- `leafSaturation`
- `movementStrength`
- `shootVigor`
- `flowerVigor`
- `stress`

These values affect only current presentation. They can recover upward or fall downward as the ecosystem changes.

The legacy `visualHealth` object remains as a compatibility mapping, with `droop`, `saturation`, and `bloomStrength` pointing to the corresponding vine-health values.

A renderer must never use `vineHealth` to shrink the woody base, retract permanent cordons, reduce Growth Points, or move the vine to a younger stage.

## TreeState schema v3

The canonical TreeState schema is now version 3 and the growth model is version 2.

Canonical renderer-facing growth fields are:

- `growthModelVersion`
- `growthProgress`
- `overallGrowthProgress`
- `postAncientGrowth`
- `growthInterval`
- `vineStructure`
- `vineHealth`

Compatibility fields remain:

- `structuralGrowth`
- `visualHealth`
- `health` as an alias of `vitality`

The future PixiJS renderer must consume `vineStructure` and `vineHealth`, not the legacy generic-tree aliases.

The current SVG renderer does not consume the new vine morphology fields yet. This phase changes the biological contract only; it does not install PixiJS or alter visible rendering.
