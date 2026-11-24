# INFRA-6 Same-Origin API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route production `/api` traffic through Firebase Hosting and keep the frontend's default HTTP and production Socket.IO URLs same-origin.

**Architecture:** Firebase Hosting rewrites `/api/**` to the existing `core-api` Cloud Run service in `europe-west3` before the SPA fallback. Cloud Build no longer exports the Cloud Run URL into the frontend bundle. The frontend keeps relative API URLs and resolves an empty-base production realtime connection to `window.location.origin` plus `/api/socket.io`, while explicit base URLs remain supported for direct-origin deployments.

**Tech Stack:** Firebase Hosting JSON, Google Cloud Build YAML, React/TypeScript, Vite, Vitest, Sentry Browser SDK.

---

### Task 1: Add empty-base API URL regression coverage

**Files:**
- Create: `apps/core-web/src/api/client.test.ts`
- Modify: `apps/core-web/src/api/client.ts` only if the test exposes a required behavior regression

- [ ] **Step 1: Write the failing test**

Mock `@/lib/firebase` with no current user, mock `globalThis.fetch`, and call `fetchWithAuth` with both a relative string and a `URL` whose pathname starts with `/api/`. Assert that the exact relative input reaches `fetch` when `VITE_API_BASE_URL` is empty.

- [ ] **Step 2: Run the focused test to verify the behavior**

Run: `npm --prefix apps/core-web test -- src/api/client.test.ts`

Expected: The new test passes against the current implementation; this is a characterization test for the explicitly required behavior that must remain unchanged.

- [ ] **Step 3: Keep the implementation minimal**

Do not add an absolute fallback. Preserve `if (!API_BASE_URL) return input`, because the browser origin must own production `/api` requests.

- [ ] **Step 4: Run the focused test again**

Run: `npm --prefix apps/core-web test -- src/api/client.test.ts`

Expected: PASS with the string and `URL` inputs preserved.

### Task 2: Cover empty Sentry base and production realtime routing

**Files:**
- Modify: `apps/core-web/src/sentry/config.test.ts`
- Modify: `apps/core-web/src/features/realtime/RealtimeDashboardSyncProvider.test.tsx`
- Modify: `apps/core-web/src/sentry/config.ts` only if an explicit empty value is mishandled
- Modify: `apps/core-web/src/features/realtime/RealtimeDashboardSyncProvider.tsx` only if the production assertion exposes a routing defect

- [ ] **Step 1: Add the failing/characterization assertions**

Add a Sentry case with `VITE_API_BASE_URL: ''` and assert `tracePropagationTargets` is exactly `['localhost']`. Add a realtime case:

```typescript
expect(
  resolveRealtimeConnection({
    apiBaseUrl: '',
    currentOrigin: 'https://auto-core-platform-vande.web.app',
    isDev: false,
  }),
).toEqual({
  url: 'https://auto-core-platform-vande.web.app/dashboard-realtime',
  path: '/api/socket.io',
})
```

- [ ] **Step 2: Run the focused tests**

Run: `npm --prefix apps/core-web test -- src/sentry/config.test.ts src/features/realtime/RealtimeDashboardSyncProvider.test.tsx`

Expected: PASS against the current implementation; the tests lock in the issue's required empty-base behavior.

- [ ] **Step 3: Make only necessary implementation cleanup**

Keep empty Sentry bases out of propagation targets through the existing truthiness guard. Keep realtime's development `/socket.io` proxy and production `/api/socket.io` Hosting path distinct.

- [ ] **Step 4: Run the focused tests again**

Run: `npm --prefix apps/core-web test -- src/sentry/config.test.ts src/features/realtime/RealtimeDashboardSyncProvider.test.tsx`

Expected: PASS with no socket path regressions.

### Task 3: Configure Firebase Hosting's Cloud Run rewrite

**Files:**
- Modify: `firebase.json`

- [ ] **Step 1: Add the rewrite before the SPA fallback**

Add this object before the existing `**` rule:

```json
{
  "source": "/api/**",
  "run": {
    "serviceId": "core-api",
    "region": "europe-west3"
  }
}
```

This single `/api/**` rule covers REST endpoints and `/api/socket.io/**`; no Cloud Functions target is introduced.

- [ ] **Step 2: Validate the JSON and rewrite ordering**

Run: `node -e "const c=require('./firebase.json'); const r=c.hosting.rewrites; if (r[0].source !== '/api/**' || r[0].run.serviceId !== 'core-api' || r[0].run.region !== 'europe-west3' || r.at(-1).destination !== '/index.html') process.exit(1)"`

Expected: exit 0.

### Task 4: Stop injecting the Cloud Run URL into frontend builds

**Files:**
- Modify: `cloudbuild.yaml`

- [ ] **Step 1: Remove the obsolete run URL export step**

Delete the `export-run-url` step, since no later build step needs `.run_url`.

- [ ] **Step 2: Remove frontend API base injection**

Delete `RUN_URL="$$(cat /workspace/.run_url)"` and `export VITE_API_BASE_URL="$$RUN_URL"` from `build-frontend`. Leave Firebase, Sentry, version, and legacy API key environment setup unchanged.

- [ ] **Step 3: Validate Cloud Build source text**

Run: `node -e "const fs=require('fs'); const y=fs.readFileSync('cloudbuild.yaml','utf8'); if (y.includes('export VITE_API_BASE_URL') || y.includes('.run_url')) process.exit(1)"`

Expected: exit 0.

### Task 5: Document production same-origin API and Socket.IO behavior

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update frontend environment guidance**

Explain that production does not require `VITE_API_BASE_URL`; leave it empty because Firebase Hosting rewrites `/api/**` to Cloud Run. State that production REST calls use `/api/...` and realtime uses `/api/socket.io`, while Vite development uses its `/socket.io` proxy.

- [ ] **Step 2: Document WebSocket verification and fallback**

Add the operator check for a staging Hosting channel and explain that Cloud Run supports WebSockets directly, but Hosting rewrite WebSocket upgrade behavior must be confirmed. If the upgrade fails, use the direct Cloud Run origin for the socket client rather than moving Nest to Cloud Functions.

- [ ] **Step 3: Review the documentation diff**

Run: `git diff --check`

Expected: no whitespace errors.

### Task 6: Run frontend verification and submit

**Files:**
- All files modified by Tasks 1–5

- [ ] **Step 1: Run focused tests**

Run: `npm --prefix apps/core-web test -- src/api/client.test.ts src/api src/features/realtime src/sentry`

Expected: all selected Vitest tests pass.

- [ ] **Step 2: Run frontend lint and build**

Run: `npm run lint --workspace=core-web && npm --prefix apps/core-web run build`

Expected: lint and TypeScript/Vite production build exit 0.

- [ ] **Step 3: Review and commit the implementation**

Run:

```bash
git diff --check
git status --short
git add firebase.json cloudbuild.yaml README.md apps/core-web/src/api/client.test.ts apps/core-web/src/sentry/config.test.ts apps/core-web/src/features/realtime/RealtimeDashboardSyncProvider.test.tsx
git commit -m "fix: route production API through Firebase Hosting"
```

- [ ] **Step 4: Push and create the draft PR**

Run: `git push -u origin feature/infra-6-same-origin-api-a754`

Create a draft PR against `main` with the summary, focused test command, lint, build, and the note that production Hosting WebSocket upgrade validation remains an operator step.
