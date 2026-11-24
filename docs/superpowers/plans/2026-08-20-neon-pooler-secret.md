# Neon Pooler Secret Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe, testable Cloud Run pooler diagnostics and document the operator cutover without changing Prisma migrations off the direct Neon URL.

**Architecture:** Keep `DATABASE_URL` as the direct migration/admin URL and let runtime code inspect the separate `DATABASE_URL_POOLED` URL. A pure diagnostic helper will parse hostnames, structured startup logging will avoid credentials, and `DATABASE_POOLER_REQUIRED=true` will turn production mismatches into a startup error after operator verification. Because this environment cannot verify GSM state, the Cloud Build default remains deployable and the dedicated secret is an explicit pre-deploy override.

**Tech Stack:** TypeScript, Jest, NestJS startup, Cloud Build YAML, Markdown runbooks, Google Secret Manager mapping documentation.

---

### Task 1: Add failing startup diagnostics tests

**Files:**
- Create: `apps/core-api/src/prisma/runtime-database-url-health.spec.ts`
- Test behavior implemented in: `apps/core-api/src/prisma/runtime-database-url-health.ts`

- [ ] **Step 1: Write tests for host inspection and mismatch detection**

```typescript
import {
  inspectRuntimeDatabaseUrls,
  logRuntimeDatabaseUrlStatus,
  requireRuntimePooler,
} from './runtime-database-url-health';

describe('inspectRuntimeDatabaseUrls', () => {
  it('identifies a distinct Neon pooler host', () => {
    const status = inspectRuntimeDatabaseUrls({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:secret@ep-direct.eu.neon.tech/core',
      DATABASE_URL_POOLED:
        'postgresql://user:secret@ep-direct-pooler.eu.neon.tech/core',
    });

    expect(status.pooledHostContainsPooler).toBe(true);
    expect(status.pooledHostEqualsDirect).toBe(false);
    expect(status.mismatch).toBe(false);
  });

  it('marks equal direct and pooled hosts as a mismatch', () => {
    const status = inspectRuntimeDatabaseUrls({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:direct@ep-main.eu.neon.tech/core',
      DATABASE_URL_POOLED:
        'postgresql://other:pooled@ep-main.eu.neon.tech/core',
    });

    expect(status.pooledHostEqualsDirect).toBe(true);
    expect(status.mismatch).toBe(true);
  });

  it('marks a blank pooled URL as a mismatch', () => {
    const status = inspectRuntimeDatabaseUrls({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:direct@ep-main.eu.neon.tech/core',
      DATABASE_URL_POOLED: '   ',
    });

    expect(status.pooledConfigured).toBe(false);
    expect(status.mismatch).toBe(true);
  });
});

describe('requireRuntimePooler', () => {
  it('does not throw by default for a production mismatch', () => {
    expect(() =>
      requireRuntimePooler(
        inspectRuntimeDatabaseUrls({
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql://user:direct@ep-main.eu.neon.tech/core',
          DATABASE_URL_POOLED:
            'postgresql://user:pooled@ep-main.eu.neon.tech/core',
        }),
      ),
    ).not.toThrow();
  });

  it('throws when production explicitly requires a pooler', () => {
    expect(() =>
      requireRuntimePooler(
        inspectRuntimeDatabaseUrls({
          NODE_ENV: 'production',
          DATABASE_POOLER_REQUIRED: 'true',
          DATABASE_URL: 'postgresql://user:direct@ep-main.eu.neon.tech/core',
          DATABASE_URL_POOLED:
            'postgresql://user:pooled@ep-main.eu.neon.tech/core',
        }),
      ),
    ).toThrow(/DATABASE_POOLER_REQUIRED/);
  });
});

describe('logRuntimeDatabaseUrlStatus', () => {
  it('logs a credential-free warning for a production mismatch', () => {
    const logger = {
      log: jest.fn(),
      warn: jest.fn(),
    };

    logRuntimeDatabaseUrlStatus(
      inspectRuntimeDatabaseUrls({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:direct@ep-main.eu.neon.tech/core',
        DATABASE_URL_POOLED:
          'postgresql://user:pooled@ep-main.eu.neon.tech/core',
      }),
      logger,
    );

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).not.toContain('direct');
    expect(logger.warn.mock.calls[0][0]).not.toContain('pooled');
  });
});
```

- [ ] **Step 2: Run the new test and confirm it fails for missing production code**

Run: `npm --prefix apps/core-api test -- --runInBand src/prisma/runtime-database-url-health.spec.ts`

Expected: FAIL because `runtime-database-url-health.ts` does not exist yet.

### Task 2: Implement the minimal startup diagnostic helper

**Files:**
- Create: `apps/core-api/src/prisma/runtime-database-url-health.ts`
- Modify: `apps/core-api/src/main.ts`
- Modify: `apps/core-api/src/config/env.ts`
- Modify: `apps/core-api/src/config/env.spec.ts`
- Modify: `apps/core-api/.env.example`

