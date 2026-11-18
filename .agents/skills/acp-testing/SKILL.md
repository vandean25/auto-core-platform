---
name: acp-testing
description: Use when writing, changing, reviewing, or fixing tests in ACP (Jest unit/e2e in core-api, Vitest in core-web, Playwright in core-web/e2e), when a test depends on today's date or the clock, when a test is flaky or uses sleep/waitForTimeout, or when choosing unit vs e2e. Covers deterministic time, tenant isolation, and the local pre-push checks in agents.md.
---

# ACP testing

How to write tests in this repo. Load this skill before adding or changing a spec.

This skill does **not** replace skills already in the tree. Read them when they apply, and do not copy their rules here:

- TDD for behaviour changes and bugfixes: `.agents/skills/superpowers/test-driven-development/SKILL.md` (`agents.md` already says the "delete code written before the test" rule does not apply in ACP).
- Honest assertions, no mock-testing, no test-only production methods: `.agents/skills/superpowers/test-driven-development/writing-good-tests.md`.
- No arbitrary sleeps: `.agents/skills/superpowers/systematic-debugging/condition-based-waiting.md`.
- FIRST, boundaries, no quiet `test.skip`: `.agents/skills/typescript/clean-tests/SKILL.md`.
- Repo conventions, local vs CI, spec-quality: `agents.md` section "Testing Standards" and "Local checks before pushing".
- No new suppressions or weakened tests: `.agents/skills/acp-code-health/SKILL.md`.

## Stack (use what is already here)

| Layer | Runner | Where | Notes |
|---|---|---|---|
| Backend unit | Jest 30 + ts-jest (ESM) | `apps/core-api/src/**/*.spec.ts` | `npm test --workspace=core-api -- --ci --runInBand --findRelatedTests <files>` |
| Backend e2e | Jest via `test/jest-e2e.json`, supertest | `apps/core-api/test/**/*.e2e-spec.ts` | Helpers in `test/helpers/` (`createE2eApp`, `createE2eTenant`) and `tenant-test-utils.ts`. DB is unseeded `auto_core_test`. |
| Frontend unit | Vitest 5 + Testing Library | `apps/core-web/src/**/*.{test,spec}.{ts,tsx}` | `src/test/setup.ts` initializes i18n as `de`. |
| Frontend e2e | Playwright 1.65 | `apps/core-web/e2e/**/*.spec.ts` | Visual project: `locale: 'de-AT'`, `timezoneId: 'Europe/Vienna'`. |

CI (`ubuntu-latest`) runs in **UTC**. The backend e2e job does not set `TZ`. Playwright visual tests pin `Europe/Vienna`; default UI timezone in the app is also `Europe/Vienna`. Full backend and UI e2e suites run only in CI (sharded). Locally run only the specs you added or changed, as in `agents.md` / `CLAUDE.md`.

## Deterministic time

This is the rule that failed in production CI: `apps/core-api/test/settlement.e2e-spec.ts` posted a credit note with `date: '2026-11-14'` while `createIssuedWorkshopInvoice()` issues the invoice with `date: new Date()` (`invoice-creation.helpers.ts`). After UTC midnight on 2026-11-15 the API correctly returned 400 (`Credit date cannot be earlier than the original invoice date.`).

**Never hard-code a calendar day that is later compared with "now" or with a record dated "today".**

Do this instead, in order of preference:

1. **Derive the date from the record you just created.** If the invoice is issued with today's date, the credit-note date is that invoice's date (UTC date-only, same as production: `toISOString().slice(0, 10)`). Production parses credit dates as `\`${value}T00:00:00.000Z\`` (`credit-notes.service.ts`).
2. **Stamp the whole scenario with one fixture clock.** Same pattern as `legal-invoicing-credit-notes.e2e-spec.ts`: set `fixtureInvoiceDate`, write it onto the invoice, and use the same (or a later) fixture day on credit notes, due dates, and `lock_date`. The closed period must not be compared with `Date.now()`.
3. **Inject or override the clock, then reset it.** Unit tests: `jest.useFakeTimers({ now })` / `vi.useFakeTimers({ now })` / `setSystemTime`, always restored in `afterEach`. Playwright: `page.clock.install({ time })` when the UI depends on "today". Modules that already expose a test hook (for example `setLoanerNowForTests` in `loaner-clock.ts`) may use it; call the reset (`undefined`) in `afterEach`. Do not add new test-only hooks to production modules when a clock token can be injected instead (`RATE_LIMIT_CLOCK` is the existing DI pattern).

Literal `YYYY-MM-DD` values are fine in a **closed fixture period** that never meets the live clock (accounting-export windows, frozen PDF/visual snapshots, historical first-registration dates). They are not fine as soon as another value in the same flow is "today".

### Time zones and boundaries

