# KIWI Living Vine — Phase 5 Visual Blueprint

## Design intent

KIWI's organism is not a freestanding tree. It is a trained woody kiwifruit vine growing through a purpose-built trellis.

The visual goal is to make the organism feel alive, earned and increasingly integrated into the product without becoming noisy or decorative clutter.

The core principle is:

> The vine should look like it is inhabiting KIWI, not pasted on top of it.

The plant develops continuously from one persistent biological structure. There are no visual model swaps at stage boundaries.

## Hero composition

The local organism occupies a wide horizontal trellis composition.

The preferred silhouette is:

- a centered woody base emerging from soil,
- one main leader rising toward the upper support,
- two permanent horizontal cordons extending left and right,
- fruiting laterals descending and curling from those cordons,
- secondary lower shoots that add depth around the central stem,
- foliage concentrated across the upper two-thirds,
- a deliberately open central corridor so the structure remains readable.

The trellis is architectural support, not the hero. It should feel warm and crafted, but quieter than the vine.

### Trellis geometry

The canonical trellis has:

- three vertical posts,
- one strong upper beam,
- one thinner cordon-support beam,
- two diagonal braces,
- rounded warm wood,
- restrained texture,
- no rustic fence aesthetic,
- no excessively decorative joinery.

The central post sits behind the main leader so the vine can visually wrap and detach from it.

## Permanent vine skeleton

The permanent woody structure is defined by renderer-neutral Bézier segments in `services/vine-visual-blueprint.js`.

The growth order is intentional:

1. the root base establishes,
2. the main leader climbs,
3. left and right cordons extend,
4. early inner laterals form,
5. outer laterals and secondary shoots appear,
6. older sections thicken and become more woody,
7. reproductive zones become available.

The renderer should never randomize the primary skeleton. The same user state should produce the same core organism.

Local variation may be applied only to:

- small leaf rotations,
- tendril curl,
- tiny twig offsets,
- fruit cluster sway,
- ambient movement.

Permanent topology should remain stable.

## Growth animation

Each vine segment has an `unlockAt` and `completeAt` maturity value.

A segment should not pop into existence. Instead:

- before `unlockAt`: hidden,
- between `unlockAt` and `completeAt`: progressively draw along its curve,
- after `completeAt`: fully established.

Thickness is controlled separately from reach.

This lets a young vine visibly extend along the trellis rather than swapping between stage illustrations.

At milestone boundaries, the stage label can change while the structure remains visually continuous.

## Foliage design

Leaves should be unmistakably kiwifruit-like:

- broad,
- rounded to heart-shaped,
- visibly veined,
- organic size variation,
- attached to real vine nodes,
- layered in rear, middle and foreground planes.

The foliage must not become a generic green cloud.

Three major foliage zones are defined:

- left crown,
- right crown,
- lower center.

The upper crown carries the most density. The center remains more open so the woody structure is still legible.

### Foliage and Vitality

Permanent growth controls how much foliage the structure can support.

Vitality controls the current condition:

- density,
- retention,
- droop,
- saturation,
- movement,
- shoot vigor.

A low-Vitality mature vine must still reveal the same mature cordons and woody architecture.

## Flowers

Flowers are a later-life layer.

They should be:

- small,
- pale cream/white,
- subtle,
- attached to valid reproductive nodes,
- more noticeable at healthy Vitality,
- never rendered like decorative confetti.

Flowering should visually precede fruiting.

## Fruit

Kiwi fruit appears only in defined reproductive zones.

Fruit should:

- hang beneath laterals,
- appear in small clusters,
- use slight scale variation,
- stay subordinate to the foliage,
- never be scattered randomly around the scene.

The number drawn is a visual representation, not necessarily a literal 1:1 count for large totals.

The desktop blueprint caps local visible fruit clusters at 12. Tablet uses 9. Mobile uses 6.

## Depth system

The renderer should use the following scene order:

1. backdrop,
2. rear foliage,
3. rear trellis,
4. woody vine,
5. mid foliage,
6. flowers,
7. fruit,
8. foreground foliage,
9. ambient effects.

Leaves should occasionally pass in front of fruit and wood. This is important for natural depth.

The trellis must never sit entirely in front of the plant.

## Motion character

Motion should feel biological, not game-like.

Base idle motion:

- extremely slow canopy breathing,
- local leaf sway,
- slight fruit pendulum,
- tiny live movement at growing shoot tips.

The woody base and established cordons should barely move.

When new Growth Points arrive:

- the active tip extends,
- the new section gently settles,
- one or more leaf buds can unfold,
- nearby foliage reacts subtly.

A milestone can add a richer moment, but should not replace the organism.

## Lighting and material style

The target style is premium 2D illustration rather than flat iconography or photorealism.

Use:

- soft depth,
- controlled highlights,
- warm wood,
- rich but not neon foliage,
- subtle bark texture,
- minimal glow,
- restrained particles.

Avoid:

- cartoon eyes/faces,
- oversized fruit,
- glossy mobile-game rendering,
- heavy bloom,
- fantasy sparkles everywhere,
- photorealistic texture mismatch.

## Local exit sockets

Phase 5 defines four reserved local vine exit sockets around the trellis.

They are not connected to website UI yet.

Their purpose is to make the local organism structurally ready for Phase 6's website expansion map.

The sockets are:

- upper-left,
- upper-right,
- mid-left,
- mid-right.

They unlock only at high maturity.

This avoids retrofitting arbitrary spillover paths after the local organism has already been designed.

## Responsive composition

### Desktop

Desktop is the fullest expression.

- all local vine segments are available,
- foliage may use full intended density,
- up to 12 visible fruit clusters,
- local exit sockets may activate.

### Tablet

Tablet keeps the same skeleton but slightly compresses foliage density and fruit count.

### Mobile

Mobile preserves the organism but protects usability.

- the two farthest outer laterals are suppressed,
- foliage scale is reduced,
- visible fruit clusters are capped at 6,
- website spillover is disabled in the local blueprint,
- larger safe margins are enforced,
- the central leader and main cordons remain recognizable.

The mobile plant must feel like the same organism, not a separate simplified illustration.

## Renderer contract

The future PixiJS renderer should consume:

- `TreeState.vineStructure`,
- `TreeState.vineHealth`,
- `services/vine-visual-blueprint.js`.

It should not invent its own biological thresholds.

The blueprint determines topology and local layout.
The state determines how much of that topology is developed and how healthy it currently appears.

## Non-negotiable design rules

1. No stage-to-stage visual swapping.
2. No random primary skeleton.
3. No Vitality-driven loss of permanent woody structure.
4. No leaves or fruit detached from real vine nodes.
5. No website spillover before Phase 6 defines safe UI routes.
6. No UI obstruction.
7. The trellis supports the vine visually; it does not dominate it.
8. The same biological identity must survive desktop, tablet and mobile.
