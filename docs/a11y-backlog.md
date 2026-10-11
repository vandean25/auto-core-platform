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

## Form inline errors (AUT-478)

- A field with an inline validation error carries `aria-invalid="true"` and an `aria-describedby` that points at its error element. Error elements usually get the id `<field>-error`. `InlineEdit` uses `useId`, shadcn `FormMessage` uses `<useId>-form-item-message`, and the trade-in message and the shortening reason use fixed ids. The reference is only set while the error is shown.
- shadcn `FormControl` and `FormMessage` do this for react-hook-form forms. Raw `register` forms and hand-rolled validation set the attributes per field.
- Announcements: a single field's manual validation announces its error with `role="alert"`, matching `WarrantyClaimEditor`, `DocumentBrandingSettings` and `InlineEdit`. That covers the credit-note quantity inputs and the Garantie duration input. `LaborOperationFormDialog` does not announce its field errors. It validates every required field on each autosave, so an alert would fire for fields the user has not reached. Those errors are read when focus reaches the field. A failed save is announced as an alert next to the save status, not as a field error. react-hook-form forms (`StartServiceDialog`, `QuickRegisterDialog`, `CustomerDialog`, `VehicleDialog`, `SalesOrderCreate`) keep react-hook-form's focus on the first invalid field, which they already do.
- Covered: `InlineEdit` (text and textarea), `StartServiceDialog`, `QuickRegisterDialog`, `LaborOperationFormDialog` (including fitment rows), the credit-note quantity inputs on `CreateCreditNoteDialog` and `CreditNoteDetailPage`, the Garantie duration input and the shortening checkbox on `VehicleSalePage`, and the trade-in field behind the validation message on `VehicleSaleTradeInSection`.
- Unit-tested with `expectFieldErrorLinked` and `expectFieldValid` from `src/test/form-a11y.ts`: `InlineEdit` (text and textarea), `StartServiceDialog`, `QuickRegisterDialog`, `LaborOperationFormDialog` (fitment rows included), the Garantie input and shortening checkbox on `VehicleSalePage`, the trade-in section, and the shared `Form` primitive. `CreateCreditNoteDialog` and `CreditNoteDetailPage` have no unit test (see the table).

| Area | Finding | Follow-up |
| --- | --- | --- |
| Credit-note quantity inputs | No accessible name. The column header is the only label. | Add an `aria-label` per line. |
| `LoginPage` | Both fields reference the single login alert. Each field is marked invalid only while it is empty, so a failed sign-in with both fields filled marks neither. | Confirm the intended behavior before changing it. |
| shadcn `FormControl` | Always references its description id, even when no `FormDescription` is rendered. Harmless to assistive technology, not an axe failure. | Reference the description only when one is rendered. |
| `CreateCreditNoteDialog`, `CreditNoteDetailPage` | No unit test. The dialog's partial mode sits behind a Radix Select, and jsdom needs pointer shims the repo does not have. The page has no Select; its data hooks would need mocking. | Add a hook-mocked page test. For the dialog, add the shims or cover it in e2e. |

## Moderate / minor (report-only in Playwright)

Moderate and minor findings are attached per test run as `accessibility-backlog-violations` and summarized in the AUT-379 PR. Triage new entries here when promoting them to enforced checks.
