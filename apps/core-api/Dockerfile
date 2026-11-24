# Build from the repository root:
#   docker build -f apps/core-api/Dockerfile -t core-api .
#   docker build -f apps/core-api/Dockerfile --target worker -t core-api-pdf-worker .
FROM node:26.13.1-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS builder

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

# Slimmer Chromium-only worker image (AUT-1038): starts from the exact .nvmrc Node 26.13.1-slim digest
# instead of the multi-browser Playwright image (which bundles Firefox, WebKit, and full Chromium).
FROM node:26.13.1-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS worker

COPY .nvmrc /usr/local/etc/nvmrc
COPY apps/core-api/scripts/verify-pdf-worker-node.sh /usr/local/bin/verify-pdf-worker-node.sh
RUN chmod +x /usr/local/bin/verify-pdf-worker-node.sh \
    && verify-pdf-worker-node.sh

WORKDIR /usr/src/app

ENV NODE_ENV=production
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json ./
COPY apps/core-api/package.json ./apps/core-api/
COPY apps/core-web/package.json ./apps/core-web/

RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --omit=dev --workspace=core-api --include-workspace-root=false \
    && npm cache clean --force \
    && ./node_modules/.bin/playwright install-deps chromium \
    && ./node_modules/.bin/playwright install chromium --only-shell \
    && rm -rf /var/lib/apt/lists/* /tmp/*

COPY --from=builder /usr/src/app/apps/core-api/dist ./apps/core-api/dist
COPY --from=builder /usr/src/app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /usr/src/app/apps/core-api/prisma ./apps/core-api/prisma
COPY apps/core-api/scripts/pdf-worker-image-smoke.mjs ./apps/core-api/scripts/pdf-worker-image-smoke.mjs

WORKDIR /usr/src/app/apps/core-api

RUN verify-pdf-worker-node.sh

EXPOSE 3000

CMD ["node", "dist/worker-main.js"]

FROM node:26.13.1-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS api

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
