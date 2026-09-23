# KIWI Vine Expansion Map — Phase 6

## Scope

Phase 6 defines where a mature kiwifruit vine is allowed to leave its local organism and enter the actual KIWI interface.

This phase does not render those vines.

It provides the spatial and behavioral contract that a future page-level renderer must obey.

The canonical map lives in:

`services/vine-expansion-map.js`

The local organism blueprint remains in:

`services/vine-visual-blueprint.js`

## Audit of the current KIWI shell

The authenticated application shell is:

- `#appContainer`
- fixed desktop `#sidebar`
- mobile `.mobile-bar`
- mobile `#bottomNav`
- route-rendered `#mainContent`

Route pages are rendered dynamically into `#mainContent`.

The desktop main surface starts after the fixed 260 px sidebar.

At 768 px and below, the sidebar moves off-canvas, the main surface loses its left margin, the mobile bar appears, and the bottom navigation becomes persistent.

At 1024 px and below, Dashboard becomes a one-column layout and the right column moves above the left column.

Those existing breakpoints are therefore the canonical expansion breakpoints as well.

## Core rule

External vines never choose arbitrary screen coordinates.

Every path must start from either:

1. a reserved local exit socket from the living-vine blueprint,
2. the end of a previously established path,
3. or a named shell-entry anchor on routes where the local trellis is not visible.

Every target is tied to a real DOM surface.

This ensures the vine follows the product layout when cards move, columns stack, or viewport dimensions change.

## Maturity gates

External spread is intentionally late-life behavior.

- below 0.72 overall maturity: local organism only
- 0.72: first controlled escape becomes possible
- 0.80: nearby section reach
- 0.86: contextual route reach
- 0.92: page-level reach
- 0.97: deepest ecosystem reach

The eight KIWI stages remain labels. These gates use continuous biological maturity.

## Desktop and tablet

Desktop and tablet may render external vines.

The route map still limits each path independently.

External tendrils are deliberately lighter than the local organism:

- maximum thickness about half local structural thickness,
- smaller leaves,
- wider leaf spacing,
- very low flower budgets,
- no fruit,
- reduced motion,
- maximum screen coverage budget of 14%.

This keeps the website readable even when the organism is highly mature.

## Mobile

Website spillover is disabled on mobile in Phase 6.

This matches the Phase 5 local-organism profile, where mobile exit sockets are disabled.

The vine remains fully alive inside its local organism, but does not cross into surrounding mobile UI.

This avoids collisions with:

- the persistent mobile bar,
- bottom navigation,
- narrow text columns,
- touch targets,
- scroll gestures.

A future mobile-specific expansion phase can introduce edge-only routes after dedicated device testing.

## Dashboard

Dashboard is the primary expansion surface because it contains the main local organism in `#tree-card`.

The first route exits the upper-right vine socket and reaches the outside of the Dashboard right column.

At greater maturity, the network may:

- wrap the outside of the streak widget,
- cross the column gutter to the perimeter of `#invitations-card`,
- continue upward toward the perimeter of `.ks-hero`,
- establish a sparse right-side page rail.

The route is deliberately perimeter-based.

Vines must not cross invitation text, dismiss controls, Knowledge Score text, or the tree's own health/status controls.

The Dashboard should eventually feel physically colonized by the user's progress while remaining fully readable.

## Biome

Biome is the second strongest expansion surface.

Its local organism begins at `#biomeTree`.

Left and right exits may descend toward the outer top corners of `#biome-container`.

At higher maturity, sparse continuation tendrils may follow the outer perimeters of the zone grid.

Biome zones are interactive.

Therefore zone paths are perimeter-only and use extra clearance.

The following are explicit forbidden areas:

- pressure controls,
- Mastery Bubble indicators,
- zone tooltips,
- buttons.

No vine may visually bisect a zone's information.

## Brain

Brain does not show the local trellis organism.

A mature ecosystem therefore enters Brain through a shared shell continuation instead of teleporting a second plant into the page.

