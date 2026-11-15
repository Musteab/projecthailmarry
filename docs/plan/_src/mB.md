# PART 3 · MVP FEATURE LIST

**P0, critical (the stage demo fails without it)**

1. Monorepo, contracts, CI (DOM-001, 002).
2. Server foundation, auth and roles (DOM-003, 004; THA-012).
3. Region pack for Portland and the road graph with live routing (MUS-003; DOM-005).
4. Simulation engine, operations in exercise / live mode, WebSocket streaming (DOM-006, 007; MUS-001, 009).
5. Flood and earthquake hazard models with damage (DOM-008).
6. AI signal fusion and 911 triage with safe fallbacks (MUS-004, 005, 006; DOM-009).
7. Explainable dispatch and EMS assignment (DOM-010).
8. Rules engine, approval, override, audit, shelters, closures (DOM-011).
9. Utility grid isolation (DOM-012).
10. Restoration ranking and work orders (DOM-013, 014).
11. The two demo scenarios (MUS-007, 008) and the in-browser mock engine (MUS-002).
12. The whole operations UI: design system, shell, 3D scene, region / hazard / ops layers, launcher and timeline, action stream, context drawer, restoration view, status and beats (THA-001 to 011).

**P1, important (completeness and polish)**

Rules administration (DOM-015, THA-013) · what-if injects UI (THA-014) · briefing and copilot (MUS-010, THA-015) · live NWS / USGS feeds (MUS-011) · public outputs (MUS-012) · deployment (DOM-016) · golden-run tests (DOM-017) · tornado (DOM-018) · demo director and runbook (MUS-013) · E2E smoke (MUS-014) · states, responsive, accessibility (THA-016) · demo polish (THA-017).

**P2, optional (drop without regret)**

Hurricane (DOM-019) · rewind and export (DOM-020) · after-action report (MUS-015) · photo field reports (MUS-016) · extra scenarios (MUS-017) · visual extensions (THA-018).

**If we fall behind, simplify in this order:** (1) drop all P2; (2) drop tornado, live feeds, public outputs, copilot; (3) replace the dispatch optimiser with nearest-reachable-capable-unit while keeping the explanation card; (4) force more of each scenario through injects instead of emergent behaviour; (5) as a last resort run the stage demo on the mock engine, which is why MUS-002 is P0.

# PART 4 · THREE-DEVELOPER RESPONSIBILITY MATRIX

| Area | Dominic (me) | Thant | Muste |
|---|---|---|---|
| Architecture, contracts, repo, CI | **Owns** | consumes | consumes |
| Database, auth, permissions | **Owns** | mirrors gating in UI | `can()` in client |
| Simulation engine, hazard models | **Owns** | visualises | supplies scenarios |
| Road graph, routing | **Owns** | draws routes | supplies graph data |
| Dispatch / EMS decision engine | **Owns** | decision cards | narratives |
| Rules, action pipeline, audit | **Owns** | action stream, rules console | hooks |
| Grid model and isolation | **Owns** | grid layers and panel | synthetic grid data |
| Restoration and work orders | **Owns** | restoration view | narratives, hooks |
| WebSocket and REST server | **Owns** | none | client transport |
| Visual direction, design system | none | **Owns** | none |
| Pages, layout, components, animation | none | **Owns** | none |
| 3D map scene and every layer | none | **Owns** | none |
| Client data layer and mock engine | none | consumes | **Owns** |
| AI: fusion, triage, briefing, copilot | port definition, fallback stub | panels | **Owns** |
| External feeds and public outputs | mounts plugin | optional public page | **Owns** |
| Region data pipeline and packs | loader | renders | **Owns** |
| Scenario scripts, beats, camera cues | schema and runner | renders beats | **Owns** |
| Demo director, runbook, E2E | golden runs | presentation mode | **Owns** |
| Deployment | **Owns** | build config of web | smoke check |

**Why it is split this way.**

- **Dominic takes the long, coupled backend chain** (engine → hazards → incidents → decisions → rules → grid → restoration → work orders). These modules share one in-memory world and one tick loop; splitting them between people would mean constant edits to the same files. Fourteen of my twenty tasks are P0 and I am the critical path, which is deliberate: it is the part that needs one architectural head.
- **Thant owns a whole application directory**, not a slice of files inside shared ones. The UI is judged first and hardest, so it gets a full-time owner who is never blocked: every screen is built against the mock engine. Twelve P0 tasks, all independent of backend progress.
- **Muste owns four self-contained packages**, each a real feature with its own manifest: the data layer that decouples Thant from me, the AI that is our headline claim, the data pipeline and screenplay that everything else renders, and the demo safety net. None of them requires editing a file owned by someone else. Nine P0 tasks, three of which can start in parallel in the first minute after the contract freeze.
- Balance is by complexity and risk, not count: Dominic 20 tasks (6 Large), Thant 18 (5 Large), Muste 17 (4 Large).
