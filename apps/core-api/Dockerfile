# Build from the repository root:
#   docker build -f apps/core-api/Dockerfile -t core-api .
#   docker build -f apps/core-api/Dockerfile --target worker -t core-api-pdf-worker .
FROM node:26-slim AS builder

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /usr/src/app

COPY package.json package-lock.json ./
COPY apps/core-api/package.json ./apps/core-api/
COPY apps/core-web/package.json ./apps/core-web/
COPY apps/core-api/prisma ./apps/core-api/prisma/

RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --workspace=core-api

COPY apps/core-api ./apps/core-api

WORKDIR /usr/src/app/apps/core-api

RUN npx prisma generate
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.62.1-jammy AS worker

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

FROM node:26-slim AS api

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
