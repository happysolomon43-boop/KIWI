> **Historical phase note:** This document records Phases 11–13. Phase 14 performance hardening and Phase 15 final Pixi cutover are documented in `docs/vine-phases-14-15.md`.

# KIWI Living Vine — Phases 11–13

## Scope

This delivery completes the first website-integrated form of the living KIWI vine.

Included:

- Phase 11 — controlled escape from the local vine container
- Phase 12 — progressive website colonization
- Phase 13 — ecosystem-aware reactions and route behavior

Explicitly excluded:

- Phase 14 performance instrumentation and final mobile/performance hardening
- arbitrary freeform vines outside the approved Phase 6 route map
- website spillover on mobile
- fruit on external website tendrils
- spillover on unmapped or high-focus routes

## Shared expansion contract

The browser and backend now consume one canonical route contract:

`public/tree/vine-expansion-map.json`

`services/vine-expansion-map.js` is the server/CommonJS wrapper over that file.

The contract remains fail-closed.

Only explicitly mapped routes may render website vines:

- Dashboard
- Biome
- Brain
- Study setup

The following remain disabled:

- CBT exam
- exam configuration
- card browser
- generation surfaces
- Settings
- Admin
- Landing
- Onboarding

Library, Chronicle, Progress, Community and Marketplace remain unmapped.

## Phase 11 — local vine escape

Dashboard and Biome use the real local Pixi organism as the physical source of website spillover.

The expansion contract identifies:

- `#dashboardTree` as the Dashboard local scene
- `#biomeTree` as the Biome local scene

The controller converts the Phase 5 normalized exit sockets into live DOM coordinates.

Brain and Study do not duplicate the local organism.

They enter from named shell anchors, preserving the idea that there is one ecosystem continuing through the app rather than a separate plant on each page.

### Page-level renderer

Website tendrils are rendered by:

- `vine-expansion-controller.mjs`
- `vine-expansion-renderer.mjs`
- `vine-expansion-plan.mjs`

The external Pixi canvas:

- is transparent,
- is `aria-hidden`,
- has `pointer-events: none`,
- sits behind real page content,
- uses route content as its coordinate system,
- cannot become a click or keyboard target.

The external canvas is mounted at the stable `#appContainer` level rather than inside the route-owned `#mainContent`.

It uses viewport coordinates and recalculates from live DOM rectangles on window or main-content scroll. Route renderers may therefore replace `#mainContent.innerHTML` without deleting the spillover canvas.

The main route surface remains in a higher stacking layer, so cards/content cover the vine while transparent gutters and edges still reveal it.

## DOM-aware routing

Paths are not rendered from hard-coded screen pixels.

Every refresh resolves:

1. current route,
2. viewport profile,
3. canonical TreeState,
4. local exit socket or shell source,
5. live target DOM rectangle,
6. current forbidden UI rectangles,
7. approved corridor policy.

If the preferred route crosses a forbidden rectangle, the planner attempts a page-perimeter fallback.

If that fallback still intersects forbidden UI, the path is not rendered.

No vine is allowed to prioritize visual continuity over interface safety.

## Phase 12 — progressive website colonization

The Phase 6 maturity gates are now active renderer behavior.

External spread remains continuous:

- below 0.72 maturity — no spillover
- 0.72 — first controlled escape
- 0.80 — nearby section reach
- 0.86 — contextual route reach
- 0.92 — page-level reach
- 0.97 — deepest ecosystem reach

The renderer progressively reveals each path rather than making it appear instantly.

Path dependencies remain ordered.

A continuation path does not appear unless its source path resolved successfully.

### Dashboard

The mature vine may progressively:

- escape the local tree card,
- reach the right-side gutter,
- approach the streak widget perimeter,
- reach the Daily Invitations card perimeter,
- approach the Knowledge Score hero,
- establish a sparse right page rail.

### Biome

The vine may:

- leave the local biome organism,
- reach the left/right edges of the zone grid,
- at greater maturity continue around selected outer zone perimeters.

Biome pressure controls, Bubble indicators, buttons and tooltips remain forbidden.

### Brain

Brain remains contextual and sparse.

It can receive:

- a restrained right-side tendril toward Pressure Gauges,
- a very high-maturity left-side perimeter tendril.

Pressure rows and Reckoning cards remain untouched.

### Study

Only desktop Study setup may receive one thin outside-card tendril.

