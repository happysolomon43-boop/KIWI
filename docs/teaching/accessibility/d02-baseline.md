# KIWI Teaching D02 — Reusable UI Accessibility Baseline

**Delivery:** D02  
**Purpose:** define the minimum accessibility contract before broad Teaching UI implementation.

D02 does not build the later Teaching screens. It establishes the baseline every reusable Teaching UI primitive must satisfy when those screens are implemented.

## Keyboard operability

Every interactive primitive must be reachable and operable by keyboard without requiring pointer precision. Interaction order must follow a meaningful reading/task sequence. Custom widgets must not remove native keyboard behavior unless equivalent semantics and controls are supplied.

No critical academic action may be available only through hover, drag, gesture or pointer-only interaction.

## Semantic structure

Use the correct native semantic element where one exists. Headings, landmarks, form labels, lists, dialogs, status messages and controls must expose meaningful accessible names and relationships.

Visual grouping cannot be the only representation of academic structure.

## Visible focus

Keyboard focus must remain visibly perceivable against the surrounding interface. Focus styling must not be removed without an equally visible replacement.

Focus movement after dialogs, errors, assessment transitions and other state changes must be deliberate and predictable.

## Status cannot rely on color alone

Academic status, warnings, success/failure states, due/expired state, selection and validation errors require textual, semantic, iconographic or structural cues in addition to color.

A student must not need color perception to distinguish an academically meaningful state.

## Text scaling and reflow

Reusable primitives must remain usable when text is enlarged. Content must not be clipped, overlap critical controls, or require precision horizontal scrolling merely because the user increases text size.

Layouts must prefer reflow and flexible sizing over fixed pixel assumptions.

## Error and state announcements

Validation errors and important asynchronous status changes must have a programmatically discoverable message. Error text must identify what needs attention rather than relying on red borders alone.

Time-sensitive UI may visually animate a countdown, but the countdown is a projection of authoritative server timestamps. Accessibility behavior must not turn a browser timer into academic time authority.

## Motion and animation

Motion is not required to understand an academic state. Later visual-system work must provide reduced-motion-safe behavior where movement is nonessential.

## Assessment and accommodation boundary

Accessibility support does not silently change the construct, standard, mark scheme, eligibility or assessment restriction. Approved accommodations are separate academic policy/state and must be applied by their authoritative owner.

## Code-level contract

`teaching/accessibility/baseline.js` exposes the five D02 minimum requirements:

- keyboard operability;
- semantic structure;
- visible focus;
- non-color-only status;
- text-scaling-safe composition.

Future reusable primitives must satisfy the contract before they are treated as Teaching-wide building blocks.
