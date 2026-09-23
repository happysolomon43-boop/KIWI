# KIWI Living Vine Renderer — Phases 8–10

## Scope

This document describes the first production PixiJS organism renderer for KIWI.

Included:

- Phase 8 — permanent local vine structure
- Phase 9 — foliage and Vitality behavior
- Phase 10 — flowers and fruit

Explicitly excluded:

- Phase 11 website-spillover rendering
- page-level vine overlays
- DOM route-to-route vine routing
- external tendrils outside the local organism container

The renderer is local to the Dashboard and Biome tree surfaces.

## Canonical data flow

The renderer consumes three canonical inputs:

1. `TreeState` from the backend
2. `public/tree/vine-blueprint.json`
3. the Phase 7 PixiJS runtime

The backend and browser now consume the same blueprint data file.

`services/vine-visual-blueprint.js` is a CommonJS compatibility wrapper over the JSON source.

This removes the risk of the backend tests and browser renderer drifting onto separate copies of the trellis/vine topology.

## Phase 8 — permanent structure

The permanent local organism is rendered by:

`public/tree/kiwi-vine-renderer.mjs`

Pure geometry and planning live in:

- `vine-geometry.mjs`
- `vine-render-state.mjs`
- `vine-structure-plan.mjs`

### Continuous segment growth

Each blueprint segment has:

- `unlockAt`
- `completeAt`
- cubic Bézier geometry

The renderer calculates the current segment fraction from continuous biological maturity.

The partial curve is generated with De Casteljau subdivision.

This means a segment at 43% growth is a real 43% subsection of the same permanent Bézier curve rather than a different approximation or a replacement model.

The primary skeleton remains deterministic.

### Permanent support

The trellis is independent from biological state.

It consists of:

- left / center / right posts
- upper support beam
- cordon support beam
- diagonal braces

It is always visually subordinate to the vine.

### Wood development

Reach and thickness are independent.

The main leader, cordons, laterals and secondary shoots use different normalized thickness formulas driven by canonical permanent morphology.

Vitality does not participate in:

- segment reach
- segment topology
- woody thickness
- cordon establishment
- root establishment

Therefore low Vitality cannot make the organism biologically younger.

### Roots and base

Visible root flares are generated from `rootEstablishment` and `baseStemThickness`.

They are deterministic and remain part of permanent maturity.

## Phase 9 — foliage and Vitality

Foliage planning lives in:

`public/tree/vine-foliage-plan.mjs`

### Stable biological nodes

Leaves are not randomly scattered on every render.

Each possible leaf has a stable identity derived from:

- foliage zone
- source vine segment
- candidate index

Its attachment position is deterministic.

When Vitality falls, the renderer changes the condition of those nodes instead of constructing a different canopy.

### Permanent vs reversible inputs

Permanent:

- foliage capacity
- current reached segment topology

Reversible:

- leaf density
- leaf retention
- droop
- saturation
- movement strength
- shoot vigor

### Leaf appearance

The leaf graphic is a broad cordate form intended to read as kiwifruit foliage rather than a generic tree oval.

It includes:

- pointed tip
- rounded shoulders
- shallow basal notch
- central vein
- restrained secondary veins

Leaves are distributed into:

- rear foliage
- mid foliage
- foreground foliage

This produces depth without turning the organism into a flat green cloud.

### Vitality behavior

High Vitality:

- more visible leaf nodes
- stronger retention
- richer green
- less droop
- more subtle movement

Low Vitality:

- fewer retained leaves
- more exposed woody structure
- more downward posture
- muted / stressed color
- reduced movement

The woody skeleton remains identical at the same Growth Points.

### Motion

Leaf motion uses the existing Phase 7 private ticker.

Each leaf receives deterministic:

- phase
- speed
- sway amplitude

Motion is multiplied by canonical `movementStrength`.

Reduced Motion sets effective movement to zero.

Clicking the local organism creates a short-lived sway impulse without changing academic state.

## Phase 10 — flowers and fruit

