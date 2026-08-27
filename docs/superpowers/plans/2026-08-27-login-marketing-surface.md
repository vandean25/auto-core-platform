# First-run Sign-in Marketing Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare unauthenticated sign-in card with the approved Auto Core first-run surface, including product context, invite-only demo guidance, password reset, and documentation.

**Architecture:** Keep authentication state and Firebase calls in `AuthProvider`. Keep the public presentation and host-gated demo copy in `LoginPage`, using existing shadcn primitives and Sonner to avoid new abstractions. Update the existing sign-in workflow page so public behavior and documentation agree.

**Tech Stack:** React 19, TypeScript, Firebase Auth, Vitest, Testing Library, Tailwind CSS 4, Mintlify MDX.

---

### Task 1: Add reset-email behavior to the auth boundary

**Files:**
- Modify: `apps/core-web/src/auth/AuthProvider.tsx`
- Test: `apps/core-web/src/auth/AuthProvider.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add tests for `sendPasswordResetEmail('user@example.com')` delegating to Firebase and for a blank address rejecting before Firebase is called. Mock `sendPasswordResetEmail` alongside the existing Firebase auth functions and expose the provider action through the rendered test consumer.

- [ ] **Step 2: Run the focused auth tests and verify they fail for the missing context action**

Run `npm test --workspace=core-web -- --run apps/core-web/src/auth/AuthProvider.test.tsx`.

Expected result: FAIL because the test consumer cannot call the new `sendPasswordResetEmail` action yet.

- [ ] **Step 3: Implement the minimal auth action**

Import Firebase's `sendPasswordResetEmail`, add `sendPasswordResetEmail: (email: string) => Promise<void>` to `AuthContextValue`, implement a callback that throws the existing configuration error when `firebaseAuth` is missing and otherwise delegates to Firebase, then include it in the memoized context value and dependency list.

- [ ] **Step 4: Run the focused auth tests and verify they pass**

Run `npm test --workspace=core-web -- --run apps/core-web/src/auth/AuthProvider.test.tsx`.

Expected result: PASS.

### Task 2: Add the approved first-run LoginPage surface

**Files:**
- Modify: `apps/core-web/src/pages/LoginPage.tsx`
- Test: `apps/core-web/src/pages/LoginPage.test.tsx`

- [ ] **Step 1: Write the failing UI tests**

Extend the existing `useAuth` mock with `sendPasswordResetEmail`. Add tests asserting the approved product copy, card description, documentation link, demo hint on `auto-core-platform-vande.web.app`, absence of that hint on another hostname, blank-email reset validation, approved success toast, and approved reset-error toast.

- [ ] **Step 2: Run the focused LoginPage tests and verify they fail for the missing surface**

Run `npm test --workspace=core-web -- --run apps/core-web/src/pages/LoginPage.test.tsx`.

Expected result: FAIL because the current page has no product pane, demo hint, documentation link, forgot-password action, or reset-email action.

- [ ] **Step 3: Implement the minimal approved surface**

Use a responsive two-column wrapper (`md:grid-cols-2`) with a product pane and the existing card. Add the three approved bullets, `Documentation` link, host-gated demo hint, `Forgot password?` button/link beneath the password field, email validation, `sendPasswordResetEmail`, and the approved toasts. Replace all visitor-facing Firebase/env-var copy while retaining `isConfigured` gating.

- [ ] **Step 4: Run the focused LoginPage tests and verify they pass**

Run `npm test --workspace=core-web -- --run apps/core-web/src/pages/LoginPage.test.tsx`.

Expected result: PASS.

### Task 3: Align the sign-in documentation

**Files:**
- Modify: `workflows/sign-in.mdx`

- [ ] **Step 1: Update the documented behavior**

Describe invite-only access, Google or email/password sign-in, the forgot-password link, the demo-host-only account hint without passwords, the documentation link, and the neutral unconfigured message. Remove Firebase implementation wording from visitor-facing guidance.

- [ ] **Step 2: Review the documentation for stale implementation details**

Run `rg -n "Firebase|env|signup|forgot|demo|Documentation|invited" workflows/sign-in.mdx` and verify the page contains no Firebase/env-var dump or public signup promise.

### Task 4: Verify the complete frontend change

**Files:**
- Verify: `apps/core-web/src/auth/AuthProvider.tsx`
- Verify: `apps/core-web/src/pages/LoginPage.tsx`
- Verify: `apps/core-web/src/auth/AuthProvider.test.tsx`
- Verify: `apps/core-web/src/pages/LoginPage.test.tsx`
- Verify: `workflows/sign-in.mdx`

- [ ] **Step 1: Run the focused tests**

Run `npm test --workspace=core-web -- --run apps/core-web/src/auth/AuthProvider.test.tsx apps/core-web/src/pages/LoginPage.test.tsx`.

- [ ] **Step 2: Run frontend lint and build**

Run `npm run lint --workspace=core-web` and `npm run build --workspace=core-web`.

- [ ] **Step 3: Run the full frontend test suite**

Run `npm test --workspace=core-web`.

- [ ] **Step 4: Review the final diff**

Run `git diff --check` and `git diff --stat`; confirm only the approved auth surface, tests, docs, and workflow artifacts changed.