- Backend CI is UTC; the product formats dates in `Europe/Vienna` (UTC+1 in winter, UTC+2 in summer). Between 00:00 and 01:00 Vienna time the calendar day in UTC is still the previous day. Between 00:00 and 01:00 UTC it is already the next day in Vienna.
- Date-only fields are stored/compared as UTC midnight. A hardcoded yesterday vs an invoice issued with `new Date()` breaks at UTC midnight, at month/year roll, and when `lock_date` closes the period.
- When a test must cross a boundary (month end, fiscal lock, leap day), say so and drive both sides from the same injected clock — do not hope the suite runs on the right calendar day.

```ts
// BAD — settlement.e2e-spec.ts (broke after UTC midnight)
.send({ date: '2026-11-14', reason: '...', mode: 'PARTIAL', ... })

// GOOD — derive from the issued invoice
const creditDate = new Date(invoice.date).toISOString().slice(0, 10);
.send({ date: creditDate, reason: '...', mode: 'PARTIAL', ... })

// GOOD — closed fixture, invoice stamped to the same clock
const fixtureInvoiceDate = new Date('2026-09-21T12:00:00.000Z');
await prisma.invoice.update({ where: { id }, data: { date: fixtureInvoiceDate } });
.send({ date: '2026-09-21', ... })
```

## Tenant and data isolation

- Create a tenant per suite with `createE2eTenant` / `createTestTenant`. Scope Prisma with `createTenantAwarePrisma`. Assert on that tenant's rows only.
- `auto_core_test` stays empty/unseeded, same as CI. Do not depend on demo or landing-demo data in backend e2e.
- Each test builds its own records (helpers such as `createWorkshopInvoicingSuite`, `createWorkshopVehicle`). Do not rely on another `it` having run first.
- Some e2e files `TRUNCATE` shared tables. That is why a full local suite cannot run in parallel; CI shards each have their own database. Never add a new global truncate if a tenant-scoped cleanup will do.
- Frontend tests do not share component state or mocked-router state across cases; reset in `afterEach`.

## No sleeps

Do not add `await new Promise((r) => setTimeout(r, n))` or Playwright `page.waitForTimeout(n)` to wait for work to finish. Wait for the condition (response, row, status, event). See `condition-based-waiting.md`. Playwright: use web-first `expect(locator).…`, which retries, not `expect(await locator.textContent())`.

A fixed delay is allowed only when the behaviour under test *is* the interval (debounce, idle timeout, scheduler tick). Write a comment that states the interval and why a condition wait cannot replace it. Prefer fake timers / `page.clock.fastForward` so the test does not actually sleep.

## No test-only branches or suppressions

- No `if (process.env.NODE_ENV === 'test')` shortcuts, no hidden test-only endpoints, no production methods that exist only so a test can call them (see `writing-good-tests.md`).
- Do not add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `fallow-ignore`, `it.skip`, or `test.only` to make a gate green (`.agents/skills/acp-code-health/SKILL.md`).
- Do not grow `tools/spec-quality-baseline.json` or any other ratchet baseline. Baselines only shrink.

## Assert behaviour, not implementation

- Name the production break the test would catch (`agents.md`, `writing-good-tests.md`).
- Assert through the public API (HTTP, exported function, rendered UI). No `as any`, no `['privateMethod']`.
- Do not green-light a test by reading back only what the test's own fake wrote.
- No existence-only assertions (`toBeDefined` as the only check, bare `toHaveBeenCalled()`).
- Derive expected values by hand; do not reuse the code under test to build both sides.
- Extend the existing spec for the unit under test; never add `<file>.<fix>.spec.ts`. Use `it.each` for data variants.

## Unit vs e2e

| Choose | When |
|---|---|
| Backend e2e (`test/*.e2e-spec.ts`) | HTTP + DB + tenant rules, invoicing, credit notes, settlement, fiscal lock, cross-module flows. Start from `purchase-receipt.e2e-spec.ts` / the invoicing helpers. |
| Backend unit (`src/**/*.spec.ts`) | Pure logic, mappers, snapshots, calculators, validators. Fast, no Postgres. |
| Frontend unit (Vitest) | Component or hook behaviour, formatting, guards. |
| Playwright | A real browser path (navigation, offline, visual). Run only the file you changed locally. |

If an e2e already covers the flow, extend that e2e or extract the pure logic and unit-test it. Do not add a heavily mocked unit test that retells the same story.

Ticket WHEN/THEN scenarios map to exactly one test, preferably in the existing spec (`agents.md`).

## Anti-patterns (repo-real)

| Don't | Why | Do instead |
|---|---|---|
| `date: '2026-11-14'` on a credit note for an invoice issued with `new Date()` (`settlement.e2e-spec.ts`) | Breaks at UTC midnight | Derive from `invoice.date`, or stamp both from one fixture |
| Hardcoded credit/lock/due dates next to "today" | Same class of failure, often later at month-end | One clock for the whole scenario |
| `waitForTimeout(1000)` / `setTimeout(..., 2500)` (several Playwright specs, `warranty-claim.e2e-spec.ts`) | Flaky under load | Condition-based wait, or fake timers if testing an interval |
| New `<feature>.<bug>.e2e-spec.ts` | Diverges from the canonical spec | Extend the existing file + shared factory |
| `expect(res.body.id).toBeDefined()` as the only assertion | Proves almost nothing | Assert the field and the business outcome |
| Mock-heavy unit test that duplicates an e2e | Double maintenance, weak signal | Extend the e2e or test the pure function |
| Leaving `setLoanerNowForTests(...)` set after the case | Later tests in the file inherit the frozen clock | Reset in `afterEach` |
| `test.skip` / new baseline line to silence a gate | Hides the failure | Fix the test or the product |

