# Local multi-worktree development (optional)

Cloud agents and CI do not use this flow. It is for developers who run **several coding agents in parallel** on one machine, each in its own [git worktree](https://git-scm.com/docs/git-worktree), with isolated ports, env files, and Postgres databases.

**Local agents** (e.g. Codex, Qoder) that create a linked worktree themselves: if you are in that worktree (not the primary checkout) and `apps/core-api/.env` is missing, run `npm run worktree:setup` before building, testing, or starting the app. **Cloud agents** (`NODE_ENV=test`, no local Docker) skip this — do not run worktree setup.

## Why

The default dev stack uses port `3000` (API), `5173` (Vite), and a single `DATABASE_URL`. Two agents in one checkout overwrite each other's `.env` files, fight for ports, and collide on `prisma migrate` / seed against one database.

## Prerequisites

- Node.js 22+ and npm (same as the main README)
- Git 2.x with worktree support
- `psql` on your PATH (PostgreSQL client) for creating per-worktree databases, **or** Docker with `docker compose -f docker-compose.worktrees.yml up -d` (setup falls back to `docker exec` into the `postgres` service container when `psql` is missing, typical on Windows)
- Docker (optional but recommended) for a shared local Postgres instance

## One-time: shared Postgres for worktrees

From the repository root:

```bash
docker compose -f docker-compose.worktrees.yml up -d
```

This listens on **localhost:5433** by default (`postgres` / `postgres`). Override with `ACP_WORKTREE_PG_PORT` if 5433 is taken.

Alternatively, point each worktree at a **Neon branch** (or any Postgres URL) with `npm run worktree:setup -- --database-url 'postgresql://...'` — no Neon API calls are required.

Copy secrets from your primary checkout or pull from GSM (see `docs/google-secret-manager.md`). Never commit `.env` files.

## Create and configure a worktree

From the **primary** checkout (not required to be on `main`):

```bash
npm run worktree:new -- agent-a
# optional custom branch:
npm run worktree:new -- agent-a --branch feature/my-topic
```

This:

1. Creates `.worktrees/agent-a` on a new `feature/agent-a` branch from `origin/main`
2. Runs `worktree:setup` inside it (ports, `apps/core-api/.env`, `apps/core-web/.env.local`, database `acp_agent_a`, `prisma migrate deploy`, `npm install`)

`worktree:setup` **refuses to run** in the primary checkout while on `main` or `master`, so you do not accidentally rewrite the default dev env.

Re-run setup after changing ports or DB settings:

```bash
cd .worktrees/agent-a
npm run worktree:setup
```

Options: `--seed`, `--skip-install`, `--skip-migrate`, `--database-url`, `--pg-host`, `--pg-port`.

Metadata for the worktree is stored in `.acp/worktree.json` (gitignored).

## Start dev servers

Use the ports printed by setup (example):

```bash
cd .worktrees/agent-a
npm run start:dev --workspace=core-api
npm run dev --workspace=core-web -- --port 5176
```

Vite proxies `/api` and `/socket.io` using `VITE_API_PROXY_TARGET` in `.env.local`.

## Remove a worktree

From the primary checkout:

```bash
npm run worktree:remove -- .worktrees/agent-a
```

Optional: `--drop-db` removes the worktree's Postgres database. The command **refuses to remove** a branch that still has commits not on `origin/<branch>`.

## Tests

```bash
npm run worktree:test
```
