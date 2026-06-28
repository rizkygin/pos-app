# syntax=docker/dockerfile:1
# Self-contained image for the Fastify backend. Build context is apps/backend,
# so this image is fully decoupled from the frontend workspace.

# ---- Builder: compile TypeScript -> dist ----
FROM node:20-alpine AS builder

WORKDIR /app

# Install production deps plus a standalone TypeScript compiler. We deliberately
# avoid `npm install` of the full devDependencies because tsx + drizzle-kit pull
# in conflicting esbuild versions whose postinstall fails in CI. tsc only needs
# the `typescript` package. Dropping the host lockfile lets npm resolve the
# linux-musl native binaries (sharp) for this build image.
COPY package.json ./
RUN rm -f package-lock.json \
    && npm install --omit=dev \
    && npm install --no-save --no-package-lock typescript@5.9.3

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json

# ---- Runtime ----
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# Production dependencies only (no tsx/esbuild/typescript). Same platform-correct
# native binary resolution as the builder.
COPY package.json ./
RUN rm -f package-lock.json && npm install --omit=dev

# Compiled server + SQL migrations (migrate.ts compiles to dist/db/migrate.js and
# reads ./drizzle relative to cwd, so it runs with plain `node`, no tsx needed).
COPY --from=builder /app/dist ./dist
COPY drizzle ./drizzle

# Uploads are written to process.cwd()/uploads — declare it as a volume so user
# uploads survive container restarts/redeploys.
RUN mkdir -p uploads
VOLUME ["/app/uploads"]

EXPOSE 4000

# Run migrations as a separate deploy step:  node dist/db/migrate.js
CMD ["node", "dist/server.js"]
