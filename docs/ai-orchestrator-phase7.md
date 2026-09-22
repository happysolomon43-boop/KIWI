# KIWI AI Orchestrator — Phase 7 Automatic Model Discovery

Phase 7 makes KIWI capable of discovering a newly released stable Gemini Flash/Flash-Lite model, qualifying it, promoting it into live routing, and rolling it back automatically if the release behaves badly.

## Production principle

KIWI does **not** route production traffic through Google's moving `*-latest` alias.

Google documents that a `latest` alias may point to a stable, preview, or experimental release. KIWI instead discovers exact model IDs with the Gemini `models.list` API and only considers exact stable versioned IDs such as:

```text
gemini-3.8-flash
gemini-3.5-flash-lite
```

Preview, experimental, image, live, Pro, and `*-latest` aliases are not eligible for automatic promotion.

## Discovery cadence

Discovery runs:

1. once asynchronously immediately after backend startup;
2. every 15 minutes by default.

The interval is configurable with `AI_DISCOVERY_INTERVAL_MS` and is bounded between 5 minutes and 6 hours.

Discovery samples up to three configured project/key slots per cycle and unions the provider model list. It consumes no `generateContent` quota until a genuinely new eligible model needs qualification.

## Automatic qualification

A new stable Flash/Flash-Lite model is placed in `DISCOVERED` state first. It is promoted only if it is newer than the currently approved stable model in that family and `AI_AUTO_PROMOTE` is enabled.

Qualification uses synthetic data only. No learner prompt, note, card, exam, or response is used.

The qualification suite verifies:

- `generateContent` works on a configured project;
- the provider advertises thinking support;
- HIGH thinking works;
- multimodal inline image input works;
- JSON structured output works;
- MINIMAL thinking is probed;
- if MINIMAL is rejected, LOW thinking is explicitly probed;
- reported token limits are captured;
- `longOutput` is only granted when output capacity is at least 24,000 tokens.

A model supporting MINIMAL is registered as:

```text
MINIMAL / LOW / MEDIUM / HIGH
```

A model that rejects MINIMAL but accepts LOW is registered as:

```text
LOW / MEDIUM / HIGH
```

Transient quota/network failures leave the model in `DISCOVERED` so a later cycle retries qualification. Permanent incompatibility leaves it `DENIED`.

Qualification uses the highest-numbered healthy configured project slot by default so it does not always consume project 1's VVIP quota. `AI_QUALIFICATION_PROJECT_SLOT` can override this.

## Automatic promotion

Promotion updates the live in-memory model catalog immediately and persists it to Supabase.

Because the router selects approved models by semantic version rank, a future model such as:

```text
gemini-3.9-flash
```

would automatically turn:

```text
VVIP: 3.8 -> 3.7 -> 3.6
```

into:

```text
VVIP: 3.9 -> 3.8 -> 3.7
```

without changing CBT, Reckoning, card-generation, or other feature code.

Version ranking is numeric rather than lexical, so `3.10` correctly sorts above `3.9`.

## Automatic rollback

Auto-promoted models carry a circuit breaker.

The model is immediately suspended on a provider-level model incompatibility such as `BAD_REQUEST` or `MODEL_NOT_FOUND`.

It is also suspended after repeated model-health failures such as empty responses, provider 5xx failures, or timeouts inside the rolling failure window.

Quota exhaustion does **not** count as a bad-model signal.

When a newly promoted model is suspended, the current user request falls through to the previous approved model instead of failing merely because the new release was bad.

The runtime also exposes `reportValidationFailure(modelId, reason)` so task validators can feed future output-quality failures into the same rollback mechanism.

## Persistence

Supabase now stores a backend-only `ai_model_qualifications` audit trail in addition to the Phase 3 model catalog.

It records model ID, probe outcome, supported reasoning levels, capabilities, project slot, error code/reason, and qualification timestamps.

It stores no API keys and no learner content.

Persisted promoted or suspended models are hydrated before routing at the next backend restart.

## Emergency controls

- `AI_AUTO_DISCOVERY=false` — stop automatic discovery.
- `AI_AUTO_PROMOTE=false` — continue discovering but do not promote.
- `AI_MODEL_DENYLIST=modelA,modelB` — suspend/deny specific model IDs.
- `AI_PIN_VVIP_MODEL=<id>` — force the VVIP starting model while preserving bounded fallbacks.
- `AI_PIN_VIP_MODEL=<id>` — force the VIP starting model.
- `AI_PIN_IP_MODEL=<id>` — force the IP starting model.
- `AI_QUALIFICATION_PROJECT_SLOT=<slot-or-env-name>` — choose the project used first for qualification.
- `AI_DISCOVERY_PROJECT_SAMPLE=<n>` — number of configured projects sampled by each model-list cycle.

Pins only work for approved, stable, capability-compatible models. A suspended or denied model cannot bypass lifecycle safety through a pin.

## Security

Model discovery and qualification use the existing Render-only Gemini secrets. Keys never enter Supabase telemetry or catalog tables.

The new qualification table has RLS enabled and direct `anon` / `authenticated` access revoked.
