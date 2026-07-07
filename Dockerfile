# Self-host image: app + Postgres 16 + s6-overlay, one mounted /app/data volume.
# Run with:
#   docker run -d -p 3000:3000 -v logbook-data:/app/data \
#     -e SESSION_SECRET=... ghcr.io/scottprue/logbook:latest

ARG NODE_VERSION=24
ARG S6_OVERLAY_VERSION=3.2.0.2

# -------- Stage 1: build the app --------
FROM node:${NODE_VERSION}-alpine AS build

WORKDIR /build

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# -------- Stage 2: runtime (Postgres + Node + app) --------
FROM postgres:18-alpine AS runtime

ARG NODE_VERSION
ARG S6_OVERLAY_VERSION
ENV NODE_ENV=production
ENV PGDATA=/app/data/postgresql
ENV UPLOADS_DIR=/app/data/uploads
ENV DATABASE_URL=postgresql://postgres:postgres@localhost:5432/logbook

# Install Node and fetch tools
RUN apk add --no-cache \
  nodejs=~${NODE_VERSION} \
  npm \
  curl \
  xz \
  bash \
  tini

# s6-overlay (multi-service supervisor)
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz /tmp/
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-x86_64.tar.xz /tmp/
RUN tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz \
  && tar -C / -Jxpf /tmp/s6-overlay-x86_64.tar.xz \
  && rm /tmp/s6-overlay-*.tar.xz

# App files
WORKDIR /app
COPY --from=build /build/.output /app/.output
COPY --from=build /build/app/db/migrations /app/migrations
COPY --from=build /build/package.json /app/package.json

# s6 service definitions
COPY docker/s6-rc.d /etc/s6-overlay/s6-rc.d

# Data volume: Postgres cluster + uploaded files live here
VOLUME ["/app/data"]

EXPOSE 3000

ENTRYPOINT ["/init"]
