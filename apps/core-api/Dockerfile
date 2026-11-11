# Build from the repository root:
#   docker build -f apps/core-api/Dockerfile -t core-api .
#   docker build -f apps/core-api/Dockerfile --target worker -t core-api-pdf-worker .
FROM node:24.22.2-slim AS builder

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /usr/src/app

COPY package.json package-lock.json ./
COPY apps/core-api/package.json ./apps/core-api/
COPY apps/core-web/package.json ./apps/core-web/
COPY apps/core-api/prisma ./apps/core-api/prisma/

RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --workspace=core-api

COPY apps/core-api ./apps/core-api
COPY locales ./locales

WORKDIR /usr/src/app/apps/core-api

RUN npx prisma generate
RUN npm run build
RUN test -d dist/locales
RUN test -f dist/locales/de/seedMaster.json

# Pinned by digest: v1.65.0-noble ships Node 26 upstream; replace it with exact Node 24.22.2 (AUT-673).
FROM mcr.microsoft.com/playwright:v1.65.0-noble@sha256:6e3fb709361521eb27161606e6da6d2674e5e89fa16516cb37d6fdd91372273d AS worker

ARG PDF_WORKER_NODE_VERSION=24.22.2
ENV PDF_WORKER_NODE_VERSION=${PDF_WORKER_NODE_VERSION}

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get remove -y nodejs npm || true \
    && rm -f /etc/apt/sources.list.d/nodesource.list \
    && apt-get autoremove -y \
    && apt-get install -y --no-install-recommends curl ca-certificates xz-utils \
    && curl -fsSL "https://nodejs.org/dist/v${PDF_WORKER_NODE_VERSION}/node-v${PDF_WORKER_NODE_VERSION}-linux-x64.tar.xz" \
      | tar -xJ -C /usr/local --strip-components=1 \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/usr/local/bin:${PATH}"

COPY apps/core-api/scripts/verify-pdf-worker-node.sh /usr/local/bin/verify-pdf-worker-node.sh
RUN chmod +x /usr/local/bin/verify-pdf-worker-node.sh \
    && verify-pdf-worker-node.sh

WORKDIR /usr/src/app

ENV NODE_ENV=production
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
COPY apps/core-api/package.json ./apps/core-api/
COPY apps/core-web/package.json ./apps/core-web/

RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --omit=dev --workspace=core-api --include-workspace-root=false && npm cache clean --force

COPY --from=builder /usr/src/app/apps/core-api/dist ./apps/core-api/dist
COPY --from=builder /usr/src/app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /usr/src/app/apps/core-api/prisma ./apps/core-api/prisma
COPY apps/core-api/scripts/pdf-worker-image-smoke.mjs ./apps/core-api/scripts/pdf-worker-image-smoke.mjs

WORKDIR /usr/src/app/apps/core-api

RUN verify-pdf-worker-node.sh

EXPOSE 3000

CMD ["node", "dist/main.js"]

FROM node:24.22.2-slim AS api

WORKDIR /usr/src/app

ENV NODE_ENV=production
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
COPY apps/core-api/package.json ./apps/core-api/
COPY apps/core-web/package.json ./apps/core-web/

RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --omit=dev --workspace=core-api --include-workspace-root=false && npm cache clean --force

COPY --from=builder /usr/src/app/apps/core-api/dist ./apps/core-api/dist
COPY --from=builder /usr/src/app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /usr/src/app/apps/core-api/prisma ./apps/core-api/prisma

WORKDIR /usr/src/app/apps/core-api

EXPOSE 3000

CMD ["node", "dist/main.js"]
