# Align Sentry Release IDs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Cloud Build the only production Sentry source-map uploader and document git tags as the shared frontend/API release ID.

**Architecture:** Keep the existing tag-triggered Cloud Build release wiring unchanged because it already sets `${TAG_NAME}` for frontend `SENTRY_RELEASE`, frontend `VITE_APP_VERSION`, and Cloud Run API `SENTRY_RELEASE`. Remove the competing `main` GitHub Actions workflow, add explicit comments to the surviving configuration, and update GSM documentation.

**Tech Stack:** Google Cloud Build, GitHub Actions YAML, Vite, Sentry Vite plugin, Markdown.

---

### Task 1: Remove the competing GitHub source-map pipeline

**Files:**
- Delete: `.github/workflows/core-web-sentry-sourcemaps.yml`

- [ ] **Step 1: Delete the workflow**

Remove the workflow so pushes to `main`, manual dispatches, and PR-related workflow changes cannot upload maps under `${{ github.sha }}`.

- [ ] **Step 2: Confirm no workflow references remain**

Run:

```bash
rg -n "core-web-sentry-sourcemaps|github\.sha|SENTRY_RELEASE" .github/workflows
```

Expected: no output from the deleted workflow; any remaining release references must belong to unrelated, intentionally separate workflows.

- [ ] **Step 3: Commit**

```bash
git add -u .github/workflows/core-web-sentry-sourcemaps.yml
git commit -m "ci: remove competing Sentry source map workflow"
```

### Task 2: Clarify tag ownership in the production build configuration

**Files:**
- Modify: `cloudbuild.yaml:156-180`
- Modify: `apps/core-web/vite.config.ts:8-11`

- [ ] **Step 1: Add the Cloud Build comment**

Place a short comment immediately before the frontend release exports:

```bash
# Tagged production builds use the git tag as the shared Sentry release ID.
export SENTRY_RELEASE="${TAG_NAME}"
export VITE_APP_VERSION="${TAG_NAME}"
```

- [ ] **Step 2: Add the Vite comment**

Place a short comment above the upload-credential check:

```typescript
// Production source maps are uploaded by Cloud Build under the git tag release.
const hasSentryUploadCredentials = Boolean(
```

Keep `build.sourcemap: 'hidden'` and all existing plugin behavior unchanged.

- [ ] **Step 3: Verify the release values**

Run:

```bash
rg -n "SENTRY_RELEASE|VITE_APP_VERSION|sourcemap|git tag|Production source maps" cloudbuild.yaml apps/core-web/vite.config.ts
```

Expected: every production release assignment in Cloud Build uses `${TAG_NAME}`, the frontend version uses `${TAG_NAME}`, the comments identify the tag as canonical, and hidden sourcemaps remain configured.

- [ ] **Step 4: Commit**

```bash
git add cloudbuild.yaml apps/core-web/vite.config.ts
git commit -m "ci: document tag-based Sentry releases"
```

### Task 3: Align GSM documentation with Cloud Build

**Files:**
- Modify: `docs/google-secret-manager.md:58-75`

- [ ] **Step 1: Replace the stale GitHub workflow description**

Describe the three Sentry secrets as consumed by the tag-triggered Cloud Build `build-frontend` step, which uploads hidden frontend source maps using the git tag release. Keep the Cloud Build secret names and remove the GitHub repository-secret list because the deleted workflow no longer consumes them.

- [ ] **Step 2: Verify stale instructions are gone**

Run:

```bash
rg -n "core-web-sentry-sourcemaps|GitHub Actions|GCP_WORKLOAD_IDENTITY_PROVIDER|GSM_SENTRY_|Cloud Build|TAG_NAME|source maps" docs/google-secret-manager.md
```

Expected: the section identifies Cloud Build and `${TAG_NAME}` as the production path, with no stale GitHub workflow or GitHub-only secret requirements.

- [ ] **Step 3: Commit**

```bash
git add docs/google-secret-manager.md
git commit -m "docs: document Cloud Build Sentry uploads"
```

### Task 4: Run focused verification

**Files:**
- Test: `apps/core-web/src/sentry/config.test.ts`

- [ ] **Step 1: Run the Sentry unit tests**

Run:

```bash
npm --prefix apps/core-web test -- src/sentry
```

Expected: all Sentry configuration tests pass without changing release parsing.

- [ ] **Step 2: Run repository-level static checks**

Run:

```bash
rg -n "SENTRY_RELEASE" cloudbuild.yaml .github/workflows || true
rg -n "VITE_APP_VERSION" cloudbuild.yaml .github/workflows || true
rg -n "sourcemap: 'hidden'" apps/core-web/vite.config.ts
git diff --check HEAD~3..HEAD
git status --short
```

Expected: Cloud Build is the only listed production release owner, tag values are aligned, hidden sourcemaps remain, the diff has no whitespace errors, and the working tree is clean after committing.
