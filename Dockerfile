# syntax=docker/dockerfile:1

# Pin to a minor line: same runtime family as local dev (bun 1.3.x),
# debian-based so ffmpeg is an apt install away.
FROM oven/bun:1.3 AS base
WORKDIR /app

# ffmpeg + ffprobe are required by the stitch path and WAV normalization.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg curl \
 && rm -rf /var/lib/apt/lists/*

# Install ALL deps (dev included): vite/tailwind build the client, and
# drizzle-kit is needed at container start to push the schema.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# App source, then build the SPA into ./dist (server.ts serves it).
COPY . .
RUN bun run build:client

# Railway routes to 0.0.0.0:$PORT — HOST must not stay on its loopback
# default. PORT is injected by Railway; 3000 is the local default.
ENV HOST=0.0.0.0 \
    NODE_ENV=production
EXPOSE 3000

# Boot: push the schema (idempotent on a fresh DB), then start the server.
# If the database isn't reachable yet the process exits and Railway's
# restart policy retries.
CMD ["sh", "-c", "bun run db:push && bun run src/server.ts"]
