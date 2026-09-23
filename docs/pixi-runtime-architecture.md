> **Historical phase note:** This document records the Phase 7 runtime introduction. The final production renderer architecture is defined in `docs/vine-phases-14-15.md` and `docs/tree-state-architecture.md`; references below to the SVG renderer being authoritative are no longer current.

# KIWI PixiJS Runtime Infrastructure — Phase 7

## Scope

Phase 7 introduces PixiJS as a rendering runtime without replacing the existing SVG `KiwiTree`.

No biological vine geometry is rendered by PixiJS in this phase.

The purpose of this phase is to make the eventual Phase 8 renderer safe to mount, resize, pause, destroy and fall back without adding more lifecycle logic to the monolithic `index.html`.

## Version and delivery

KIWI pins:

`pixi.js@8.21.0`

The version is exact rather than a caret range.

Production browsers do not import PixiJS from a public CDN.

During install/build:

`scripts/sync-pixi-vendor.js`

copies the package browser module from:

`node_modules/pixi.js/dist/pixi.min.mjs`

into the generated static asset path:

`/vendor/pixi/pixi.min.mjs`

The package license and a small version manifest are copied beside the runtime.

This gives KIWI a deterministic browser dependency and avoids a runtime dependency on jsDelivr, unpkg or another third-party CDN.

## Frontend build

KIWI previously deployed the root `index.html` and selected `public/` files directly.

Phase 7 adds a reproducible frontend build:

`scripts/build-web.js`

The build:

1. synchronizes the pinned Pixi browser bundle,
2. clears `dist/`,
3. copies the root `index.html` to `dist/index.html`,
4. copies the contents of `public/` into the root of `dist/`,
5. verifies the local Pixi browser module exists,
6. writes `kiwi-build.json` containing the pinned Pixi version.

Vercel now uses the modern `buildCommand` / `outputDirectory` configuration: it runs `npm run build:web` and serves `dist/`.

Filesystem assets take precedence over the SPA fallback to `index.html`.

The Express deployment continues to serve `public/` normally. The `postinstall` vendor sync makes the same `/vendor/pixi/pixi.min.mjs` path available there.

## Runtime policy

`public/tree/runtime-policy.mjs`

contains renderer-neutral browser runtime decisions.

It derives:

- desktop / tablet / mobile profile,
- device-constrained status,
- render resolution cap,
- maximum ticker FPS,
- antialias policy,
- GPU power preference,
- reduced-motion state,
- save-data state.

Current defaults intentionally favor reliability over maximum GPU load.

Desktop high-capability devices may render at up to 2x resolution and 60 FPS.

Mobile is capped below that.

Constrained devices and Save-Data reduce resolution and ticker frequency further.

These are infrastructure defaults, not final Phase 14 performance tuning.

## Pixi runtime

`public/tree/pixi-runtime.mjs`

owns the Pixi `Application` lifecycle.

It uses the PixiJS v8 async initialization model.

The application is initialized with:

- transparent background,
- `resizeTo` the local renderer container,
- automatic density,
- a private ticker,
- WebGL preference,
- texture garbage collection,
- adaptive resolution,
- adaptive antialiasing and power preference.

The canvas:

- is presentation-only,
- is `aria-hidden`,
- cannot receive keyboard focus,
- uses `pointer-events: none`.

The runtime creates named scene containers in this order:

1. backdrop,
2. rear foliage,
3. rear trellis,
4. woody vine,
5. foliage,
6. flowers,
7. fruit,
8. foreground foliage,
9. ambient.

These names match the Phase 5 visual blueprint but Phase 7 does not populate them.

## Lifecycle safety

A Pixi runtime is not allowed to render continuously just because it exists.

The ticker pauses when:

- the document is hidden,
- the renderer container is known to be offscreen,
- the runtime is destroyed.

An `IntersectionObserver` is used when available.

`visibilitychange` covers background tabs.

`prefers-reduced-motion` is monitored at runtime. Motion-aware ticker callbacks receive zero motion when reduced motion is enabled.

The runtime exposes explicit:

- `pause()`,
- `resume()`,
- `resize()`,
- `renderOnce()`,
- `destroy()`.

Destroy disconnects observers/listeners and destroys the Pixi application and scene graph.

## Renderer gateway

`public/tree/tree-renderer-gateway.mjs`

is the migration boundary between the old and new renderers.

Supported modes are:

- `legacy`
- `pixi`

Any unknown value normalizes to `legacy`.

The default mode is always `legacy` in Phase 7.

If Pixi is explicitly requested, the gateway dynamically imports the Pixi runtime and attempts initialization.

Because the biological Pixi renderer is intentionally not implemented until Phase 8, a successful Phase 7 runtime mount is immediately destroyed and the gateway returns to the SVG renderer with the fallback reason:

`pixi-renderer-not-implemented`

If Pixi initialization fails for any browser/device reason, the same fallback path is used.

Therefore Phase 7 cannot leave a user with an empty tree.

## Why PixiJS is lazy-loaded

The legacy tree remains production-authoritative.

Loading the Pixi module for every user before Phase 8 would add transfer and parse cost without visible benefit.

The gateway dynamically imports Pixi only when `pixi` is explicitly requested.

This also means the current application behavior is unchanged by default.

## Phase 8 handoff

Phase 8 should build a biological renderer on top of this runtime.

It should:

1. consume canonical `TreeState.vineStructure`,
2. consume canonical `TreeState.vineHealth`,
3. consume the Phase 5 visual blueprint,
4. populate the existing Pixi layer containers,
5. preserve deterministic topology,
6. update state without reconstructing the entire application,
7. prove continuous local growth before external website expansion is rendered.

Only after that renderer is complete should the gateway be permitted to return a persistent `pixi` renderer handle.
