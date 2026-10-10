# Accessibility backlog (axe-core)

Tracked items that are **not** enforced in CI (moderate/minor) or explicitly allow-listed while a follow-up ships.

## Allow-listed (critical/serious)

| Rule | Scope | Reason | Follow-up |
| --- | --- | --- | --- |
| _(none)_ | — | Phase 2 (AUT-379) cleared critical/serious on the eight core smoke pages. | — |

## Moderate / minor (report-only in Playwright)

Moderate and minor findings are attached per test run as `accessibility-backlog-violations` and summarized in the AUT-379 PR. Triage new entries here when promoting them to enforced checks.

## Icon-only control names (AUT-471)

- **Lint (enforced):** `jsx-a11y/control-has-associated-label` is an error in `apps/core-web/eslint.config.js`. It checks `Button`, `Link`, `NavLink`, and DOM buttons and links. Give an icon-only control an `aria-label` that names its action or target (for example `Back to sales orders`, `Delete brand Acme`). A `title` alone does not satisfy the rule.
- **Why `'*'` is in `controlComponents`:** lucide icons such as `<ArrowLeft />` are custom components with no children. Without `'*'` the rule assumes they render text and misses icon-only controls.
- **Ignored elements:** `input`, `select`, and `textarea` are named through `<label>`, which `label-has-associated-control` already enforces.
- **Per-site exceptions (documented in place with `eslint-disable-next-line ... -- reason`):**
  - `components/hr/EmployeeTable.tsx`: the status toggle's name comes from the `StatusBadge` text.
  - `components/settings/WorkshopHoursSettingsTab.tsx`: datalist `<option>` suggestions are named by their value.
- **E2E (enforced):** `apps/core-web/e2e/a11y-accessible-names.spec.ts` runs axe with only the `button-name` and `link-name` rules on the sales order detail page and Settings > Brands.
