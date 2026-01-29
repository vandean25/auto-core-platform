# Auto Core Platform

A monorepo for the Auto Core Platform, consisting of a NestJS API and a Vite-based web application.

## Structure

- `apps/core-api`: NestJS backend API with Prisma.
- `apps/core-web`: React-based frontend application.

## Getting Started

### Backend (core-api)

1. Navigate to `apps/core-api`
2. Install dependencies: `npm install`
3. Set up environment variables in `.env`
4. Run migrations: `npx prisma migrate dev`
5. Start development server: `npm run start:dev`

### Frontend (core-web)

1. Navigate to `apps/core-web`
2. Install dependencies: `npm install`
3. Start development server: `npm run dev`
