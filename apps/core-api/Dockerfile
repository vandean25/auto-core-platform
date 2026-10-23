# Build from the repository root:
#   docker build -f apps/core-api/Dockerfile -t core-api .
#   docker build -f apps/core-api/Dockerfile --target worker -t core-api-pdf-worker .
FROM node:24.22.1-slim AS builder

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

FROM mcr.microsoft.com/playwright:v1.64.1-noble AS worker

RUN apt-get update && apt-get install -y --only-upgrade nodejs && rm -rf /var/lib/apt/lists/*

RUN node -e "const [a,b,c]=process.versions.node.split('.').map(Number); if (a!==24 || b<22 || (b===22 && c<1)) { console.error('Node ' + process.version + ' is below 24.22.1 or not 24.x'); process.exit(1) }"

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

FROM node:24.22.1-slim AS api

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
