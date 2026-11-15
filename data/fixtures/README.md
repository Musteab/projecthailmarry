# Offline protocol fixtures

`mock-flood.ndjson` and `mock-quake.ndjson` are deterministic captures generated
from Muste's scripted browser engine on region-mini. They are **not recordings
of Dominic's backend or evidence of real disasters**.

Each line contains `{ elapsedMs, message }`. The first snapshot has elapsed time 0;
subsequent records contain the shared `ServerMessage` protocol. Original ordering
is retained when multiple records share a timestamp.

Regenerate from the repo root:

```sh
pnpm --filter @bastion/client fixtures
```

To capture an existing server operation, use the separate client `record` command
and choose a new filename. It writes only protocol payloads, never authentication
tokens. Real server capture requires its operation/WebSocket endpoints; the mock
fixtures and replay tests are usable now.
