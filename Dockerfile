# syntax=docker/dockerfile:1

# Pin to a minor line: same runtime family as local dev (bun 1.3.x),
# debian-based so ffmpeg is an apt install away.
FROM oven/bun:1.3 AS base
WORKDIR /app

# ffmpeg + ffprobe are required by the stitch path and WAV normalization.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg curl \
 && rm -rf /var/lib/apt/lists/*

# Install ALL deps (dev included): vite/tailwind build the client, and the
# migration runner reads drizzle.config.ts, which imports drizzle-kit.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# App source, then build the SPA into ./dist (server.ts serves it).
# .storage is the local-storage fallback when R2 is not configured; it is the
# only path under /app the server writes, so it is the only one the
# unprivileged runtime user owns.
COPY . .
RUN bun run build:client \
 && mkdir -p .storage \
 && chown bun:bun .storage

# Railway routes to 0.0.0.0:$PORT — HOST must not stay on its loopback
# default. PORT is injected by Railway; 3000 is the local default.
ENV HOST=0.0.0.0 \
    NODE_ENV=production
EXPOSE 3000

# The oven/bun image ships an unprivileged `bun` user (uid 1000).
USER bun

# Boot: apply migrations (generated via `bun run db:generate`), then start the server.
# src/migrate.ts holds a Postgres advisory lock while migrating, so replicas that boot
# together apply each migration once instead of racing on the same DDL.
# `exec` replaces the shell, so the server is PID 1 and gets SIGTERM directly for its
# graceful shutdown. `drizzle-kit push` is for local dev only — it is interactive and
# can be destructive. If the database isn't reachable yet the process exits and
# Railway's restart policy retries.
CMD ["sh", "-c", "bun run src/migrate.ts && exec bun run src/server.ts"]
