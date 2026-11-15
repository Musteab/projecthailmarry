# One image, one process: the Fastify server serves the API, the WebSocket and the built web app.
#
#   docker build -t bastion .
#   docker run --rm -p 8787:8787 -e JWT_SECRET=<32+ random chars> -e SEED_DEMO_PASSWORD=<8+ chars> bastion
#
# See docs/DEPLOY.md.
FROM node:22-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install -g pnpm@10.34.9

WORKDIR /app

# Manifests first, so the dependency layer is reused until one of them changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/client/package.json packages/client/
COPY packages/intel/package.json packages/intel/
COPY tools/region-pack/package.json tools/region-pack/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @bastion/web build

ENV NODE_ENV=production
# Listen on every interface inside the container.
ENV API_HOST=0.0.0.0
ENV API_PORT=8787
# Recorded AI answers: no API key and no outbound calls needed. Use `live` with ANTHROPIC_API_KEY.
ENV INTEL_MODE=cache
# The live world of an operation is in memory; this file only holds accounts, rules and the audit
# trail, and is recreated and reseeded if it is missing. Mount a volume here to keep it.
ENV DATABASE_PATH=/app/.data/bastion.sqlite

EXPOSE 8787

# Hosting platforms inject PORT; the server deliberately reads API_PORT (see .env.example).
CMD ["sh", "-c", "API_PORT=${PORT:-$API_PORT} exec pnpm --filter @bastion/server start"]
