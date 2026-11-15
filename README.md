# Bastion

A 3D disaster operations platform for government emergency teams: rehearse the hazards a region faces, coordinate the response as an emergency unfolds, and decide which roads and services to restore first.

Built for a hackathon by Dominic (architecture and backend), Thant (UI) and Muste (data layer, AI, scenarios).

## What it does

- **Simulate.** Play a flash flood, earthquake, tornado or hurricane on a region's real road network. Break things on purpose: close a bridge, cut a hospital's power, take a crew out of service. Exercises are sandboxed; nothing leaves the training environment.
- **Act.** Alerts, sensor readings, imagery, field reports and 911 calls are fused into incidents. Under rules each agency has approved, the platform dispatches rescue crews, assigns ambulances to triaged calls, opens shelters, publishes road closures and isolates endangered grid sections. Every action explains itself, is audited, and can be approved, rejected or overridden by someone with the authority to do so.
- **Restore.** Repairs are ranked by who regains access to hospitals and shelters per crew-hour. A coordinator turns one into a work order and follows it to inspection and reopening.

The stage demo runs a flash flood on Johnson Creek and then an earthquake on the same city, and shows the same engine making different decisions: different crews, a different destination hospital, a different road cleared first.

## Quick start

Requirements: Node 22.13 or newer, and pnpm 10.

```sh
git clone https://github.com/Musteab/projecthailmarry.git
cd projecthailmarry
npm install -g pnpm@10
pnpm install
pnpm dev
```

(`corepack enable` also provides pnpm, but on Windows it needs an administrator terminal.)

`pnpm dev` starts the server on port 8787 and the web app on http://localhost:5173. No `.env` file is needed for local development.

| Open                                  | What you get                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| http://localhost:5173                 | The command table on the in-browser engine. Needs no server, map key or AI key |
| http://localhost:5173/?backend=server | The same UI driven by the real server. Sign in with a demo account             |

### Demo accounts

The server seeds one account per role. They share one password, set by `SEED_DEMO_PASSWORD`; the development default is noted in [`.env.example`](.env.example).

| Email                      | Role                 | May approve or override         | Also                                |
| -------------------------- | -------------------- | ------------------------------- | ----------------------------------- |
| `admin@bastion.demo`       | Administrator        | every agency's actions          | edit all rules, restoration         |
| `operator@bastion.demo`    | EOC operator         | emergency management, fire, EMS | run operations, what-if injects     |
| `coordinator@bastion.demo` | Recovery coordinator | public works                    | restoration ranking and work orders |
| `utility@bastion.demo`     | Utility operator     | the utility's grid actions      | edit the utility's rules            |
| `observer@bastion.demo`    | Observer             | nothing                         | read-only                           |

### Running the demo

Step-by-step scripts, timings and talking points are in [`docs/demo`](docs/demo):

- [`local-command-ui.md`](docs/demo/local-command-ui.md): the 90-second presentation and the controls
- [`flood.md`](docs/demo/flood.md) and [`quake.md`](docs/demo/quake.md): the two acts on the real server, beat by beat
- [`mock-scenarios.md`](docs/demo/mock-scenarios.md): the offline fallback

## Commands

| Command             | What it does                                                    |
| ------------------- | --------------------------------------------------------------- |
| `pnpm dev`          | Server and web app together                                     |
| `pnpm dev:server`   | Server only                                                     |
| `pnpm dev:web`      | Web app only                                                    |
| `pnpm dev:mock`     | Web app on the in-browser engine                                |
| `pnpm typecheck`    | Type-checks every package                                       |
| `pnpm lint`         | Lints the workspace                                             |
| `pnpm test`         | Runs every test, including both demo scenarios on the real data |
| `pnpm build`        | Builds the web app                                              |
| `pnpm format:check` | Checks formatting (`pnpm format` fixes it)                      |

CI runs typecheck, lint, test and build on every pull request.

## How it is built

One TypeScript monorepo, one server process, one web app.

```
Browser  apps/web                 React, 3D scene, panels            (Thant)
            │ typed hooks only
         packages/client          REST + WebSocket client, world store, in-browser mock engine   (Muste)
            │ HTTP /api/*  +  WS /ws
Server   apps/server              Fastify, SQLite, one in-memory world per operation             (Dominic)
            │ IntelPort
         packages/intel           Signal fusion, triage, briefing, copilot, feeds                (Muste)

         packages/shared          The contracts: zod schemas and types every package builds on   (Dominic)
         data/regions, data/scenarios   Region packs and scenario scripts                        (Muste)
```

### The simulation

An operation holds a live world and advances it in fixed one-second steps, so a scenario plays identically whatever the speed. Each step runs this pipeline in order:

