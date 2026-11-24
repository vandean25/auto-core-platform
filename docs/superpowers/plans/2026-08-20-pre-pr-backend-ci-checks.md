# Pre-PR Backend CI Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the CI-equivalent backend validation an explicit mandatory check before opening a pull request.

**Architecture:** Add a focused checklist to the existing GitHub Pull Request Workflow section in `agents.md`. The checklist will name the backend Prisma generation, tenant-isolation lint, ESLint, build, unit-test, and fresh-database E2E commands already used by CI.

**Tech Stack:** Markdown, npm workspaces, NestJS backend, Prisma, Jest.

---

### Task 1: Document mandatory backend pre-PR validation

**Files:**
- Modify: `agents.md` under `## GitHub Pull Request Workflow`

- [x] **Step 1: Add the mandatory checklist**

Add a “Before creating a PR” subsection that requires these CI-equivalent checks:

```bash
npm exec --workspace=core-api -- prisma generate
npm run lint:prisma-tenant --workspace=core-api
npm run lint --workspace=core-api
npm run build --workspace=core-api
npm test --workspace=core-api -- --ci --runInBand
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/auto_core_test" \
  npm exec --workspace=core-api -- prisma migrate deploy
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/auto_core_test" \
  npm run test:e2e --workspace=core-api -- --ci --runInBand
```

Reference the existing fresh, unseeded E2E database instructions in `agents.md` and state that all checks must pass before PR creation.

- [x] **Step 2: Verify the documentation change**

Run:

```bash
rg -n -A 35 -B 5 "Mandatory backend checks|prisma migrate deploy|npm run lint --workspace=core-api" agents.md
git diff --check
git diff -- agents.md docs/superpowers/plans/2026-08-20-pre-pr-backend-ci-checks.md
```

Expected: the mandatory subsection contains every backend CI check, including migration before E2E, and `git diff --check` exits successfully.

- [x] **Step 3: Commit**

```bash
git add agents.md docs/superpowers/plans/2026-08-20-pre-pr-backend-ci-checks.md
git commit -m "docs: require backend CI checks before PRs"
```
