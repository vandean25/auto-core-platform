# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma client and build application
RUN npx prisma generate
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS runner

WORKDIR /usr/src/app

ENV NODE_ENV production

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev && npm cache clean --force

# Copy built assets
COPY --from=builder /usr/src/app/dist ./dist

# Copy generated Prisma client
COPY --from=builder /usr/src/app/node_modules/.prisma ./node_modules/.prisma

# Copy Prisma schema (optional but useful)
COPY --from=builder /usr/src/app/prisma ./prisma

# Use non-root user for security
USER node

# Expose port
EXPOSE 3000

# Start application
CMD ["node", "dist/main"]
