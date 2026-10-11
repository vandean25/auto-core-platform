# Accessibility backlog (axe-core)

Tracked items that are **not** enforced in CI (moderate/minor) or explicitly allow-listed while a follow-up ships.

## Allow-listed (critical/serious)

| Rule | Scope | Reason | Follow-up |
| --- | --- | --- | --- |
| _(none)_ | — | Phase 2 (AUT-379) cleared critical/serious on the eight core smoke pages. | — |

## Heading order (AUT-472)

- `CardTitle` renders an `h2` by default: the level for a card directly under the page `h1`. Pass `as` for a card under another section heading (`as="h3"` under an h2 section, `as="h4"` under an h3 section). `AlertTitle` keeps its `h5` default and takes `as` the same way; the estimate alerts under the Kostenvoranschlag card use `as="h3"`.
- Enforced: axe `heading-order` on the sales order detail, customer detail and workshop order detail (checkout open included), in `e2e/a11y-heading-order.spec.ts` through `expectNoHeadingOrderViolations` in `e2e/utils/a11y.ts`. axe rates `heading-order` moderate, so `expectNoCriticalA11yViolations` does not fail on it.

| Area | Finding | Follow-up |
| --- | --- | --- |
| Settings page | Section headings (`Storage Locations`, `Fiscal Control`, ...) are `h3` directly under the page `h1`, so the outline jumps h1 → h3. Not scanned. | Promote the section headings to `h2`, then check the card levels under them. |
| `AlertTitle` outside the estimate card (HR clock and leave, planner, data import, mechanic away) | Default `h5` can follow a heading with a jump. Not scanned. | Pass `as` per call site, or render a non-heading element where the title is not a section. |
| Other pages with cards under a section heading | Audited for AUT-472 in the same file only: `MarginRulesTab`, `LaborCategoriesTab`, `SettingsPage`, `CheckoutSummary`. Not scanned. | Add the page to `e2e/a11y-heading-order.spec.ts` when it changes. |

## Moderate / minor (report-only in Playwright)

Moderate and minor findings are attached per test run as `accessibility-backlog-violations` and summarized in the AUT-379 PR. Triage new entries here when promoting them to enforced checks.

## Icon-only control names (AUT-471)

- **Lint (enforced):** `jsx-a11y/control-has-associated-label` is an error in `apps/core-web/eslint.config.js`. It checks `Button`, `Link`, `NavLink`, and DOM buttons and links. Give an icon-only control an `aria-label` that names its action or target (for example `Back to sales orders`, `Delete brand Acme`). A `title` alone does not satisfy the rule.
- **Why `'*'` is in `controlComponents`:** lucide icons such as `<ArrowLeft />` are custom components with no children. Without `'*'` the rule assumes they render text and misses icon-only controls.
- **Ignored elements:** `input` and `textarea` are not checked by this rule. Their names come from a `<label>`, and `label-has-associated-control` only checks that each `<label>` has a control, not that every field has a label.
- **Per-site exceptions (documented in place with `eslint-disable-next-line ... -- reason`):**
  - `components/hr/EmployeeTable.tsx`: the status toggle's name comes from the `StatusBadge` text.
  - `components/settings/WorkshopHoursSettingsTab.tsx`: datalist `<option>` suggestions are named by their value.
- **E2E (enforced):** `apps/core-web/e2e/a11y-accessible-names.spec.ts` runs axe with only the `button-name` and `link-name` rules on the sales order detail page and Settings > Brands.
