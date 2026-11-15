# PART 9 · INTEGRATION MILESTONES

Integration is continuous: every task merges to `main` when green. The milestones below are the moments all three sit together for ten minutes, run the real app, and write down what is broken.

| Milestone | When (48 h) | What must be true | Who verifies |
|---|---|---|---|
| **M0 Contract freeze** | 2 h | Repo on GitHub, CI green, `@bastion/shared` complete, `region-mini` fixture available | Dominic |
| **Mock v0** | about 6 h | `pnpm dev:mock` shows moving units through real hooks | Muste hands to Thant |
| **M1 Walking skeleton** | 14 h | Sign in → launch `scenario-mini` → real server streams over WebSocket → units move on the 3D map. Same UI works in mock and live. | All three; Muste owns client ↔ server fit |
| **M2 Flood vertical slice** | 30 h | Portland pack, flood scenario on the real engine: water, fused incident, auto-dispatch, triaged ambulance, grid isolation, shelter, closures, action stream with approve / override | All three; Dominic owns behaviour, Muste content, Thant visuals |
| **M3 Restoration and earthquake** | 36 h | Restoration options, work order to reopening; earthquake scenario with different crew, hospital and top road | All three |
| **M4 Feature freeze** | 42 h | P1s that made it are merged; deployed URL works; E2E smoke green; AI caches committed | Dominic (deploy), Muste (E2E) |
| **M5 Demo lock** | 46 h | Golden runs green; three clean rehearsals from the runbook on the demo machine and display; backup video recorded; `main` tagged `demo` | Muste runs, all watch |

**Integration ownership.**

- Frontend ↔ backend fit is Muste's (`@bastion/client` is the seam). Thant reports a symptom; Muste decides whether it is a hook, a mock or a server issue and routes it.
- Contract questions are Dominic's. Answer within 30 minutes, additive only.
- Each developer validates their own PR (checks green, app boots, mock demo plays) and merges it themselves when it touches only their own paths. Dominic does not gatekeep merges.
- Merge conflicts are resolved by the owner of the conflicting file. A conflict in someone else's file means stop and ask.
- Order of integration: contracts → client + mock → server streaming → hazards and ops → AI → restoration → second scenario → deployment → rehearsal.

# PART 10 · RISKS & FALLBACK STRATEGIES

| # | Risk | Likelihood / impact | Mitigation | Fallback |
|---|---|---|---|---|
| R1 | Dominic's backend chain is long and sequential; a slip delays M2 and M3 | High / High | Tasks ordered so a demo-able slice exists after each; `region-mini` and `scenario-mini` for fast tests; scenario injects can force outcomes | Stage demo on the mock engine (MUS-002), which mirrors both acts |
| R2 | 3D scene performance (8k cells, 10k+ edges, 30 units, buildings) | Medium / High | Performance budget in THA-003; cells patched only on change; client-side interpolation; deck.gl instancing | Lower cell resolution, hide local roads, reduce building extrusion |
| R3 | Venue network: map tiles, API calls | Medium / High | Region pack, scenarios and AI cache are committed; `INTEL_MODE=cache`; browser tile cache pre-warmed by a rehearsal on the demo machine | Phone hotspot; backup video |
| R4 | LLM latency or malformed output on stage | Medium / High | 4 s timeout, schema validation, cache keyed by content hash, rule-based fallback | `INTEL_MODE=cache` for the pitch by default |
| R5 | OSM / elevation pipeline takes too long | Medium / Medium | Time-box to about 2 hours beyond the estimate | Hand-curated arterial graph, elevation from distance to water |
| R6 | Non-determinism makes the demo vary | Medium / High | Seeded PRNG, fixed sim step, forced injects, golden-run tests (DOM-017) | Record the good run and replay it through the mock transport |
| R7 | Merge conflicts and broken `main` | Medium / Medium | Package-level ownership, CODEOWNERS, small PRs, CI gate, post-merge boot check | Revert the offending merge commit immediately, fix on a branch |
| R8 | Contract drift between mock and server | Medium / Medium | zod validation of every message on both sides in dev; record-and-replay of real runs into the mock | Server is the truth; regenerate fixtures |
| R9 | Mapbox token limits or licensing concerns | Low / Medium | Free tier is ample for a hackathon | MapLibre + free tiles, deck.gl extrusions |
| R10 | WebSocket blocked by the deployment proxy | Low / Medium | Verified in DOM-016 on the chosen host | Run locally for the pitch; deployed URL is for judges afterwards |
| R11 | Scope creep toward realism | High / Medium | "Plausible and tunable" rule; P2 list is explicit | Cut order in Part 3 |
| R12 | `node:sqlite` unavailable on a teammate's Node | Low / Low | `.nvmrc` pins Node 22+ | Swap to `better-sqlite3` behind the same repository functions |
| R13 | AI decision support mistaken for certified triage or engineering | Low / Medium | UI disclaimer string; humans can override everything; assumptions stated | n/a |

