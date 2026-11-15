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
