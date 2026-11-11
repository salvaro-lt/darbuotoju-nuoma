# syntax=docker/dockerfile:1.10
#
# One environment-agnostic image per release, built once by CI
# (.github/workflows/release.yml) and pushed to docker.digimuza.ai. Staging and
# production run the same image; nothing environment-specific is baked in.
#
# At container start, apps/web/scripts/start.mjs loads process env + Infisical (when the
# INFISCAL_* bootstrap keys are set) and then starts the Next.js server.
# Coolify sets per environment: APP_ENV and INFISCAL_BASE_URL, INFISCAL_CLIENT_ID,
# INFISCAL_SECRET, INFISCAL_PROJECT_ID, INFISCAL_ENV, INFISCAL_PATH.
#
# Convex is deployed by the workflow (scripts/deploy-convex.ts), not here.

FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# pnpm workspace: install from the manifests plus the workspace packages
# (packages/*, every one linked by the install; a new package needs no change
# here). .dockerignore keeps host node_modules out of the build context.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY packages ./packages
# vendor/ only exists while @digimuza/system-core is consumed as a packed tarball.
COPY apps/web/vendo[r] ./apps/web/vendor/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# start.mjs is bundled because the standalone output has no node_modules for system-core/zod.
RUN pnpm build && pnpm build:start

FROM node:24-alpine AS runtime
# Release metadata, identical on staging and production. /api/health reports it.
ARG APP_VERSION=dev
ARG GIT_SHA=dev
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    APP_VERSION=$APP_VERSION GIT_SHA=$GIT_SHA
LABEL org.opencontainers.image.version=$APP_VERSION org.opencontainers.image.revision=$GIT_SHA
# Monorepo standalone layout: the server is apps/web/server.js under the workspace root.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "apps/web/start.mjs"]
