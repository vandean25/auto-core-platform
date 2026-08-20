# Remove Unused Sentry NestJS Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the unused `@sentry/nestjs` dependency while preserving the
existing single `@sentry/node` initialization path.

**Architecture:** `apps/core-api/src/main.ts` continues to load
`src/instrument.ts`, which remains the only Sentry initializer. Only dependency
metadata changes; no Nest module or exception-filter wiring is introduced.

**Tech Stack:** npm workspaces, NestJS 11, `@sentry/node`, Jest, TypeScript.

---

### Task 1: Remove the unused dependency

**Files:**
- Modify: `apps/core-api/package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Remove `@sentry/nestjs` through npm**

Run:

```bash
npm uninstall @sentry/nestjs --workspace=core-api
```

Expected result: npm removes the direct dependency from
`apps/core-api/package.json` and removes its now-unused lockfile packages,
while retaining `@sentry/node`.

- [ ] **Step 2: Confirm the dependency graph has one Sentry integration**

Run:

```bash
rg -n '"@sentry/nestjs"|SentryModule' apps/core-api package-lock.json
npm ls --workspace=core-api @sentry/node @sentry/nestjs
```

Expected result: the ripgrep command has no matches, and npm reports
`@sentry/node` without an installed `@sentry/nestjs` package.

- [ ] **Step 3: Review and commit the metadata change**

Run:

```bash
git diff --check
git diff -- apps/core-api/package.json package-lock.json
git add apps/core-api/package.json package-lock.json
git commit -m "chore(core-api): remove unused sentry nestjs package"
```

Expected result: the diff only removes the unused dependency and its lockfile
entries, and the commit succeeds.

### Task 2: Verify the API remains healthy

**Files:**
- Verify: `apps/core-api/src/instrument.ts`
- Verify: `apps/core-api/src/main.ts`
- Verify: `apps/core-api/src/app.module.ts`

- [ ] **Step 1: Push the pre-verification revision**

Run:

```bash
git push -u origin feature/remove-unused-sentry-nestjs-c06c
```

Expected result: the feature branch is available on origin.

- [ ] **Step 2: Build the API**

Run:

```bash
npm --prefix apps/core-api run build
```

Expected result: Nest compilation exits with status 0.

- [ ] **Step 3: Run the API Jest suite serially**

Run:

```bash
npm --prefix apps/core-api test -- --runInBand
```

Expected result: Jest exits with status 0 and reports zero failed tests.

- [ ] **Step 4: Inspect the final status**

Run:

```bash
git status --short
git log -1 --oneline
```

Expected result: no uncommitted changes remain after verification.
