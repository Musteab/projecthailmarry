# projecthailmarry

A 3D disaster operations platform for government emergency teams to run regional exercises, coordinate live response, and decide which roads and essential services to restore first.

## What we're building

- **Regional exercises.** Rehearse flash floods, hurricanes, tornadoes, and earthquakes using a map of local roads, hospitals, shelters, and utility assets. Exercise actions stay in the training environment.
- **Emergency response.** Combine official alerts, sensor readings, imagery, and field reports. Under agency-approved rules, the platform can assign rescue crews, route medically triaged calls through the official ambulance dispatch system, and track road closures and shelter openings. The utility controls any automatic power isolation and operator override.
- **Recovery planning.** Compare road clearance options by how many residents regain access to hospitals, shelters, and isolated neighborhoods. Turn a selected repair into a work order and track it through reopening.

## Hackathon demo

Replay a flash flood on a fictional district map. A field report confirms that a road is blocked. The platform assigns a rescue crew, records a simulated utility isolation, and identifies which road clearance would restore hospital access to the most residents. Replay the exercise with an earthquake scenario to show how the same workflow handles different damage and priorities.

## Getting started

Requirements: Node 22 or newer, and pnpm 10.

```sh
git clone https://github.com/Musteab/projecthailmarry.git
cd projecthailmarry
npm install -g pnpm@10
pnpm install
```

(`corepack enable` also provides pnpm, but on Windows it needs an administrator terminal.)

| Command          | What it does                                                            |
| ---------------- | ----------------------------------------------------------------------- |
| `pnpm dev`       | Starts the server on port 8787 and the web app on http://localhost:5173 |
| `pnpm dev:mock`  | Starts only the web app, running on the in-browser mock engine          |
| `pnpm typecheck` | Type-checks every package                                               |
| `pnpm lint`      | Lints the workspace                                                     |
| `pnpm test`      | Runs all unit tests                                                     |
| `pnpm build`     | Builds the web app                                                      |

Copy `.env.example` to `.env` for local settings and keys. `.env` is git-ignored; never commit a real key.

## Repository layout

| Path                          | Package                                                 | Owner   |
| ----------------------------- | ------------------------------------------------------- | ------- |
| `packages/shared`             | `@bastion/shared`: contracts (schemas and types)        | Dominic |
| `apps/server`                 | `@bastion/server`: backend                              | Dominic |
| `apps/web`                    | `@bastion/web`: all UI                                  | Thant   |
| `packages/client`             | `@bastion/client`: data layer and mock engine           | Muste   |
| `packages/intel`              | `@bastion/intel`: AI, feeds, public outputs             | Muste   |
| `tools/region-pack`           | `@bastion/region-pack`: region data builder             | Muste   |
| `data/`, `e2e/`, `docs/demo/` | region packs, scenarios, fixtures, smoke tests, runbook | Muste   |

## Working on this repo

The plan, contracts, file ownership and Git rules are in [`docs/plan/MASTER_PLAN.md`](docs/plan/MASTER_PLAN.md). Each developer starts their Claude Code session by pasting their own brief:

- Dominic: [`docs/plan/PROMPT_A_DOMINIC.md`](docs/plan/PROMPT_A_DOMINIC.md)
- Thant: [`docs/plan/PROMPT_B_THANT.md`](docs/plan/PROMPT_B_THANT.md)
- Muste: [`docs/plan/PROMPT_C_MUSTE.md`](docs/plan/PROMPT_C_MUSTE.md)

In short: one short-lived branch per task (`feat/<name>-<feature>`), small conventional commits, a pull request per task, never force-push, and only edit files you own.