- [ ] **Step 1: Implement hostname-only status inspection**

Implement `inspectRuntimeDatabaseUrls(env)` with a `RuntimeDatabaseUrlStatus` return type. Trim URLs, parse `URL.hostname`, lower-case hosts for comparison, and return undefined for missing or invalid URLs. Set `mismatch` when there is no pooled host, the pooled host lacks `-pooler`, or pooled and direct hosts are equal. Include only safe host/status fields in the returned status.

- [ ] **Step 2: Implement optional production enforcement and structured logging**

Implement `requireRuntimePooler(status)` to throw only when `status.nodeEnvironment === 'production'`, `status.poolerRequired` is true, and `status.mismatch` is true. Implement `logRuntimeDatabaseUrlStatus(status, logger)` to JSON-encode the event name, environment, hostnames, booleans, and severity; use `warn` for production mismatches and `log` otherwise. Do not log URL strings or credentials.

- [ ] **Step 3: Wire startup validation before Nest application creation**

In `main.ts`, after `validateEnv()`, inspect `process.env`, log the status, and enforce the optional production requirement before `NestFactory.create`. This ensures a strict cutover fails early while the default remains compatible with current UAT.

- [ ] **Step 4: Add and validate `DATABASE_POOLER_REQUIRED`**

Add the key to `DOCUMENTED_ENV_KEYS`, the environment schema, `.env.example`, and environment tests. Accept `true`/`false` as optional values and keep the default undefined/false.

- [ ] **Step 5: Run focused tests and confirm green**

Run: `npm --prefix apps/core-api test -- --runInBand src/prisma/runtime-database-url-health.spec.ts src/config/env.spec.ts`

Expected: all tests pass.

### Task 3: Update Cloud Build and operator documentation

**Files:**
- Modify: `cloudbuild.yaml`
- Modify: `docs/internal/05-Runbooks/connection-pooling-strategy-and-metrics.md`
- Modify: `docs/google-secret-manager.md`

- [ ] **Step 1: Make the Cloud Build safety decision explicit**

Keep `_DATABASE_SECRET: DATABASE_URL_UAT` and `_DATABASE_POOLED_SECRET: DATABASE_URL_UAT` until the operator confirms the dedicated secret exists. Add comments naming `acp-core-api-database-url-pooled` as the required staging/production override and state that only Cloud Run runtime receives `DATABASE_URL_POOLED`; `migrate-db` receives direct `DATABASE_URL` only.

- [ ] **Step 2: Document the startup flag and operator sequence**

Document the pooled host check, production warning behavior, `DATABASE_POOLER_REQUIRED=true` cutover step, GSM IAM prerequisite, and SQL evidence requirement. Keep runbook checkboxes open for operator-controlled secret creation, deploy verification, alerts, and archived SQL output.

- [ ] **Step 3: Add markdown alert definitions**

Add PromQL/MQL starting-point snippets for connection saturation, waiting sessions, p95 active query runtime, and Cloud Run instance spikes with flat throughput. Label them as definitions for operator wiring, not Terraform or completed console alerts.

### Task 4: Verify, commit, and publish

**Files:**
- All files from Tasks 1–3.

- [ ] **Step 1: Run the issue verification test set**

Run: `npm --prefix apps/core-api test -- --runInBand src/prisma/runtime-database-url.spec.ts src/prisma/shared-pg-pool.spec.ts src/prisma/prisma.service.spec.ts src/config/env.spec.ts src/prisma/runtime-database-url-health.spec.ts`

Expected: all selected tests pass with zero failures.

- [ ] **Step 2: Run backend lint and build**

Run: `npm run lint --workspace=core-api && npm run build --workspace=core-api`

Expected: both commands exit 0.

- [ ] **Step 3: Review the diff for invariants**

Confirm `migrate-db` still has only `DATABASE_URL` in `secretEnv`, no real URL values exist, no Cloud SQL references were added, and the PR description lists `acp-core-api-database-url-pooled` as an operator prerequisite.

- [ ] **Step 4: Commit and push**

```bash
git add cloudbuild.yaml apps/core-api/src/main.ts apps/core-api/src/config/env.ts apps/core-api/src/config/env.spec.ts apps/core-api/src/prisma/runtime-database-url-health.ts apps/core-api/src/prisma/runtime-database-url-health.spec.ts apps/core-api/.env.example docs/internal/05-Runbooks/connection-pooling-strategy-and-metrics.md docs/google-secret-manager.md docs/superpowers/specs/2026-08-20-neon-pooler-secret-design.md docs/superpowers/plans/2026-08-20-neon-pooler-secret.md
git commit -m "fix(infra): add Neon pooler cutover guardrails"
git push -u origin feature/neon-pooler-secret-819e
```

- [ ] **Step 5: Create a draft PR**

Use the dedicated PR tool with a description that names the required operator secret, explains why the default remains safe until GSM is confirmed, and records the focused test and lint/build commands.
