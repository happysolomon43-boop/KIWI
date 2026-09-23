# KIWI Living Vine State Architecture

## Current production contract

This document describes the final renderer-facing architecture after the 15-phase KIWI living-vine migration.

The production flow is:

`Ecosystem V2 → TreeState v4 → Vine growth model v3 → PixiJS local vine + mapped website spillover`

The retired procedural SVG tree is not part of the production architecture.

## Canonical TreeState

`services/tree-state.js` builds the only renderer-facing state contract.

Current schema:

`TREE_STATE_SCHEMA_VERSION = 4`

The canonical state exposes:

- `stage`
- `stageLabel`
- `growthPoints`
- `nextStage`
- `growthProgress`
- `overallGrowthProgress`
- `postAncientGrowth`
- `growthInterval`
- `vineStructure`
- `vitality`
- `vitalityBreakdown`
- `vineHealth`
- `knowledgeScore`
- `leaves`
- `fruits`
- `rings`
- `milestones`
- `streak`

Generic renderer aliases are retired and are not emitted:

- `structuralGrowth`
- `visualHealth`
- top-level `health`

Database and older caller input may still provide `tree_health` or `health`; those are accepted only as input normalization and are emitted canonically as `vitality`.

## Permanent biological progression

Growth Points define permanent maturity.

The permanent morphology object is `vineStructure`:

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

Vitality never participates in permanent structural calculations.

At the same Growth Points, a low-Vitality and high-Vitality vine have the same permanent woody structure.

## Reversible biological condition

`vineHealth` describes current reversible condition:

- `leafDensity`
- `leafRetention`
- `leafDroop`
- `leafSaturation`
- `movementStrength`
- `shootVigor`
- `flowerVigor`
- `stress`

These values may rise or fall as Vitality changes.

They may change foliage, bloom and motion, but may not:

- reduce Growth Points,
- retract permanent cordons,
- shrink mature wood,
- lower the earned stage.

## Continuous growth model

The canonical model is:

`services/vine-growth-model.js`

Current version:

`VINE_GROWTH_MODEL_VERSION = 3`

The obsolete `services/tree-growth-model.js` compatibility bridge has been removed.

The eight product milestones remain:

- Seedling
- Sprout
- Sapling
- Young Tree
- Thriving
- Blooming
- Mature
- Ancient

They are milestone labels, not separate visual models.

Continuous maturity interpolates between visual maturity anchors, so crossing a stage boundary does not replace the organism.

## Renderer inputs

The browser renderer consumes canonical TreeState only.

It does not read database-shaped fields such as:

- `tree_health`
- `tree_stage`
- `growth_points`

directly.

Local rendering is handled by the PixiJS living-vine renderer.

Website spillover consumes the same state through the shared browser TreeState channel.

## Shared blueprint

The local organism blueprint is stored in:

`public/tree/vine-blueprint.json`

The backend wrapper:

`services/vine-visual-blueprint.js`

reads that same data.

This keeps backend tests and browser geometry on one topology.

## Website expansion state

The website expansion contract is stored in:

`public/tree/vine-expansion-map.json`

The backend wrapper:

`services/vine-expansion-map.js`

reads the same contract.

Mapped external growth remains fail-closed and is disabled on high-focus routes.

## Performance contract

The Pixi runtime derives an initial device quality tier and may adapt downward or recover upward within the device's original ceiling.

Performance adaptation may change only presentation:

- foliage count,
- flower density,
- idle motion,
- external decoration density,
- ticker FPS,
- geometry refresh cadence.

It may never change academic state or permanent biological state.

## Failure behavior

PixiJS is the sole production living-vine renderer.

If Pixi initialization fails, the renderer gateway mounts a lightweight static accessible fallback.

That fallback:

- is not SVG,
- is not a second biological renderer,
- does not reintroduce generic-tree anatomy,
- does not mutate ecosystem state.

## Invariants

The following are permanent architectural rules:

1. Growth Points create permanent structure.
2. Vitality changes condition, never age.
3. The same canonical TreeState drives every visual surface.
4. Primary vine topology is deterministic.
5. External vines may not intercept interface input.
6. High-focus routes remain vine-free where defined.
7. Renderer quality adaptation is presentation-only.
8. Generic-tree renderer aliases are retired.
