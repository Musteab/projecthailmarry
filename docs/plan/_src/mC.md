### Conflict hotspots and how each is defused

| Hotspot | Why it is risky | Defusal |
|---|---|---|
| `pnpm-lock.yaml` | Everyone adds dependencies | Per-package manifests; never hand-merge; take `main` and reinstall. |
| `packages/shared` | Everyone wants "one more field" | Single owner, additive-only, 30-minute change-request turnaround. |
| `apps/web` data fetching | UI and data logic tend to mix | No `fetch` in `apps/web`; hooks only; Muste never writes JSX. |
| `apps/server/src/app.ts` | Muste's routes need mounting | Muste ships a Fastify plugin; Dominic mounts it once. |
| Scenario files vs engine behaviour | Tuning happens on both sides | Content (timings, ids, text) is Muste's; behaviour (thresholds, models) is Dominic's; thresholds are exposed as scenario or rule params so tuning stays in Muste's files. |
| `data-testid` for E2E | Tests need hooks into Thant's markup | Muste requests ids; Thant adds them. |
| Root scripts and CI | New commands (`demo:check`, e2e job) | Requested from Dominic; package-level scripts stay with the package owner. |
| `.env.example` | New variables | Requested from Dominic. |

# PART 7 · DEPENDENCIES & PARALLEL EXECUTION

**Contracts that must exist first:** everything in `packages/shared` (DOM-002). That is the only hard gate for the whole team, and it is the first thing I build. Until it is on `main`, Thant and Muste do no-repo preparation (tokens, API keys, references, bounding box, Overpass queries).

**First tasks, immediately after the contract freeze:**

| Developer | Starts | In parallel if capacity allows |
|---|---|---|
| Dominic | DOM-003 server foundation | then DOM-004 and DOM-005 |
| Thant | THA-001 design system | THA-012 sign-in |
| Muste | MUS-001 client core with mock v0 | MUS-003 region pack, MUS-004 intel foundation |

**Dependency matrix (cross-developer dependencies only; everything else is internal to one person).**

| Task | Needs from another developer | Can it be mocked meanwhile? |
|---|---|---|
| All THA tasks | `@bastion/client` hooks (MUS-001) | Yes: `region-mini` + local mock until mock v0, then mock engine |
| THA-004 and later, on real geography | Portland pack (MUS-003) | Yes: `region-mini` |
| THA-015 | MUS-010 | Yes: mock responses |
| MUS-001, 003, 004 | DOM-002 only | n/a, independent |
| MUS-009 | DOM-007 (M1) | Yes: mock transport |
| MUS-007, 008 played for real | DOM-006, 008, 010, 013 | Yes: authored and rehearsed on the mock engine |
| MUS-010, 011 | plugin mounted (DOM-009) | Yes: unit tests with fake host |
| MUS-012 | outbox / action data (DOM-011) | Yes: fixtures |
| MUS-014 | M2, M3; `data-testid` from Thant | No (integration by nature) |
| DOM-005 and later, on real data | Portland pack (MUS-003) | Yes: `region-mini` |
| DOM-009 | `IntelPort` implementation (MUS-004 to 006) | Yes: `NullIntel` |
| DOM-017 | real scenarios (MUS-007, 008) | Partly: `scenario-mini` |

**Fully independent from hour one:** THA-001, 002, 003, 012 · MUS-001, 003, 004 · DOM-003, 004, 005.

**Critical path:** DOM-001 → 002 → 003 → 005 → 006 → 007 → 008 → 009 → 010 → 011 → 012 → 013 → 014, joined by MUS-003 → MUS-007 → MUS-008 for real content. Thant is deliberately off the critical path. Nobody is ever blocked on me: the mock engine carries the UI, `region-mini` and `NullIntel` carry the backend, and the scenarios are authored against the mock.

**Execution sequence (hours for a 48-hour event).**

| Window | Dominic | Thant | Muste |
|---|---|---|---|
| 0–2 h | DOM-001, 002 → **M0** | prep: references, fonts, Mapbox token | prep: API key, bbox, Overpass queries |
| 2–8 h | DOM-003, 004, 005 | THA-001, 002, start 003 | MUS-001 → **mock v0**, start MUS-003 |
| 8–14 h | DOM-006, 007 → **M1** | THA-003, 004, 006 | MUS-003, 004, MUS-009 |
| 14–24 h | DOM-008, 009, 010 | THA-005, 007, 008 | MUS-002, 005, 006, MUS-007 |
| 24–30 h | DOM-011, 012 → **M2** | THA-009, 011, 012 | MUS-007 tuning, MUS-008 |
| 30–36 h | DOM-013, 014 → **M3** | THA-010 | MUS-008 tuning, MUS-010 |
| 36–42 h | DOM-015, 016, 018 | THA-013, 014, 015, 016 | MUS-011, 012, 013, 014 → **M4** |
| 42–48 h | DOM-017, fixes | THA-017, fixes | rehearsal, cache warm, backup video → **M5** |
