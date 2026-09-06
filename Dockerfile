# =====================================================================
# BeautyAI monorepo container build.
#
# A single root Dockerfile with build targets for the three apps:
#   - api   (Express API, runs via tsx)
#   - admin (React/Vite SPA, static output)
#   - web   (Astro SSR with the Node standalone adapter)
#
# `npm ci` runs once in the `base` stage and is reused by every target.
# =====================================================================

# ---------------------------------------------------------------------
# base: install all workspace dependencies and build the TS packages.
# ---------------------------------------------------------------------
FROM node:22-slim AS base

WORKDIR /app

# Install newer npm to match the lockfile (npm >= 10 required by npm v11 lockfile).
RUN npm install -g npm@11

# Copy the workspace manifests first for better layer caching.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json

# Install all workspace dependencies (the allowScripts field in package.json
# is a local-only config; stock npm runs install scripts normally here).
RUN npm ci --workspaces

# Copy sources.
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps

# Build the TypeScript packages that the apps depend on at runtime.
RUN npm run build --workspace @beautyai/shared
RUN npm run build --workspace @beautyai/db

# ---------------------------------------------------------------------
# api: Express API server (Runs through tsx, matching the project's
# `start` script).
# ---------------------------------------------------------------------
FROM base AS api

WORKDIR /app/apps/api

EXPOSE 4000

ENV NODE_ENV=production
ENV PORT=4000

CMD ["npx", "tsx", "src/server.ts"]

# ---------------------------------------------------------------------
# admin: React/Vite SPA. Build to static assets then serve with a tiny
# Node static server so no extra web-server image is required.
# ---------------------------------------------------------------------
FROM base AS admin

# Vite inlines import.meta.env.VITE_* at build time; set via --build-arg
# (default: the API published on the host at port 4000).
ARG VITE_API_URL=http://localhost:4000/api/v1
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build --workspace @beautyai/admin

COPY apps/admin/serve.mjs /app/apps/admin/dist/serve.mjs
WORKDIR /app/apps/admin/dist

EXPOSE 5173

ENV PORT=5173
CMD ["node", "serve.mjs"]

# ---------------------------------------------------------------------
# web: Astro SSR storefront (Node standalone adapter). The build emits
# dist/server/entry.mjs which is run directly with node.
# ---------------------------------------------------------------------
FROM base AS web

# Astro inlines import.meta.env.PUBLIC_* at build time; set via --build-arg.
ARG PUBLIC_API_URL=http://localhost:4000
ARG PUBLIC_STORE_SLUG=glow-co
ARG PUBLIC_STOREFRONT_URL=http://localhost:4321
ENV PUBLIC_API_URL=$PUBLIC_API_URL
ENV PUBLIC_STORE_SLUG=$PUBLIC_STORE_SLUG
ENV PUBLIC_STOREFRONT_URL=$PUBLIC_STOREFRONT_URL

RUN npm run build --workspace @beautyai/web

WORKDIR /app/apps/web

EXPOSE 4321

ENV HOST=0.0.0.0
ENV PORT=4321
ENV NODE_ENV=production

CMD ["node", "dist/server/entry.mjs"]
