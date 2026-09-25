# KIWI Teaching Implementation Governance

This directory is the durable implementation-governance boundary created by D00. It does not implement Teaching product behavior.

## Authority

Implementation is pinned to the frozen v11.5/v9.5 Phase-22 baseline recorded in `canonical-baseline.json`. The Implementation Context Pack routes engineers to underlying canonical sources; it never substitutes for them.

Precedence for implementation decisions is:

1. platform/security constraints and explicit implementation authorization;
2. Final Pre-Implementation Freeze and its manifest;
3. canonical Blueprint and domain-specific canonical contracts;
4. Capability Registry / authority / runtime / PPL contracts;
5. frozen prompt-family contracts and evaluation holds;
6. dependency-aware Delivery Roadmap and Delivery Task Map for execution boundaries;
7. Master Backlog descriptions;
8. implementation-local realization choices that do not change academic meaning.

A lower layer cannot silently amend a higher layer.

## Delivery discipline

TCH IDs are permanent traceability identities, not execution order. Delivery placement and explicit predecessors govern implementation sequence. One delivery is active by default. Future behavior is not implemented merely because adjacent code makes it convenient.

Any apparent contradiction follows `dependency-change-control.md`; it is never resolved by guessing.

## Durable governance artifacts

- `canonical-baseline.json` pins versions, hashes, counts, D00 scope, PPL T0 IDs and qualification holds.
- `source-resolution.md` records what was actually resolved at D00 start and any integrity gaps.
- `decision-log.md` is append-only for architecture/product decisions and exceptions.
- `terminology.md` freezes canonical vocabulary and the internal-enum/display-label boundary.
- `authority-and-state-contracts.md` freezes academic ownership, three-truth separation, state axes and fairness rules.
- `intelligence-and-ppl.md` freezes intelligence classes, authority ceilings, context minimization and PPL boundaries.
- `release-scope.md` fixes Alpha/Beta boundaries without implementing them.
- `dependency-change-control.md` defines dependency metadata and amendment/exception handling.
- `blueprint-traceability.md` maps every delivery to its governing Blueprint surface.

## Implementation rule

Documentation in this directory may describe frozen behavior but must not become a competing runtime source of academic truth. Runtime/domain implementation must continue to use the authoritative domain owners defined by the Blueprint.

D00 intentionally creates no Teaching database schema, no prompt changes, no provider/model bindings, no Teaching feature flag, and no new product behavior.
