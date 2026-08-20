# Build from the repository root:
#   docker build -f apps/core-api/Dockerfile -t core-api .
FROM node:20-slim AS builder

WORKDIR /usr/src/app

COPY package.json package-lock.json ./
COPY apps/core-api/package.json ./apps/core-api/
COPY apps/core-web/package.json ./apps/core-web/
COPY apps/core-api/prisma ./apps/core-api/prisma/

RUN npm ci --workspace=core-api --include-workspace-root=false

COPY apps/core-api ./apps/core-api

WORKDIR /usr/src/app/apps/core-api

RUN npx prisma generate
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.51.0-jammy AS runner

WORKDIR /usr/src/app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/core-api/package.json ./apps/core-api/
COPY apps/core-web/package.json ./apps/core-web/

RUN npm ci --omit=dev --workspace=core-api --include-workspace-root=false && npm cache clean --force

COPY --from=builder /usr/src/app/apps/core-api/dist ./apps/core-api/dist
COPY --from=builder /usr/src/app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /usr/src/app/apps/core-api/prisma ./apps/core-api/prisma

WORKDIR /usr/src/app

RUN npm exec --workspace=core-api -- playwright install chromium

WORKDIR /usr/src/app/apps/core-api

EXPOSE 3000

CMD ["node", "dist/src/main.js"]