1. **Scenario**: fires the scripted signals, injects and narrative beats that are due.
2. **Hazards**: flood depth, earthquake shaking or wind per map cell, and the damage that follows (flooded or blocked roads, bridges, power, building collapses).
3. **Intel**: new signals go to fusion and 911 calls to triage. A slow or failing AI falls back to rules; a step never waits for it.
4. **Grid**: flags threatened feeder sections and proposes isolation; works out what goes dark downstream.
5. **Decisions**: picks the crew that arrives first over roads that are actually open, with the alternatives it rejected.
6. **Protective actions**: road closures, hospital diversion, shelters.
7. **Actions**: the agency's rule decides whether each proposal runs by itself or waits for a person.
8. **Work orders**, **units**, **restoration ranking**, **metrics**.

What changed in a step is sent to browsers as one WebSocket message.

### API

Everything is under `/api`, JSON, with `Authorization: Bearer <token>` except health and login. Errors are always `{ "error": { "code", "message", "details"? } }`. Paths and schemas are exported from `@bastion/shared` (`apiPaths`, `XSchema`).

| Area        | Routes                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| Session     | `POST /auth/login` · `GET /auth/me`                                                                     |
| Catalogue   | `GET /scenarios` · `GET /regions/:id/static`                                                            |
| Operations  | `POST /operations` · `GET /operations` · `GET /operations/:id` · `POST /operations/:id/control`         |
| What-ifs    | `POST /operations/:id/injects` (exercise only) · `POST /operations/:id/signals`                         |
| Actions     | `POST /operations/:id/actions` · `POST /actions/:id/approve` · `/reject` · `/override`                  |
| Rules       | `GET /rules` · `PATCH /rules/:id`                                                                       |
| Restoration | `POST /operations/:id/restoration/analyze` · `GET /operations/:id/restoration/options/:optionId/impact` |
| Work orders | `POST /operations/:id/work-orders` · `POST /work-orders/:id/transition`                                 |
| Audit       | `GET /operations/:id/audit`                                                                             |
| AI          | `POST /intel/operations/:id/briefing` · `POST /intel/operations/:id/copilot`                            |
| Realtime    | `GET /ws?token=` then send `{ "t": "subscribe", "operationId" }`; receive `snapshot`, `tick`, `beat`    |

## Configuration

Copy [`.env.example`](.env.example) to `.env` to change anything. `.env` is git-ignored; never commit a real key.

| Variable                                           | Purpose                                                                       |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| `API_PORT`, `API_HOST`                             | Where the server listens (8787 on 127.0.0.1). Not `PORT`, which dev tools use |
| `JWT_SECRET`, `SEED_DEMO_PASSWORD`                 | Required when `NODE_ENV=production`; development has built-in defaults        |
| `DATABASE_PATH`, `DATA_DIR`, `REGION_ID`           | SQLite file, the folder with regions and scenarios, the preferred region      |
| `INTEL_MODE`                                       | `off` (rules only), `cache` (recorded AI answers), `live` (calls the API)     |
| `ANTHROPIC_API_KEY`, `INTEL_MODEL_*`               | Only needed for `INTEL_MODE=live`                                             |
| `VITE_MAPBOX_TOKEN`, `VITE_API_URL`, `VITE_WS_URL` | Web app settings; empty values use the dev proxy                              |

For a pitch, `INTEL_MODE=cache` gives AI-written text with no network dependency.

## Tests

`pnpm test` runs about 420 tests in under a minute. Beyond unit tests for each engine, it plays both stage-demo scenarios end to end on the Portland data and checks that the story happens, that each scenario plays identically twice, and that a simulation step stays inside its time budget.

## Repository layout

| Path                          | Package                                                  | Owner   |
| ----------------------------- | -------------------------------------------------------- | ------- |
| `packages/shared`             | `@bastion/shared`: contracts (schemas and types)         | Dominic |
| `apps/server`                 | `@bastion/server`: backend                               | Dominic |
| `apps/web`                    | `@bastion/web`: all UI                                   | Thant   |
| `packages/client`             | `@bastion/client`: data layer and mock engine            | Muste   |
| `packages/intel`              | `@bastion/intel`: AI, feeds, public outputs              | Muste   |
| `tools/region-pack`           | `@bastion/region-pack`: region data builder              | Muste   |
| `data/`, `e2e/`, `docs/demo/` | region packs, scenarios, fixtures, smoke tests, runbooks | Muste   |

## Working on this repo

The plan, contracts, file ownership and Git rules are in [`docs/plan/MASTER_PLAN.md`](docs/plan/MASTER_PLAN.md).

In short: one short-lived branch per task (`feat/<name>-<feature>`), small conventional commits, a pull request per task, never force-push, and only edit files you own. Contracts in `packages/shared` are additive-only; ask Dominic for changes.

## Honest limits

- The hazard, grid and triage models are plausible and tunable, not validated engineering or clinical models. The grid topology is synthetic.
- Scripted scenarios exist for the flash flood and the earthquake. The tornado and hurricane models are in the engine and tested, but have no scenario file yet.
- Nothing is connected to a real dispatch, utility or alerting system. In a live operation the platform records the message it would send; in an exercise it sends nothing.
- Map data is © OpenStreetMap contributors; see [`docs/demo/ATTRIBUTION.md`](docs/demo/ATTRIBUTION.md).