## Bug findings and reviews

- **Red-on-base rule for bug findings:** A review finding of type **bug** counts only with a test that is **red** on the PR base (or old code) and **green** after the fix; otherwise it is a **note**, not a blocker.
- **Fresh-session review:** Reviews run in a fresh session without the implementer's history.
- **Stop after 2 failed fixes:** After 2 failed fix attempts on the same finding, stop, write what was tried, and request a root-cause note from the SE (see [systematic-debugging](../superpowers/systematic-debugging/SKILL.md)).
- **CI enforcement:** Enforced on `bug`-labeled PRs by the **Bug Regression at Base** job (`.github/workflows/bug-regression-at-base.yaml`, see [Bug Regression at Base (CI)](#bug-regression-at-base-ci)). No bypass exists other than its reviewed `regression-test: n/a — <reason>` escape line in the PR body.

## Pre-push checklist

Before pushing a change that adds or edits tests:

- [ ] The test names the break it catches; I watched it fail for the right reason when the behaviour was missing (TDD, unless the change is a pure refactor).
- [ ] Bug fix: new/changed test fails on base.
- [ ] No new calendar literal is compared with "now" or with a record dated "today". Dates are derived from created records, or the whole scenario uses one fixture/injected clock (reset afterwards).
- [ ] I thought about UTC vs `Europe/Vienna` and midnight / month / year / `lock_date` boundaries.
- [ ] No new sleep / `waitForTimeout` unless the interval itself is the behaviour and is documented.
- [ ] No new skip, suppression, or baseline growth.
- [ ] Tenant-scoped data; no dependency on run order or on a seeded `auto_core_test`.
- [ ] Assertions go through the public API and check behaviour, not mocks or `toBeDefined`.
- [ ] I ran only the local checks in `agents.md`: lint and typecheck/build for the workspace, related unit tests, and only the e2e/Playwright files I added or changed (backend e2e: migrate a fresh unseeded `auto_core_test`, then `npm run test:e2e --workspace=core-api -- --ci --runInBand test/<file>.e2e-spec.ts`). I did not run the full e2e suites.

## Bug Regression at Base (CI)

PRs labeled `bug` (or `Bug`) run `.github/workflows/bug-regression-at-base.yaml` (`.github/scripts/bug-regression-at-base.mjs`) in addition to the full CI and e2e suites (it never replaces or skips full e2e):

- **How it works:** Checks out the PR merge-base, copies **only** the PR's new or changed test files (`*.spec.ts`, `*.e2e-spec.ts`, `*.test.ts`, `*.test.tsx`) and test-only helpers/fixtures (`test/helpers/**`, `test/fixtures/**`, `e2e/utils/**`, `e2e/fixtures/**`, `__fixtures__/**`, `*.fixture.*`, `*.test-helper.*`, `src/test/**`), and runs them against the base code (unit/API first, then e2e where needed).
- **Pass condition:** Green **only** when at least one overlaid regression test (or suite) **fails** on the base branch; the failing test names are listed in the GitHub Actions job summary. If all tests pass on base, the job fails.
- **No-test escape hatch:** A `bug` PR with no new or changed test fails unless the PR body contains an explicit, reviewed line with a reason:
  ```text
  regression-test: n/a — <reason, e.g. config-only fix>
  ```
  When present with a non-empty reason, preflight marks the check neutral and prints the reason in the summary.

## Credits

Adapted for ACP from (all MIT; already-vendored sources are linked, not copied):

- [obra/superpowers](https://github.com/obra/superpowers) (Jesse Vincent) — TDD, writing-good-tests, condition-based-waiting (already under `.agents/skills/superpowers/`).
- [PramodDutta/qaskills](https://github.com/PramodDutta/qaskills) `claude-code-qa` — deterministic-by-default, freeze the clock, no fixed sleeps, flaky-test causes.
- [lgbarn/shipyard](https://github.com/lgbarn/shipyard) `shipyard-testing` — anti-pattern table shape, observable behaviour, isolation.
- [testdino-hq/playwright-skill](https://github.com/testdino-hq/playwright-skill) — web-first assertions, `page.clock`.
- [AratKruglik/claude-sdlc](https://github.com/AratKruglik/claude-sdlc) `nest-testing` — NestJS + supertest mapping (ACP already has `createE2eApp`).
- `.agents/skills/typescript/clean-tests` (Clean Code / TypeScript catalog, already vendored).
