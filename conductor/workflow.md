# Workflow

## Building and Running
### Setup Commands
```bash
# Install dependencies (from root)
npm install --prefix apps/core-api
npm install --prefix apps/core-web

# Database Initialization
cd apps/core-api
npx prisma generate
npx prisma migrate dev
npx prisma db seed
```

### Development Servers
```bash
# Backend (Port 3000)
cd apps/core-api
npm run start:dev

# Frontend (Port 5173)
cd apps/core-web
npm run dev
```

## API Conventions
- **Prefix**: All endpoints are prefixed with `/api`.
- **Formatting**: List endpoints return `{ data, meta }`.
- **Proxy**: Vite handles `/api` proxying to backend in dev mode.