# PART 11 · THREE INDEPENDENT CLAUDE CODE PROMPTS

Each prompt is a separate, self-contained file. It embeds the application overview, architecture, ownership table, the full contracts and the Git protocol, so the receiving session needs nothing else. Open the file, copy all of it, paste it as the first message of that developer's Claude Code session.

| Prompt | File | Paste into |
|---|---|---|
| **PROMPT A: DOMINIC** — Backend & Architecture Implementation | `docs/plan/PROMPT_A_DOMINIC.md` | Dominic's session |
| **PROMPT B: THANT** — UI/UX & Frontend Implementation | `docs/plan/PROMPT_B_THANT.md` | Thant's session |
| **PROMPT C: MUSTE** — Features & Integrations Implementation | `docs/plan/PROMPT_C_MUSTE.md` | Muste's session |

The prompts are generated from the same source fragments as this document (`docs/plan/_src`, rebuilt with `bash docs/plan/_src/build.sh`), so the contracts and task ids cannot diverge between them.

# PART 12 · MASTER DEVELOPMENT CHECKLIST

Status legend: ☐ not started · ◐ in progress · ☑ merged to `main`.

| Status | ID | Task | Owner | Pri | Depends on | Milestone |
|---|---|---|---|---|---|---|
| ☐ | DOM-001 | Repository bootstrap and workspace scaffold | Dominic | P0 | none | M0 |
| ☐ | DOM-002 | Shared contracts package | Dominic | P0 | DOM-001 | M0 |
| ☐ | DOM-003 | Server foundation, DB schema, seed | Dominic | P0 | DOM-002 | M1 |
| ☐ | DOM-004 | Authentication and RBAC | Dominic | P0 | DOM-003 | M1 |
| ☐ | DOM-005 | Region loader, road graph, routing | Dominic | P0 | DOM-002 | M1 |
| ☐ | DOM-006 | World state, operations, sim engine | Dominic | P0 | DOM-003, 005 | M1 |
| ☐ | DOM-007 | Realtime WebSocket hub | Dominic | P0 | DOM-004, 006 | M1 |
| ☐ | DOM-008 | Hazard models: flood, earthquake, damage | Dominic | P0 | DOM-006 | M2 |
| ☐ | DOM-009 | Signals → incidents, unit movement, metrics | Dominic | P0 | DOM-006 | M2 |
| ☐ | DOM-010 | Dispatch and EMS decision engine | Dominic | P0 | DOM-005, 009 | M2 |
| ☐ | DOM-011 | Rules engine and action pipeline | Dominic | P0 | DOM-004, 010 | M2 |
| ☐ | DOM-012 | Grid model and utility isolation | Dominic | P0 | DOM-008, 011 | M2 |
| ☐ | DOM-013 | Restoration prioritization engine | Dominic | P0 | DOM-005, 008 | M3 |
| ☐ | DOM-014 | Work orders | Dominic | P0 | DOM-011, 013 | M3 |
| ☐ | DOM-015 | Rules administration, inject hardening | Dominic | P1 | DOM-011 | M4 |
| ☐ | DOM-016 | Deployment | Dominic | P1 | M2 | M4 |
| ☐ | DOM-017 | Golden-run determinism and perf tests | Dominic | P1 | MUS-007, 008 | M5 |
| ☐ | DOM-018 | Tornado hazard model | Dominic | P1 | DOM-008 | M4 |
| ☐ | DOM-019 | Hurricane hazard model | Dominic | P2 | DOM-018 | after M4 |
| ☐ | DOM-020 | Operation recording, rewind, export | Dominic | P2 | DOM-007 | after M4 |
| ☐ | THA-001 | Visual direction and design system | Thant | P0 | DOM-001 | M1 |
| ☐ | THA-002 | App shell, routing, mode theming | Thant | P0 | THA-001 | M1 |
| ☐ | THA-003 | 3D map scene foundation | Thant | P0 | THA-002 | M1 |
| ☐ | THA-004 | Static region layers | Thant | P0 | THA-003 | M2 |
| ☐ | THA-005 | Hazard layers: flood and earthquake | Thant | P0 | THA-003 | M2 |
| ☐ | THA-006 | Live operations layers | Thant | P0 | THA-003 | M2 |
| ☐ | THA-007 | Scenario launcher, transport, timeline | Thant | P0 | THA-002 | M2 |
| ☐ | THA-008 | Action stream and decision cards | Thant | P0 | THA-002 | M2 |
| ☐ | THA-009 | Context drawer: incidents, units, facilities, signals | Thant | P0 | THA-002 | M2 |
| ☐ | THA-010 | Restoration view and work orders | Thant | P0 | THA-002, 003 | M3 |
| ☐ | THA-011 | Status strip, metrics, beats, camera | Thant | P0 | THA-003 | M2 |
| ☐ | THA-012 | Sign-in screen and persona switch | Thant | P0 | THA-001 | M1 |
| ☐ | THA-013 | Utility panel and rules console | Thant | P1 | THA-008 | M4 |
| ☐ | THA-014 | What-if inject tools | Thant | P1 | THA-006 | M4 |
| ☐ | THA-015 | AI briefing and copilot panel | Thant | P1 | THA-002, MUS-010 | M4 |
| ☐ | THA-016 | States, responsiveness, accessibility | Thant | P1 | THA-007 to 011 | M4 |
| ☐ | THA-017 | Demo polish | Thant | P1 | M3 | M5 |
| ☐ | THA-018 | Optional visual extensions | Thant | P2 | DOM-018, MUS-012/015/017 | after M4 |
| ☐ | MUS-001 | Client core with mock v0 | Muste | P0 | DOM-002 | Mock v0 |
| ☐ | MUS-002 | Mock engine: both scenarios | Muste | P0 | MUS-001 | M2 |
| ☐ | MUS-003 | Region pack builder and Portland pack | Muste | P0 | DOM-002 | M2 |
| ☐ | MUS-004 | Intel foundation: provider, cache, fallback, plugin | Muste | P0 | DOM-002 | M2 |
| ☐ | MUS-005 | Signal fusion | Muste | P0 | MUS-004 | M2 |
| ☐ | MUS-006 | 911 call triage | Muste | P0 | MUS-004 | M2 |
| ☐ | MUS-007 | Flash-flood demo scenario | Muste | P0 | MUS-003; DOM-006, 008 | M2 |
| ☐ | MUS-008 | Earthquake demo scenario | Muste | P0 | MUS-003, 007; DOM-008, 010, 013 | M3 |
| ☐ | MUS-009 | Live transport integration and hardening | Muste | P0 | MUS-001, DOM-007 | M1 |
| ☐ | MUS-010 | Briefing, narratives, copilot | Muste | P1 | MUS-004, DOM-009 | M4 |
| ☐ | MUS-011 | Live feed adapters (NWS, USGS) | Muste | P1 | MUS-004, DOM-009 | M4 |
| ☐ | MUS-012 | Public outputs and connector formatters | Muste | P1 | MUS-004, DOM-011 | M4 |
| ☐ | MUS-013 | Demo director and runbook | Muste | P1 | MUS-007, 008, 009 | M5 |
| ☐ | MUS-014 | End-to-end smoke tests | Muste | P1 | M2, M3 | M4 |
| ☐ | MUS-015 | After-action report | Muste | P2 | MUS-010 | after M4 |
| ☐ | MUS-016 | Field report intake with image understanding | Muste | P2 | MUS-005 | after M4 |
| ☐ | MUS-017 | Tornado and hurricane scenarios | Muste | P2 | DOM-018, 019 | after M4 |

**Milestone gates:** ☐ M0 contract freeze · ☐ Mock v0 · ☐ M1 walking skeleton · ☐ M2 flood vertical slice · ☐ M3 restoration and earthquake · ☐ M4 feature freeze · ☐ M5 demo lock
