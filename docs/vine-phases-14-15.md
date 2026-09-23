# KIWI Living Vine — Phases 14–15

## Scope

This is the final delivery for the KIWI living-vine migration.

Included:

- Phase 14 — adaptive performance and device hardening
- Phase 15 — permanent PixiJS cutover and removal of the legacy tree contract

## Phase 14 — adaptive performance

The Pixi runtime now adapts to both initial device capability and sustained frame-budget pressure.

Canonical modules:

- `public/tree/adaptive-performance.mjs`
- `public/tree/runtime-policy.mjs`
- `public/tree/pixi-runtime.mjs`

### Initial quality tier

The initial tier is derived from:

- viewport profile,
- device memory,
- hardware concurrency,
- Save-Data,
- Reduced Motion,
- constrained-device classification.

Available tiers:

- `minimal`
- `low`
- `balanced`
- `high`

Each tier defines:

- render quality scale,
- foliage scale,
- flower scale,
- motion scale,
- maximum FPS,
- whether continuous idle motion is allowed,
- minimum website-geometry refresh interval.

### Sustained frame-budget adaptation

The `FrameBudgetMonitor` observes real ticker frame time.

When sustained overload is detected, quality steps down gradually instead of allowing animation to remain expensive.

When sustained headroom returns, quality may recover only up to the device's original ceiling.

This prevents a low-capability device from later upgrading itself into an inappropriate high tier.

Background-tab and debugger-size discontinuities are not treated as genuine GPU load.

### Local organism adaptation

The local vine renderer consumes runtime quality changes.

Lower tiers reduce:

- foliage density,
- flower density,
- continuous idle sway,
- maximum ticker frequency.

Permanent biological state does not change.

Quality reduction is purely presentational.

### Website spillover adaptation

External website vines are intentionally one tier quieter than the local organism on high-capability devices.

The spillover controller:

- lazy-loads its Pixi renderer only when an eligible route actually has paths,
- releases the renderer after inactive periods,
- throttles DOM geometry refreshes according to the active quality tier,
- adapts motion and decorative density,
- exposes a performance snapshot for diagnostics.

No external Pixi application remains allocated merely because the authenticated shell exists.

### Diagnostics

Local and external renderers expose read-only performance snapshots describing:

- current quality tier,
- frame-budget status,
- effective FPS cap,
- continuous-motion state,
- renderer allocation state,
- current external node count.

These diagnostics do not mutate academic or ecosystem state.

## Phase 15 — final renderer cutover

PixiJS is now the only production living-vine renderer.

`tree-renderer-gateway.mjs` has one production mode:

`pixi`

Requests for legacy or unknown modes normalize to Pixi.

### Legacy SVG retirement

The procedural `KiwiTree` SVG class and its production mounts are removed.

The application no longer contains a hidden SVG migration path capable of reintroducing generic-tree anatomy.

If Pixi initialization fails, the application uses a static accessible fallback:

- no SVG renderer,
- no animation engine,
- no generic-tree model,
- concise semantic description of current maturity and Vitality,
- simple non-interactive trellis/vine placeholder.

The failure fallback exists for graceful degradation only; it is not a second renderer.

## Final canonical state contract

The renderer-facing backend contract is:

`TreeState schema v4`

Canonical biological fields are:

- `vineStructure`
- `vineHealth`
- `vitality`
- continuous growth fields
- fruit/ring/milestone/streak fields

Retired compatibility fields are no longer emitted:

- `structuralGrowth`
- `visualHealth`
- `health` as a renderer alias

Database snake-case input remains accepted where required, but output is vine-native.

## Final growth-model contract

The growth model is:

`VINE_GROWTH_MODEL_VERSION = 3`

It emits only:

- continuous growth position,
- `vineStructure`,
- `vineHealth`.

The obsolete `services/tree-growth-model.js` compatibility bridge is deleted.

Its compatibility-only test is deleted as well.

## Product continuity

The eight existing product milestone labels remain unchanged:

- Seedling
- Sprout
- Sapling
- Young Tree
- Thriving
- Blooming
- Mature
- Ancient

They are product-language milestones only.

The underlying organism remains a trained woody kiwifruit vine and grows continuously between those labels.

## Accessibility

The final Pixi renderer remains:

- non-focusable,
- `aria-hidden` at canvas level,
- pointer-transparent,
- Reduced-Motion aware.

The organism container provides the semantic image description.

The static failure fallback also exposes a concise accessible maturity/Vitality description.

## Deployment boundary

After this delivery there is no planned renderer migration phase remaining.

The expected production architecture is:

`Ecosystem → TreeState v4 → Vine model v3 → Pixi runtime → local living vine + mapped website spillover`

The legacy procedural SVG tree and generic renderer aliases are permanently retired.