Active Study sessions suppress external vines completely.

## External visual rules

Website tendrils are intentionally quieter than the local organism.

They use:

- reduced woody thickness,
- sparse leaves,
- very small flower budgets,
- no fruit,
- reduced motion,
- a global coverage ceiling.

The external vine reflects the same current Vitality as the local organism.

Vitality may change:

- vine color,
- leaf density,
- leaf retention,
- flower presence,
- motion.

It never changes permanent maturity or route eligibility.

## Canonical route-level TreeState

A new lightweight authenticated endpoint is available:

`GET /api/tree-state`

It returns only the canonical renderer state required by the living vine.

It reads:

- user growth/stage/Vitality state,
- subject fruit totals,
- streak milestones,
- global Knowledge Score state,

and returns the same `buildTreeState()` contract used by Dashboard and Biome.

This lets Brain and Study obtain the user's organism state directly without loading the Dashboard first.

The client keeps a short state cache to avoid redundant requests during rapid route transitions.

## Shared browser state channel

`tree-state-channel.mjs` is the single browser source of renderer updates.

Dashboard, Biome, the local Pixi renderer and the website spillover controller all consume the same state events.

This prevents:

- local tree and spillover showing different maturity,
- independent reaction calculations,
- route-order dependence.

The channel retains only the latest recent biological reaction for a short period so a growth event can still animate if the user reaches Dashboard or Biome shortly afterward.

That retained reaction is consumed once.

It is not replayed every time the user switches pages.

## Phase 13 — ecosystem-aware reactions

`tree-reaction-plan.mjs` derives visual events from canonical state transitions.

Supported reaction types are:

- `growth`
- `milestone`
- `recovery`
- `stress-settle`
- `fruit-set`
- `streak-root`
- `bloom`

These are derived from state changes rather than manually triggered decorative animations.

Examples:

- increased Growth Points → shoot-tip / foliage growth response
- stage advancement → stronger milestone response
- Vitality recovery → restorative foliage movement
- Vitality decline → restrained settling response
- new fruit → fruit-set reaction
- new streak milestone → root-strength response
- flowering capacity / flower vigor improvement → bloom response

The local Pixi organism and external website vines consume the same reaction events.

## Study completion

When a real Study session commits successfully:

1. the existing dashboard/biome caches are invalidated,
2. the client immediately refreshes `/api/tree-state`,
3. the shared state channel compares old/new state,
4. biological reactions are derived,
5. any visible mapped vine may react,
6. the reaction is briefly available to a newly mounted local organism.

The Study session itself remains vine-free while active.

## Accessibility

External vines remain purely decorative and never receive pointer or keyboard events.

The local organism retains its image description.

Significant positive ecosystem reactions may be announced through a polite screen-reader live region, for example:

- growth,
- fruit appearing,
- a milestone,
- recovery,
- bloom.

Announcements are suppressed during:

- active Study,
- Reckoning,
- overlays,
- tours,
- unmapped/high-focus routes.

A stress decline is not announced as a celebratory event.

## Responsive behavior

Website spillover remains disabled at the mobile breakpoint.

Tablet receives only the subset of paths explicitly approved by the route contract.

Desktop receives the full approved route set.

The controller recalculates live DOM geometry on:

- route DOM changes,
- responsive layout changes,
- main-content resize,
- window resize.

## Reduced Motion and lifecycle

The website Pixi renderer listens for runtime changes to:

`prefers-reduced-motion`

When Reduced Motion becomes active:

- reveal animations settle immediately,
- reaction motion stops,
- decorative sway stops.

The renderer also pauses its ticker when the document is hidden.

Logout destroys:

- the route-level expansion controller,
- local tree handles,
- observers,
- resize listeners,
- visibility listeners,
- reduced-motion listeners,
- state-channel state.

## Safety rules

The following remain non-negotiable:

1. no vine may intercept input,
2. no path may cross protected controls when a safe route cannot be found,
3. external vines never appear on mobile in this phase,
4. exams and Reckoning remain distraction-free,
5. active Study remains distraction-free,
6. external fruit is forbidden,
7. unmapped routes fail closed,
8. state updates never mutate academic data.

## Phase boundary

Phase 13 ends here.

Phase 14 remains unimplemented.

Dedicated frame-budget instrumentation, adaptive offscreen batching, long-run GPU profiling and lower-end-device performance tuning belong to Phase 14 rather than this delivery.
