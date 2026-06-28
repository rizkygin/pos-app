# syntax=docker/dockerfile:1

# ---- Builder ----
FROM node:20-alpine AS builder

WORKDIR /app

# Install all workspace dependencies. Copy the root lockfile/manifest plus each
# workspace manifest first so this layer is cached unless dependencies change.
COPY package*.json ./
COPY apps/frontend/package.json ./apps/frontend/package.json
COPY apps/backend/package.json ./apps/backend/package.json
# Drop the host-generated lockfile so npm resolves the platform-correct native
# binaries for this build image. A lockfile generated on another platform (e.g.
# macOS) omits the linux-musl optional packages (lightningcss, @next/swc, ...),
# which then fail to load at build time.
RUN rm -f package-lock.json && npm install

# Copy the rest of the source
COPY . .

ARG REDIS_URL
ARG BETTER_AUTH_SECRET
ARG BETTER_AUTH_URL
ARG RESEND_API_KEY
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
ARG NEXT_PUBLIC_CLOUDINARY_API_KEY
ARG NEXT_PUBLIC_CLOUDINARY_API_SECRET

# Build only the Next.js frontend workspace (root has no "build" script)
RUN npm run build:frontend

# ---- Runtime ----
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# The standalone build (output: 'standalone') bundles a minimal server.js plus
# only the traced node_modules, so the runtime needs NO npm install. The trace
# root is the monorepo root, so it unpacks to apps/frontend/server.js + a hoisted
# node_modules at the working dir.
COPY --from=builder /app/apps/frontend/.next/standalone ./
# server.js does not copy static/public itself — place them where it serves from.
COPY --from=builder /app/apps/frontend/.next/static ./apps/frontend/.next/static
COPY --from=builder /app/apps/frontend/public ./apps/frontend/public

EXPOSE 3000

CMD ["node", "apps/frontend/server.js"]
