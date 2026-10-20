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
| Other pages with cards under a section heading | Audited for AUT-472 in the same file only: `CheckoutSummary`. Not scanned. | Add the page to `e2e/a11y-heading-order.spec.ts` when it changes. |

## Form inline errors (AUT-478)

- A field with an inline validation error carries `aria-invalid="true"` and an `aria-describedby` that points at its error element. Error elements usually get the id `<field>-error`. `InlineEdit` uses `useId`, shadcn `FormMessage` uses `<useId>-form-item-message`, and the trade-in message and the shortening reason use fixed ids. The reference is only set while the error is shown.
- shadcn `FormControl` and `FormMessage` do this for react-hook-form forms. Raw `register` forms and hand-rolled validation set the attributes per field.
- Announcements: a single field's manual validation announces its error with `role="alert"`, matching `WarrantyClaimEditor`, `DocumentBrandingSettings` and `InlineEdit`. That covers the credit-note quantity inputs and the Garantie duration input. `LaborOperationFormDialog` does not announce its field errors. It validates every required field on each autosave, so an alert would fire for fields the user has not reached. Those errors are read when focus reaches the field. A failed save is announced as an alert next to the save status, not as a field error. react-hook-form forms (`StartServiceDialog`, `QuickRegisterDialog`, `CustomerDialog`, `VehicleDialog`, `SalesOrderCreate`) keep react-hook-form's focus on the first invalid field, which they already do.
- Covered: `InlineEdit` (text and textarea), `StartServiceDialog`, `QuickRegisterDialog`, `LaborOperationFormDialog` (including fitment rows), the credit-note quantity inputs on `CreateCreditNoteDialog` and `CreditNoteDetailPage`, the Garantie duration input and the shortening checkbox on `VehicleSalePage`, and the trade-in field behind the validation message on `VehicleSaleTradeInSection`.
- Unit-tested with `expectFieldErrorLinked` and `expectFieldValid` from `src/test/form-a11y.ts`: `InlineEdit` (text and textarea), `StartServiceDialog`, `QuickRegisterDialog`, `LaborOperationFormDialog` (fitment rows included), the Garantie input and shortening checkbox on `VehicleSalePage`, the trade-in section, and the shared `Form` primitive. `CreateCreditNoteDialog` and `CreditNoteDetailPage` have no unit test (see the table).

| Area | Finding | Follow-up |
| --- | --- | --- |
| `LoginPage` | Both fields reference the single login alert. Each field is marked invalid only while it is empty, so a failed sign-in with both fields filled marks neither. | Confirm the intended behavior before changing it. |
| shadcn `FormControl` | Always references its description id, even when no `FormDescription` is rendered. Harmless to assistive technology, not an axe failure. | Reference the description only when one is rendered. |
| `CreateCreditNoteDialog` | No unit test. The dialog's partial mode sits behind a Radix Select, and jsdom needs pointer shims the repo does not have. | Add the shims or cover it in e2e. |

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

## Smoke coverage and gates (AUT-482)

