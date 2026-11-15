# Deploying Bastion

One container, one URL. The Fastify server serves the API (`/api/*`), the realtime socket (`/ws`), the public feeds (`/public/*`) and the built web app (everything else).

## What a host must provide

- Run a Docker image and route HTTP **and WebSocket** traffic to one port.
- Environment variables (below).
- Nothing else. No database service, no build step outside the image, no second process.

The server holds each running exercise in memory, so run **one instance**. Do not scale horizontally and do not let the host put the service to sleep during the pitch.

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

Any host that runs a Dockerfile works. [`render.yaml`](../render.yaml) is a starting blueprint for Render; it has **not** been tried against a live account yet. Whatever the host:

1. Point it at this repository and the `Dockerfile`.
2. Set `JWT_SECRET` and `SEED_DEMO_PASSWORD`.
3. Set the health check to `/api/health`.
4. Make sure the instance does not idle to zero, and that it is a single instance.
5. Run `pnpm smoke <url>`.

## Pitch day

- Present from a laptop running the app locally, with the deployed URL as the link for judges. Venue Wi-Fi then cannot break the demo.
- `INTEL_MODE=cache` plays the scenarios with recorded AI answers and no network calls.
- The app at `/` (in-browser engine) needs no server at all and is the last-resort fallback.
- Reset, then run both scenarios once on the machine and display you will present from.
