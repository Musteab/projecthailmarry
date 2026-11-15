# Deploying Bastion

One container, one URL. The Fastify server serves the API (`/api/*`), the realtime socket (`/ws`), the public feeds (`/public/*`) and the built web app (everything else).

## What a host must provide

- Run a Docker image and route HTTP **and WebSocket** traffic to one port.
- Environment variables (below).
- Nothing else. No database service, no build step outside the image, no second process.

The server holds each running exercise in memory, so run **one instance**. Do not scale horizontally. Free Render services sleep after 15 minutes without inbound traffic; open and verify the app before the pitch. A restart loses in-memory exercises.

## Environment

| Variable             | Required | Notes                                                                                            |
| -------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `JWT_SECRET`         | yes      | At least 32 random characters. The server refuses to start in production without it.             |
| `SEED_DEMO_PASSWORD` | yes      | At least 8 characters. Password of the five demo accounts. Share it with the team, not the repo. |
| `PORT`               | no       | Injected by most hosts. The start command maps it to `API_PORT`; default 8787.                   |
| `INTEL_MODE`         | no       | `cache` (default in the image), `off`, or `live` with `ANTHROPIC_API_KEY`.                       |
| `DATABASE_PATH`      | no       | Default `/app/.data/bastion.sqlite`. Mount a volume there to keep accounts, rules and audit.     |

The image already sets `NODE_ENV=production`, `API_HOST=0.0.0.0` and `INTEL_MODE=cache`.

Without a volume the SQLite file is lost on every restart. That is fine for a demo: accounts and rules are reseeded at boot, and exercises live in memory either way.

## Run the production build locally

With Docker:

```sh
docker build -t bastion .
docker run --rm -p 8787:8787 -e JWT_SECRET=<32+ random characters> -e SEED_DEMO_PASSWORD=<8+ characters> bastion
```

Without Docker:

```sh
pnpm build
# then, with NODE_ENV=production, JWT_SECRET and SEED_DEMO_PASSWORD set in the environment or in .env:
pnpm start
```

Open http://localhost:8787 for the app on its in-browser engine, or http://localhost:8787/?backend=server to drive the real server (sign in with a demo account).

## Check a deployment

```sh
SMOKE_PASSWORD=<the demo password> pnpm smoke https://your-app.example
```

It checks health, that the web app is served, sign-in, the scenario catalogue, the region pack, creating and starting an exercise, a WebSocket snapshot followed by ticks, and ending the exercise. It exits non-zero at the first failure and says which step failed. If the WebSocket step fails while the others pass, the host's proxy is not forwarding upgrades.

## Reset between rehearsals

As the administrator:

```sh
curl -X POST https://your-app.example/api/admin/demo-reset -H "Authorization: Bearer <admin token>"
```

This ends every exercise, restores the demo accounts and puts the agency rules back to their defaults. Restarting the service does the same for exercises, and for everything if there is no volume.

## Hosts

The prepared [`render.yaml`](../render.yaml) explicitly selects Render **Free**. The Docker image also disables external feeds for the exercise. Free instances have no persistent disk; account/rule changes and audit records are lost on restart. This is a demo deployment. See [Render free-service limits](https://render.com/docs/free).

For the dashboard setup:

1. Point it at this repository and the `Dockerfile`.
2. Set `JWT_SECRET` and `SEED_DEMO_PASSWORD`.
3. Select the Docker runtime, branch `main`, and health check `/api/health`.
4. Select **Free ($0)** and one instance. Wake the service and rehearse before recording.
5. Run `pnpm smoke <url>`.

## Pitch day

- Present from a laptop running the app locally, with the deployed URL as the link for judges. Venue Wi-Fi then cannot break the demo.
- `INTEL_MODE=cache` plays the scenarios with labelled rehearsal fixtures and deterministic fallbacks, with no model calls.
- The app at `/` (in-browser engine) needs no server at all and is the last-resort fallback.
- Reset, then run both scenarios once on the machine and display you will present from.

## Automated browser verification

`node apps/web/node_modules/@playwright/test/cli.js test --config e2e/playwright.config.mjs` covers the mock scene and real server through repair reopening. The CI browser job is initially advisory. See `e2e/README.md` for browser installation and repeat runs.

Action and work-order IDs include the operation and reset generation. Rehearsals can share a server without commands targeting an earlier exercise; stale command IDs after reset return 404. The administrator demo-reset endpoint ends and removes all in-memory exercises.

The 2:45 recording script with screen directions is in [docs/demo/VIDEO_SCRIPT.md](demo/VIDEO_SCRIPT.md). Low-priority MUS-015–017 remain deferred.
