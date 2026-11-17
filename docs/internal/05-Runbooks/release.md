# Release Runbook

Process for preparing and cutting a `v*` release tag from `main`. The `^v.*$` tag trigger runs `cloudbuild.yaml` (see [environments.md](./environments.md) for environment status and deployment ownership).

> **Hard gate:** Never push a `v*` tag without **both** a QA **PASS** on the release candidate (RC) **and** Dejan's explicit production OK. There is no skip or hotfix bypass without Dejan's explicit OK.

## Steps (from green `main` to tag pushed)

### 1. Pick the Release Candidate (RC)

1. Choose a `main` commit SHA with **full CI green** (all required checks, build, and full e2e suites passing).
2. Find the latest `v*` tag and list the changes since that tag:
   ```bash
   git fetch origin --tags
   git tag --sort=-v:refname | head -n 1
   git log <last-v-tag>..<rc-sha> --oneline
   ```
3. Flag any high-risk areas in the diff: `migrations` (`apps/core-api/prisma/migrations/`), `finance`, `auth`, and `.github`.

### 2. Send the RC test request to QA

Send a written RC test request to QA using the [template below](#rc-test-request-template). Do not create or push a tag yet.

### 3. Wait for QA answer

QA responds with **PASS** or **FAIL** and any findings:

- **FAIL:** Do **not** tag. Every finding becomes a Linear ticket via the **Product Planner**. Once fixes merge to `main` and full CI is green, pick the new RC SHA and restart from Step 1.
- **PASS:** Record the QA pass on the RC SHA and proceed to Step 4. A QA pass alone does not authorize tagging.

### 4. Obtain Dejan's OK and push the tag

1. Verify both gates are met for the exact RC SHA:
   - QA **PASS** received.
   - **Dejan's explicit production OK** received.
2. Tag the approved RC SHA using the `v*` naming convention (e.g. `vYYYY.MM.DD-release-N`) and push the tag to `origin`:
   ```bash
   git tag <v-tag> <rc-sha>
   git push origin <v-tag>
   ```
3. Monitor the `^v.*$` Cloud Build trigger (`cloudbuild.yaml`) until deployment finishes.

---

## RC Test Request Template

```markdown
### Release Candidate Test Request

- **RC SHA:** `<commit-sha>`
- **Previous tag:** `<last-v-tag>`
- **PRs / Linear tickets since last tag:**
  - `<PR / AUT-XXX — short summary>`
- **Risk areas touched:** `<migrations | finance | auth | .github | none>`
- **Required smoke flows:**
  - `<flow 1>`
  - `<flow 2>`
- **Where to test:** `<environment / URL>`
- **Deadline:** `<YYYY-MM-DD HH:MM TZ>`

**Expected answer:** Reply with **PASS** or **FAIL** (include findings). Findings will be logged as Linear tickets via the Product Planner. No tag will be pushed until QA passes and Dejan gives explicit OK.
```
