## 1. The application

**Working codename: BASTION** (display name is Thant's call; package scope stays `@bastion/*`).

**Pitch.** A 3D disaster operations platform that lets government emergency teams simulate the hazards their region faces, dispatch responders and coordinate protective actions during a real emergency, and prioritize which roads and services to restore first.

**Users.** Emergency-operations-centre staff of a regional government:

| Persona | Role key | What they do in the product |
|---|---|---|
| EOC operator | `operator` | Watches the 3D map, approves / overrides dispatches, shelters, closures |
| Recovery coordinator | `coordinator` | Compares restoration options, issues and tracks work orders |
| Utility operator | `utility_operator` | Owns grid-isolation rules and utility actions |
| Administrator | `admin` | Configures rules and autonomy levels, everything else |
| Observer | `observer` | Read-only (judges, elected officials) |

**Three pillars.**

1. **Simulate (training).** Launch a flash flood, earthquake, tornado or hurricane on the region's real 3D map. Inject what-ifs: close a bridge, cut a hospital's power, make two incidents compete for one crew. Everything runs in an *exercise* operation; actions are sandboxed and never leave it.
2. **Act (live).** Signals (official alerts, sensors, imagery, field reports, 911 calls) are fused by AI into incidents. Under agency-approved rules the platform dispatches rescue crews, assigns ambulances to triaged calls, activates shelters and publishes confirmed road closures. The utility's own rules can isolate endangered grid sections. Every action is explainable, audited and overridable by an authorized operator.
3. **Restore.** The platform ranks road-clearance and repair options by who regains access to hospitals, shelters and cut-off neighbourhoods. A coordinator turns an option into a work order and tracks it through inspection and reopening.

**Stage demo (the thing we are actually building toward).**

- *Act 1, flash flood.* Warning arrives, creek gauges climb, water rises across the 3D city. Three separate signals are fused into one water-rescue incident and a swift-water crew is auto-dispatched. A 911 medical call is triaged and an ambulance is routed around flooded streets. The utility rule isolates a threatened feeder section. Water recedes; debris has cut a neighbourhood off from its hospital; the platform recommends the one road clearance that restores access; a work order runs to reopening.
- *Act 2, earthquake, same region.* A bridge is damaged and a hospital loses grid power. The same engine now sends *different* crews (the nearest one cannot cross the river), diverts ambulances to a different hospital, and ranks a *different* road first.

**Guiding principle.** Looking impressive on stage beats realism. The simulation core is deterministic and seeded so the demo plays identically every time; AI sits on top of it with cached fallbacks so a network hiccup never breaks the show.

## 2. Architecture

One TypeScript monorepo, one server process, one web app. No microservices, no message broker, no cloud database.

```
Browser (apps/web, Thant)
  React + Vite + TS · Mapbox GL JS v3 (Standard 3D style) + deck.gl overlay
        │ consumes typed hooks only
        ▼
@bastion/client (packages/client, Muste)
  REST client · WebSocket client · zustand world store · mock engine
        │ HTTP /api/*  +  WS /ws
        ▼
@bastion/server (apps/server, Dominic)                      @bastion/intel (packages/intel, Muste)
  Fastify · SQLite · in-memory world per operation   ◄────►  Claude-backed fusion / triage / briefing,
  sim engine → hazards → incidents → decision engine          live feed adapters, public outputs,
  → rules/policy → action pipeline → audit                    mounted as a Fastify plugin
  routing graph · grid model · restoration · work orders
        ▲
        │ loads at boot
data/regions/* , data/scenarios/*  (Muste)        @bastion/shared (packages/shared, Dominic) = the contracts
```

| Concern | Decision |
|---|---|
| Language / runtime | TypeScript everywhere, Node ≥ 22 (team machine has 24), ESM |
| Workspace | pnpm workspaces (`corepack enable`). Internal packages export TS source directly; no build step between packages. Server runs with `tsx`. |
| Frontend | React + Vite. Mapbox GL JS v3 Standard style (3D buildings, terrain, dusk/night light presets, built-in rain) + deck.gl via `MapboxOverlay`. Styling stack is Thant's choice. Fallback map: MapLibre + free tiles if the Mapbox token is a problem. |
| Backend | Fastify 5 + `@fastify/websocket`. Single process holds the live world of each operation in memory and ticks it. |
| Database | SQLite through built-in `node:sqlite` (`DatabaseSync`), plain SQL migrations. Persists users, rules, operations, actions, audit log, work orders. Fallback: `better-sqlite3` (same API shape). World state itself is in memory. |
| Auth | Email + password for seeded demo accounts, JWT bearer (`Authorization: Bearer`, `?token=` on the WebSocket), role + authority in the token, permission guard per route. |
| API style | REST for commands and static data, one WebSocket for world state (`snapshot` then per-tick `patch`). Every payload is a zod schema in `@bastion/shared`. |
| AI | Claude via the Anthropic SDK behind an `LLMProvider` interface. `INTEL_MODE=live|cache|off`. Fast model for fusion and triage, deep model for briefings and narratives. Deterministic rule-based fallback always available. |
| Spatial index | H3 resolution 10 hex cells (about 66 m edge) carry hazard intensity and population. |
| Region | A *region pack* (static JSON) makes the platform configurable per region. Demo pack: **Portland, Oregon** (Johnson Creek flash flood; Willamette bridges for the earthquake). Swappable. |
| State management (web) | Server state only through `@bastion/client` hooks. UI-local state (selection, panels, camera) in Thant's own store. |
| Deployment | One container: Fastify serves the API, the WebSocket and the built web app. Host on Render / Fly / Railway. Demo can always run from a laptop. |
| Tests | Vitest unit tests per package, golden-run determinism tests for the two demo scenarios, Playwright smoke test of both demo journeys. CI: typecheck, lint, test, build. |

**Core runtime loop (server, every tick, default 1 Hz wall-clock, sim speed 1x to 60x):**

1. Scenario runner emits due timeline events (signals, injects, hazard phases, beats).
2. Hazard models update per-cell intensity (flood depth, shaking) and derive damage: flooded or blocked roads, bridge states, facility power.
3. New signals go to `IntelPort.fuse` → incident candidates → incident manager confirms / merges.
4. Decision engine proposes actions (dispatch, ambulance, shelter, closure, grid isolation), each with an explanation and alternatives.
5. Rules engine decides per action: auto-execute, hold for approval, or drop. Executor applies approved actions to the world (sandboxed in exercise mode) and writes the audit log.
6. Units advance along routes; incidents progress; metrics update; restoration analysis recomputes when the road graph changes.
7. The diff since the last tick is broadcast as one `tick` message.

## 3. Repository layout and file ownership

```
/                                   owner
├─ package.json, pnpm-workspace.yaml, pnpm-lock.yaml, tsconfig.base.json     Dominic
├─ .gitignore, .editorconfig, .prettierrc, eslint.config.js, .nvmrc          Dominic
├─ .env.example, Dockerfile, render.yaml, .github/** (CI, CODEOWNERS)        Dominic
├─ docs/plan/**                                                              Dominic
├─ packages/shared/     @bastion/shared   contracts: zod schemas, types      Dominic
├─ apps/server/         @bastion/server   backend                            Dominic
├─ apps/web/            @bastion/web      all UI, map, styling               Thant
├─ packages/client/     @bastion/client   data layer for the web app         Muste
├─ packages/intel/      @bastion/intel    AI, feeds, public outputs          Muste
├─ tools/region-pack/   @bastion/region-pack   OSM → region pack CLI         Muste
├─ data/regions/**      generated region packs (committed)                   Muste
├─ data/scenarios/**    scenario scripts (schema owned by Dominic)           Muste
├─ data/fixtures/**     mock fixtures, cached AI responses                   Muste
├─ e2e/**               Playwright smoke tests                               Muste
└─ docs/demo/**         demo runbook                                         Muste
```

| Shared / hot file | Single owner | Rule |
|---|---|---|
| `packages/shared/**` (all contracts) | Dominic | Additive-only after the contract freeze. Anyone may *request* a change; only Dominic edits. |
| Root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, lint config, CI | Dominic | Request changes. |
| `pnpm-lock.yaml` | Dominic (nominal) | Everyone regenerates it by running `pnpm install`. **Never hand-merge.** On conflict: take `main`'s copy, run `pnpm install`, commit. |
| `apps/web/package.json`, `apps/web/src/main.tsx`, router, global CSS, design tokens, `vite.config.ts`, `index.html` | Thant | Dominic and Muste do not touch `apps/web/**` at all. |
| `packages/client/package.json`, `packages/intel/package.json`, `tools/region-pack/package.json` | Muste | Each package has its own manifest, so adding a dependency never touches another developer's file. |
| `apps/server/package.json`, `apps/server/src/app.ts` (plugin mounting) | Dominic | Muste's intel plugin is mounted by Dominic with one line. |
| `.env.example` | Dominic | Send the variable name and a one-line description. |
| `data/scenarios/*.json` content | Muste | The `Scenario` schema is in `@bastion/shared` (Dominic). |

**Presentation / logic boundary on the frontend.** `apps/web` never calls `fetch` or opens a WebSocket. It imports hooks from `@bastion/client`. `@bastion/client` never imports a component, never contains JSX markup beyond its provider, and never ships CSS.

**Requesting a change outside your boundary.**

1. Post in the team channel: `CHANGE REQUEST → <owner>: <file or contract>, <what>, <why>, <blocking? y/n>`.
2. The owner makes the change on a small branch of their own and merges it, target within 30 minutes when it is blocking.
3. Until it lands, work against a local shim inside your own package (a local type extension, a mock field). Never edit the owner's file "just this once".
4. Breaking contract changes need a thumbs-up from all three before merge.

## 4. Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `PORT` (default 8787), `CORS_ORIGIN` | server | HTTP listen, dev CORS |
| `DATABASE_PATH` (default `./.data/bastion.sqlite`) | server | SQLite file |
| `JWT_SECRET` | server | Token signing |
| `SEED_DEMO_PASSWORD` | server seed | Password for the seeded demo accounts |
| `REGION_ID` (default `portland`) | server | Region pack loaded at boot |
| `ANTHROPIC_API_KEY` | intel | Claude API key |
| `INTEL_MODE` = `live` \| `cache` \| `off` | intel | Call the API, serve cached responses only, or use rule-based fallback |
| `INTEL_MODEL_FAST`, `INTEL_MODEL_DEEP` | intel | Model ids (defaults `claude-sonnet-5-5`, `claude-fable-5-2`) |
| `FEEDS_ENABLED` | intel | Turn real NWS / USGS polling on |
| `VITE_MAPBOX_TOKEN` | web | Mapbox public token |
| `VITE_API_URL`, `VITE_WS_URL` | web → client | Backend location (empty = same origin) |
| `VITE_MOCK` = `1` | web → client | Run entirely on the in-browser mock engine |

Secrets live in a git-ignored `.env`. Never commit a real key.
