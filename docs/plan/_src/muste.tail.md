## Integration expectations (Muste)

- **M0, contract freeze.** Dominic lands the workspace and `@bastion/shared`. You branch and start MUS-001.
- **Mock v0 (first hours).** MUS-001 merged; tell Thant. This is your first and most time-critical deliverable.
- **M1, walking skeleton.** Dominic announces the WebSocket is live; you do MUS-009 so `pnpm dev` works end to end.
- **M2, flood vertical slice.** Portland pack (MUS-003), intel mounted (MUS-004 to 006), flood scenario (MUS-007) playing on the real engine. Expect a tuning loop with Dominic on timings and thresholds; scenario content is yours, engine behaviour is his.
- **M3, restoration and earthquake.** MUS-008 playing; the contrast between the two acts verified.
- **M4, feature freeze.** P1 tasks merged; caches warmed and committed.
- **M5, demo lock.** `demo:check` green, runbook rehearsed three times, backup video recorded.

Two interfaces are yours to keep honest: the hooks Thant consumes and the `IntelPort` Dominic calls. If either needs to change, propose the change to the contract owner (Dominic) first; do not ship a silent divergence.

## Your first actions

1. Read this brief once, fully.
2. Wait for Dominic's announcement that the repository and contracts are on `main` (DOM-001, DOM-002). While waiting: obtain an Anthropic API key for the team and keep it in your local `.env` only; open the proposed Portland bounding box on a map and note the creek, bridges and hospitals you want in it; draft the Overpass queries; read the current Claude API documentation for structured JSON output.
3. Clone, `npm install -g pnpm@10`, `pnpm install`.
4. MUS-001 on `feat/muste-client-core`, committing at each listed milestone; PR; merge when CI is green; announce mock v0 to Thant.
5. Then MUS-002, MUS-003, MUS-004 and onward in the stated order, one task per branch, one PR per task.
6. At the end of each task, report what was built, test results (paste the summary line), and what the other two can now rely on.