Reproductive planning lives in:

`public/tree/vine-reproductive-plan.mjs`.

### Reproductive zones

Flowers and fruit can only appear on the reproductive segments declared in the Phase 5 blueprint.

No reproduction is scattered into arbitrary scene coordinates.

Each node must satisfy:

- maturity gate
- source segment growth gate
- reproductive capacity

### Flowers

Flower visibility depends on both:

- permanent `floweringCapacity`
- reversible `flowerVigor`

Therefore flowers are a current biological expression of a mature healthy vine.

They can weaken or disappear when Vitality is poor.

### Fruit

Fruit is treated differently from flowers.

The source count comes from canonical `TreeState.fruits`.

Vitality does not delete earned fruit.

The renderer limits visible clusters by profile:

- desktop: 12
- tablet: 9
- mobile: 6

If the ecosystem fruit count is larger than the visible cluster cap, clusters visually compress the total with multiple fruit per cluster.

This avoids drawing hundreds of individual kiwi fruit while preserving the sense of abundance.

### Fruit placement

Fruit:

- hangs beneath valid reproductive laterals
- has a stem connection to the vine
- uses stable candidate ordering
- gains new clusters without relocating existing clusters
- sits below foreground foliage in scene depth

## Responsive behavior

The renderer chooses its composition profile from the live viewport width on every render.

This allows responsive profile changes after:

- window resize
- device rotation
- responsive layout transition

Mobile suppresses the two farthest outer laterals and uses reduced foliage/fruit density.

Website spillover remains disabled.

## Pixi scene architecture

Phase 7 layer order remains:

1. backdrop
2. rear foliage
3. trellis rear
4. woody vine
5. foliage
6. flowers
7. fruit
8. foreground foliage
9. ambient

The renderer uses persistent pools for:

- segment Graphics
- leaf Containers
- flower Containers
- fruit Containers

State changes update existing nodes instead of rebuilding the entire Pixi application.

## State transitions

`updateState(nextState, animate)` interpolates:

- overall biological maturity
- permanent morphology
- Vitality
- vine health
- fruit signal

Growth and recovery therefore move continuously between states.

Reduced Motion bypasses animated interpolation and renders the target state immediately.

## Dashboard and Biome activation

Dashboard and Biome now mount through:

`mountKiwiLivingTree()`

The browser dynamically loads:

`/tree/tree-renderer-gateway.mjs`

PixiJS is the default local organism renderer.

If any of these fail:

- module load
- Pixi initialization
- blueprint load
- renderer initialization

the gateway mounts the original SVG `KiwiTree`.

The user is never left with an empty tree.

The landing-page marketing tree remains legacy SVG for now because it does not consume canonical ecosystem state.

## Lifecycle

The Pixi runtime now automatically destroys itself when its route container leaves the DOM.

The renderer also owns:

- ResizeObserver cleanup
- ticker subscription cleanup
- click-listener cleanup
- scene-pool cleanup

This prevents hidden route instances from continuing to consume GPU/CPU after navigation.

## Accessibility

The Pixi canvas remains:

- `aria-hidden`
- non-focusable
- `pointer-events: none`

The containing organism receives a concise image description when interactive.

`prefers-reduced-motion` is respected.

## Regression guarantees

Tests cover:

- shared blueprint parity between backend and browser
- cubic partial-growth correctness
- permanent structural monotonicity
- Vitality inability to de-age wood
- deterministic foliage identity
- lower foliage density on mobile
- health-sensitive flowers
- Vitality-independent earned fruit retention
- fruit cluster caps
- reproductive maturity gating
- Dashboard/Biome gateway integration
- explicit absence of Phase 11 spillover logic

CI also syntax-checks every `.mjs` file in `public/tree`.

## Phase boundary

After this delivery, local organism rendering is complete through fruit.

Phase 11 is intentionally untouched.

No page-level vine route, expansion overlay, Dashboard rail tendril or Brain spillover is rendered by this code.
