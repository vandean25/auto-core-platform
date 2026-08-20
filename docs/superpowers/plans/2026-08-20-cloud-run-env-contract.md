# Cloud Run Environment Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure the tag deploy supplies workshop media storage to `core-api` and continuously checks the documented production Cloud Run environment contract.

**Architecture:** Keep Cloud Run configuration declarative in `cloudbuild.yaml`. Add a small TypeScript parser/checker under `apps/core-api/scripts` that isolates the `deploy-cloud-run` step and extracts keys from both `--set-env-vars` and `--set-secrets`; its Jest spec becomes the CI regression guard. Do not change runtime validation or the PDF worker deploy.

**Tech Stack:** Cloud Build YAML shell blocks, TypeScript, Jest, npm workspaces, Google Secret Manager.

---

### Task 1: Add the failing Cloud Run contract test

**Files:**
- Create: `apps/core-api/scripts/check-cloudrun-env-contract.spec.ts`
- Create: `apps/core-api/scripts/check-cloudrun-env-contract.ts`

- [ ] **Step 1: Write the test against the expected production contract**

Import the checker’s `parseCloudBuildDeployContracts` and `REQUIRED_CORE_API_PRODUCTION_ENV_KEYS`. Read the repository `cloudbuild.yaml`, assert every required key is present in the `core-api` contract, and assert `WORKSHOP_MEDIA_BUCKET` is present as a secret mapping to `WORKSHOP_MEDIA_BUCKET:latest`. Add a second assertion that the PDF worker block does not contain `WORKSHOP_MEDIA_BUCKET` or Cloud Tasks enqueue keys.

- [ ] **Step 2: Run the new test and verify it fails**

Run `npm --prefix apps/core-api test -- --runInBand scripts/check-cloudrun-env-contract.spec.ts`.

Expected: Jest cannot resolve the new checker module because the implementation has not been written.

### Task 2: Implement the contract parser and CLI check

**Files:**
- Modify: `apps/core-api/scripts/check-cloudrun-env-contract.ts`
- Modify: `apps/core-api/package.json`

- [ ] **Step 1: Implement block extraction and deploy-argument parsing**

Export:

```ts
export const REQUIRED_CORE_API_PRODUCTION_ENV_KEYS = [
  'NODE_ENV',
  'FRONTEND_URL',
  'SENTRY_RELEASE',
  'FIREBASE_PROJECT_ID',
  'DATABASE_URL',
  'DATABASE_URL_POOLED',
  'API_KEY',
  'SENTRY_DSN',
  'INVOICE_PDF_BUCKET',
  'WORKSHOP_MEDIA_BUCKET',
  'SECRET_ENCRYPTION_KEY',
  'CLOUD_TASKS_ENABLED',
  'CLOUD_TASKS_LOCATION',
  'CLOUD_TASKS_QUEUE',
  'CLOUD_TASKS_TARGET_BASE_URL',
  'CLOUD_TASKS_INVOKER_SA',
  'CLOUD_TASKS_WORKER_SECRET',
] as const;
```

Extract the YAML block beginning at `id: deploy-cloud-run`, find quoted
`--set-env-vars` and `--set-secrets` values, and return key/value mappings.
Throw a clear error if the deploy block or an argument is missing. When run
directly, print missing keys and exit nonzero; otherwise print a success
message.

- [ ] **Step 2: Add a direct package command**

Add `"check:cloudrun-env": "ts-node -r tsconfig-paths/register scripts/check-cloudrun-env-contract.ts"` to the API workspace scripts. Keep the Jest spec under `scripts` so the existing backend unit-test command runs it in CI.

- [ ] **Step 3: Run the test and direct checker**

Run:

```bash
npm --prefix apps/core-api test -- --runInBand scripts/check-cloudrun-env-contract.spec.ts
npm --prefix apps/core-api run check:cloudrun-env
```

Expected: both commands pass and report the complete `core-api` production contract.

### Task 3: Wire GSM mapping and operator documentation

**Files:**
- Modify: `cloudbuild.yaml`
- Modify: `secrets/gsm-mapping.example.json`
- Modify: `docs/google-secret-manager.md`
- Modify: `README.md`

- [ ] **Step 1: Add the exact secret mapping only to `core-api`**

Append `WORKSHOP_MEDIA_BUCKET=WORKSHOP_MEDIA_BUCKET:latest` to the
`deploy-cloud-run` `--set-secrets` list. Do not modify the worker’s list.

- [ ] **Step 2: Document the local mapping and production operator setup**

Add the exact `WORKSHOP_MEDIA_BUCKET` GSM mapping suggestion and document that
operators must create the `europe-west3` bucket, grant the Cloud Run runtime
service account `storage.objectAdmin` (or a narrower equivalent), and keep
private objects out of git. Mention that the API fails closed at media/PDF use
sites rather than requiring these buckets during `validateEnv` boot.

- [ ] **Step 3: Re-run the contract test**

Run `npm --prefix apps/core-api test -- --runInBand scripts/check-cloudrun-env-contract.spec.ts` and expect PASS.

### Task 4: Verify, commit, and publish

**Files:**
- Modify: only the files above.

- [ ] **Step 1: Run targeted backend verification**

Run:

```bash
npm --prefix apps/core-api test -- --runInBand src/config/env.spec.ts scripts/check-cloudrun-env-contract.spec.ts
npm --prefix apps/core-api run lint
npm --prefix apps/core-api run build
```

Expected: all selected tests pass, lint exits 0, and the API build exits 0.

- [ ] **Step 2: Inspect the final diff**

Run `git diff --check` and verify only `core-api` receives the workshop media secret, both services retain the invoice bucket, and `validateEnv` is unchanged.

- [ ] **Step 3: Commit and push**

Use separate commits for the contract guard and the deploy/docs wiring if both
are independently complete:

```bash
git add apps/core-api/scripts apps/core-api/package.json
git commit -m "test: guard Cloud Run environment contract"
git add cloudbuild.yaml secrets/gsm-mapping.example.json docs/google-secret-manager.md README.md
git commit -m "fix: wire workshop media bucket on core api"
git push -u origin feature/infra-8-cloud-run-env-contract-5623
```

- [ ] **Step 4: Create or update the draft PR**

Create a draft PR against `main` describing the API-only secret wiring, the
contract guard, unchanged boot validation, and operator prerequisites.
