# Lokale Multi-Worktree-Entwicklung (optional)

Cloud Agents und CI nutzen diesen Ablauf nicht. Er richtet sich an Entwickler, die **mehrere Coding-Agenten parallel** auf einem Rechner betreiben — jeweils in einem eigenen [Git-Worktree](https://git-scm.com/docs/git-worktree), mit getrennten Ports, Env-Dateien und Postgres-Datenbanken.

## Warum

Der Standard-Dev-Stack nutzt Port `3000` (API), `5173` (Vite) und eine gemeinsame `DATABASE_URL`. Zwei Agenten im selben Checkout überschreiben sich gegenseitig die `.env`-Dateien, blockieren Ports und kollidieren bei `prisma migrate` / Seed auf einer Datenbank.

## Voraussetzungen

- Node.js 22+ und npm (wie im README)
- Git 2.x mit Worktree-Unterstützung
- `psql` im PATH (PostgreSQL-Client) zum Anlegen der Worktree-Datenbanken, **oder** Docker mit `docker compose -f docker-compose.worktrees.yml up -d` (Setup nutzt `docker exec` in den `postgres`-Service-Container, wenn `psql` fehlt — üblich unter Windows)
- Docker (empfohlen) für eine gemeinsame lokale Postgres-Instanz

## Einmalig: gemeinsames Postgres für Worktrees

Im Repository-Root:

```bash
docker compose -f docker-compose.worktrees.yml up -d
```

Standard: **localhost:5433** (`postgres` / `postgres`). Port über `ACP_WORKTREE_PG_PORT` ändern, falls 5433 belegt ist.

Alternativ pro Worktree eine **Neon-Branch-URL** (oder beliebige Postgres-URL):

`npm run worktree:setup -- --database-url 'postgresql://...'` — ohne Neon-API-Aufrufe.

Secrets aus dem Haupt-Checkout kopieren oder per GSM pullen (`docs/google-secret-manager.md`). `.env`-Dateien nie committen.

## Worktree anlegen und einrichten

Im **Haupt-Checkout**:

```bash
npm run worktree:new -- agent-a
# optionaler Branch:
npm run worktree:new -- agent-a --branch feature/my-topic
```

Das legt `.worktrees/agent-a` auf Branch `feature/agent-a` von `origin/main` an und führt `worktree:setup` aus (Ports, Env-Dateien, Datenbank `acp_agent_a`, `prisma migrate deploy`, `npm install`).

`worktree:setup` **verweigert** die Ausführung im Haupt-Checkout auf `main`/`master`, damit die Standard-Dev-Env nicht überschrieben wird.

Setup erneut ausführen:

```bash
cd .worktrees/agent-a
npm run worktree:setup
```

Optionen: `--seed`, `--skip-install`, `--skip-migrate`, `--database-url`, `--pg-host`, `--pg-port`.

Metadaten: `.acp/worktree.json` (gitignored).

## Dev-Server starten

Ports laut Setup-Ausgabe (Beispiel):

```bash
cd .worktrees/agent-a
npm run start:dev --workspace=core-api
npm run dev --workspace=core-web -- --port 5176
```

Vite proxyt `/api` und `/socket.io` über `VITE_API_PROXY_TARGET` in `.env.local`.

## Worktree entfernen

Im Haupt-Checkout:

```bash
npm run worktree:remove -- .worktrees/agent-a
```

Optional `--drop-db` löscht die Worktree-Datenbank. **Kein Entfernen**, solange der Branch Commits hat, die noch nicht auf `origin/<branch>` liegen.

## Tests

```bash
npm run worktree:test
```
