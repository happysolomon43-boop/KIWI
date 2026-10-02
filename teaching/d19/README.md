# Teaching D19 — Assessment Types & Measurement Behaviour

This module is the deterministic assessment-type/measurement-behaviour layer over the accepted D17 Assessment domain and D18 Assessment Shell.

It owns type purpose/scope posture, cumulative anti-recency coverage checks, governed Impromptu controls, student-safe visibility posture, and Make-Up/Incomplete lineage semantics. It does not own Assessment Package/Attempt/Response truth, official marking/Gradebook state, Progression/Resit decisions, Scheduler time, SKM truth, provider/model routing, or prompt-family bytes.

The runtime contract is `d19.measurement.v1`. No D19 database migration is introduced; durable D19 metadata is carried by D17-owned versioned Assessment/Blueprint/Package fields. D30 route qualification and D31 production-release gates remain authoritative.