- `e2e/a11y-smoke.spec.ts` scans 15 routes from `e2e/utils/a11y-smoke-routes.ts` with `expectNoCriticalA11yViolations`: sales order detail, customer detail, workshop order detail, purchase order detail, the workshop board, four settings tabs (finance, brands, storage locations, labor), the customers list with the Add Customer dialog open, and the sales orders, purchase orders, inventory, vehicle stock and vendors lists. Each route mocks the API calls it needs, so the scan reads rendered content, not an error state.
- The scan runs the WCAG 2.2 AA tags (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`) plus `best-practice`. AAA is out of scope. `serious` and `critical` fail the build. `moderate` and `minor` are attached as `accessibility-backlog-violations` and do not fail it.
- `color-contrast` fails at any impact (`FAIL_RULE_IDS` in `e2e/utils/a11y.ts`). axe already rates it `serious`, so this makes the rule explicit rather than changing what fails today.
- `A11Y_ALLOWLIST` stays empty. No axe finding on the new routes is allowlisted.
- The scan settles the page first: CSS animations are frozen and `.animate-spin` loaders must be gone. A fade still in progress reads as a contrast failure that depends on timing.

Trivial contrast and layout fixes made while widening coverage (class changes only):

| Where | Change | Measured |
| --- | --- | --- |
| `BrandTable` brand initials | `text-slate-400` → `text-slate-500` | 2.51:1 → passes AA |
| `SettingsPage` storage location code badge | `text-slate-400` → `text-slate-500` | 2.63:1 → passes AA |
| `ui/alert` destructive variant | `text-destructive` (`#ef4444`) → `text-red-700`, dark mode `text-red-400` | 3.76:1 on white → passes AA. Affects every destructive alert, e.g. "Kostenvoranschlag nicht verfügbar" |
| `SalesOrderDetail` header and `CustomerDetail` action rows | `flex-wrap` on the header and action rows | 200% zoom no longer overflows |

## Reflow at 320px (AUT-482)

WCAG 1.4.10 is not met on the desktop routes yet. The smoke spec measures `document.body` at a 320px viewport on every route, and attaches the result as `reflow-320-overflow`. Below `md` the sidebar is a closed sheet, so the 320px measurement sees the page content on its own. It fails the build only for the routes in `REFLOW_320_GATED_ROUTES`: the inventory list, the settings brands tab and the settings storage locations tab, which fit at this width in that state. The other routes are report-only until the shell follow-up lands.

Measured causes at 320px:

- Most other routes still overflow at 320px. `PageContainer` (`w-full max-w-page mx-auto p-6`) ended at x=336 when the sidebar was expanded, before the sheet change. Page header rows, breadcrumbs and header button groups do not wrap, the sales orders and vehicle stock tables and the workshop board toolbar extend past the page instead of scrolling in their own wrapper, and the board columns (`w-max`) do the same.

Follow-up: wrapping header rows and breadcrumbs, scrolling table wrappers, and containing the board columns. Then add each route to `REFLOW_320_GATED_ROUTES`.

## 200% zoom on the key pages (AUT-482)

At a 640 CSS px layout viewport (200% zoom on a 1280 px desktop) the sales order detail, customer detail and workshop order detail pages fail the build on horizontal scroll. The other routes are not checked at 200% yet.

## Manual checklist: WCAG 1.4.13 and 4.1.3 (AUT-482)

Verified against the code. Not yet run with a screen reader or on a pointer-and-keyboard pass. Work through it before a release.

WCAG 1.4.13 (content on hover or focus), tooltips:

- Code: `src/components/ui/tooltip.tsx` wraps Radix Tooltip 1.2.16. `TooltipHint` opens on hover and focus, and does not disable hoverable content, so the Radix defaults apply.
- [ ] Hover a control with a `TooltipHint`: the hint appears after the 300 ms default delay.
- [ ] Press Escape while the hint is open: it closes and focus stays on the control (dismissible).
- [ ] Move the pointer from the control onto the hint text: the hint stays open (hoverable).
- [ ] Leave both the control and the hint: the hint closes. It stays open while hovered or focused (persistent).
- [ ] Tab to the control: the hint shows on focus, and Escape dismisses it.
- [ ] Icon-only controls labelled only with a native `title` attribute do not meet 1.4.13 (a native tooltip cannot be dismissed or hovered). Move them to `TooltipHint`.

WCAG 4.1.3 (status messages), toasts:

- Code: the sonner 2.0.8 toast list renders with `aria-live="polite"`. `Toaster` is mounted in `AppMain`, `MechanicShell` and `LoginRoute` in `src/App.tsx`.
- [ ] With VoiceOver or NVDA running, save order notes on a sales order detail page. "Order notes saved" is announced once, politely, and focus does not move.
- [ ] Trigger a save failure. The error toast is announced. Field-level errors still use an inline `role="alert"` or `aria-describedby` (see the form section above), so a toast is not the only signal.
- [ ] A message shown in a toast is not announced a second time by an inline `role="alert"` for the same event.
