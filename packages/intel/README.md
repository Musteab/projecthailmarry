# @bastion/intel

`createIntel(config)` implements the shared `IntelPort`. `intelPlugin` is mounted
with `app.register(intelPlugin, { host, config })`, where `host` implements the
shared `IntelHost`, including its authentication hook. Route features are added
in subsequent Muste tasks; the foundation includes authenticated `/api/intel/health`.

Modes: `off` returns deterministic rule fallbacks, `cache` reads validated JSON
files with zero model calls, `live` reads through the cache then calls Claude.
Missing keys, invalid responses, timeouts and cache misses fall back internally.
The entire call budget defaults to 3.5 seconds, including cache access and one
retry. In-flight provider calls receive an abort signal. Model and mode defaults
come from the existing environment contract; model ids can be overridden in config.

`INTEL_MODEL_FAST`, `INTEL_MODEL_DEEP`, `INTEL_MODE` and `ANTHROPIC_API_KEY` are
already listed in the repository's environment example. No key is required for
tests or offline demos. The SDK uses structured JSON output and an ephemeral
prompt-cache marker on the static system prefix. Persistent response caching is
separate and keyed by model, prompt version, system text and input content.

The optional `log` callback receives task, model, latency, cache/fallback source,
and token counts. It never receives API keys, headers or report text. Live Claude
latency/credentials must be verified in the team's configured environment; tests
use FakeProvider and do not claim successful live calls.

MUS-010 adds authenticated operation briefing and copilot routes. Narratives reject numeric claims absent from the supplied evidence; copilot entity references must resolve in the operation/region. `useCopilot()` now also exposes `refs` for map highlighting. Neither route executes commands. The current host exposes recent timeline and decision explanations, but not the complete audit history; full audit retrieval is deferred to the audit integration. Fusion uses a JSON-schema-compatible numeric array on the model boundary, then validates coordinates through the shared tuple schema and clamps numeric ranges in code.

MUS-011: `FEEDS_ENABLED=1` starts one-minute NWS / USGS earthquake / Johnson Creek gauge polling for live operations only. It is off by default. `INTEL_MODE=cache` suppresses live polling; add `FEEDS_REPLAY=1` for recorded offline data. Feed failures back off to fifteen minutes, deduplication is per operation and upstream ID, and observations never execute commands themselves. Gauge parsing uses the current USGS OGC latest-continuous API. Dominic: expose/document FEEDS_REPLAY alongside FEEDS_ENABLED if desired; the plugin owns startup/shutdown without server changes.

Manual live smoke check: `pnpm --filter @bastion/intel exec node --import tsx scripts/live-feed-check.ts` creates an isolated in-memory live operation. On 2026-11-15 it ingested a regional USGS earthquake and the Milwaukie gauge in 2.87 seconds. This check needs network access and is deliberately separate from offline CI.

MUS-012 public outputs: `/public/:regionId/closures.geojson` exposes confirmed published closures from active live operations only. `/public/:regionId/alerts.cap` returns the latest executed, non-sandboxed live public alert as one CAP 1.2 document (204 when absent), cached for 30 seconds. CAP sender is explicitly `bastion@demo.invalid`; production publishers must supply their own identity and authoritative issuance timestamps. The demo timestamp derives from operation creation plus action simulation time. XML escaping strips invalid control characters. `formatDispatch` produces a CAD-style JSON envelope; it does not send anything externally. The committed CAP fixture validates against the [official OASIS CAP 1.2 XSD](https://docs.oasis-open.org/emergency/cap/v1.2/CAP-v1.2.xsd), including its explicit timezone timestamp pattern.