The first Brain tendril enters from the main page's upper-right shell anchor and reaches the outer edge of `#brain-gauges`.

At very high maturity, a second sparse tendril may enter from the upper-left shell anchor and approach the outer perimeter of the Active Interventions card.

Brain receives less foliage and substantially less motion than Dashboard or Biome.

Pressure rows remain untouched.

Deferred or active Reckoning cards are forbidden regions.

## Study

Study deliberately receives the most conservative treatment.

### Study setup

At very high maturity, desktop Study setup may show one thin, nearly static tendril along the outside of the setup card.

It must never cross:

- subject selection,
- filter chips,
- the Start Studying button.

### Active study session

When `#studyLayout` or `#studyArena` exists, all external vine expansion is suppressed.

This keeps the flashcard, Focus Seed, timer, navigation controls and quick-question overlays distraction-free.

The user's ecosystem can still react after the session completes; it simply does not animate through the active learning surface.

## Exams and Reckoning

External vines are disabled for:

- `exam`
- `exam-config`
- active Reckoning overlays
- exam-generation overlays

These surfaces are high-focus or high-consequence interactions.

Decorative progression must never compete with them.

## Mastery goals

The current router does not expose a standalone Goals or Mastery Bubble route.

Mastery Bubble goal UI currently appears through:

- Biome zone indicators,
- the Bubble detail overlay,
- onboarding/creation prompts attached to card-generation flows.

Phase 6 does not invent a route that does not exist.

Bubble indicators are protected interactive regions within Biome.

When `#bubblePanelOverlay` is open, external vines are globally suspended.

If KIWI later gains a dedicated Goals route, it should receive its own explicit map version rather than inheriting a generic fallback.

## Global suspension surfaces

External vines must disappear or pause whenever any focus overlay is active.

Current suspension selectors include:

- Reckoning overlay,
- Reckoning exam-generation overlay,
- authentication overlay,
- Mastery Bubble detail overlay,
- Quick Questions overlay,
- generic modal overlays,
- tour exit UI,
- an active guided tour.

The future controller should also accept application-state suspension flags, so it does not depend solely on DOM detection.

## Navigation surfaces are forbidden

The vine never enters:

- desktop sidebar navigation,
- mobile bar,
- bottom navigation,
- toast layer,
- persistent AI-generation banner.

A mature vine may visually approach the main-content boundary, but it cannot use navigation controls as trellis support.

## Pointer and z-order rules

External vines must always use `pointer-events: none`.

They are visual only.

They cannot become click targets and cannot intercept:

- buttons,
- swipes,
- scrolling,
- forms,
- card gestures.

The preferred layer is above passive card surfaces but below important content.

Where a renderer cannot guarantee that stacking relationship, it must place the vine behind the entire target surface rather than on top of its content.

## Deterministic path network

Path order matters.

A continuation path may reference the end of an earlier path.

The controller must never activate a continuation whose source path was not successfully resolved.

This prevents disconnected vine fragments from appearing in the interface.

Path geometry may bend around current layout rectangles, but path identity and target selection remain deterministic.

## Unmapped routes

Phase 6 intentionally leaves these routes unmapped:

- Library
- Chronicle / Living Profile
- Progress
- Community
- Marketplace

They are not automatically enabled.

The correct behavior is no external vine until a dedicated route map is designed and visually verified.

Settings, Admin, Landing, Onboarding, Card Browser and card generation remain explicitly disabled.

## Next renderer responsibilities

A future expansion controller must:

1. read the current route and canonical TreeState,
2. derive desktop/tablet/mobile profile,
3. check global suspension conditions,
4. resolve required DOM surfaces,
5. filter paths by continuous maturity,
6. resolve source and target coordinates,
7. route curves only through safe corridors,
8. maintain clearance from forbidden rectangles,
9. recompute on resize and route render,
10. render with pointer events disabled,
11. pause or remove routes when a focus overlay opens,
12. never mutate academic state.

Phase 6 ends at this contract. No external vine is rendered yet.
