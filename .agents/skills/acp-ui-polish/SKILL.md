---
name: acp-ui-polish
description: Use when building or changing UI in apps/core-web (pages, components, tables, forms, layout, styling, tokens, states, a11y), when reviewing UI PRs, or when the user mentions UI polish, design system, shadcn or Tailwind.
license: AGPL-3.0-or-later
---

# ACP UI polish (apps/core-web)

This skill pins every UI change in `apps/core-web` to one rule set. Read it before the first line of JSX or CSS, and use section 8 to review UI PRs.

Two kinds of rule appear below:
- **Today:** the component, token or pattern exists on `main`. Use it.
- **Target:** the rule names a piece that lands later (T2 = AUT-655 tokens and fonts, T3 = AUT-656 sidebar, T5 = PageHeader, T6 = AUT-659 migration). Use a target only after it exists. Until then, follow the existing pattern named next to it. This skill describes targets; it does not implement them.

## 1. Stack facts

- **UI kit:** shadcn/ui, style `new-york`, on Radix primitives (`apps/core-web/components.json`). Base components live in `apps/core-web/src/components/ui/`, for example `button.tsx`, `alert-dialog.tsx`, `skeleton.tsx`, `table.tsx`.
- **New base components** come only from `npx shadcn add <name>`, run in `apps/core-web`. Never hand-copy a shadcn file, and never bend a `ui/` file to fit one screen. Wrap it in a feature component instead.
- **Tailwind 4 is CSS-first.** Theme tokens live in `apps/core-web/src/index.css` (`@theme`). Do not add a `tailwind.config.js`. `components.json` still names one that does not exist; that fix is T2.
- **Icons:** `lucide-react`, used in 122 files. Do not use `@radix-ui/react-icons` in new UI. The package is still in `package.json`, but no file under `apps/core-web/src` imports it today.
- **Tables:** TanStack Table v9 (`@tanstack/react-table` ^9.1.2) sits behind `apps/core-web/src/components/data-table/DataTable.tsx`. Pages pass columns and rows to `DataTable`; no page calls the table hook itself.
- **Forms:** react-hook-form and zod, with the `Form` primitives in `apps/core-web/src/components/ui/form.tsx`.
- **Toasts:** sonner (`apps/core-web/src/components/ui/sonner.tsx`). **Charts:** Recharts, currently used in `apps/core-web/src/features/dashboard-widgets/DashboardWidgetsGrid.tsx`.

```tsx
// Do: icons from lucide-react
import { Trash2 } from 'lucide-react'

// Don't: Radix icon package in new UI
import { TrashIcon } from '@radix-ui/react-icons'
```

## 2. Tokens, not palette

Semantic classes resolve to the ACP colors defined in `apps/core-web/src/index.css`.

```tsx
// Do
<p className="text-sm text-muted-foreground">{hint}</p>
<section className="rounded-md border border-border bg-card p-4">...</section>

// Don't
<p className="text-sm text-slate-600">{hint}</p>
<section className="rounded-md border border-gray-200 bg-white p-4">...</section>
```

- No `slate-*`, `gray-*` or `amber-*` classes (or any other palette scale) in new code. 186 files under `apps/core-web/src` use them today; do not add to that count. Do not copy the palette from `apps/core-web/src/components/ui/PageLoader.tsx`.
- **Target (T2, AUT-655):** status colors (success, warning, info) and the sidebar and chart tokens. Until they exist, show state with text and an icon, and use `text-destructive` for errors.
- No arbitrary font sizes such as `text-[11px]`. Use the scale (`text-xs`, `text-sm`). 21 files still use `text-[Npx]`.
- Spacing comes from the scale (`gap-4`, `p-6`). An arbitrary value needs a one-line comment that says why.
- Merge class names with `cn()` from `@/lib/utils`, as `apps/core-web/src/components/layout/PageContainer.tsx` does.

## 3. States: loading, empty, error

Every list and detail page renders all three states. Build them before the happy path.

- **Loading:** a `Skeleton` (`apps/core-web/src/components/ui/skeleton.tsx`) shaped like the final content: rows for tables, blocks for cards. No spinner stands in for content. Show the skeleton after a 150–300 ms delay, so a fast response does not flash. `PageLoader` (`apps/core-web/src/components/ui/PageLoader.tsx`) is the route-level fallback used in `apps/core-web/src/App.tsx` and `apps/core-web/src/app/AppRouteTree.tsx`. It is not a content loader.
- **Empty:** say what is missing and offer one action, such as "Kunde anlegen". A table passes `emptyStateMessage` to `DataTable`; the default is `dataTable.noResults` ("Keine Ergebnisse."). A page-level empty state uses a shadcn Empty block (**target:** add it with `npx shadcn add` when the first page needs it). Until then, use a `Card` with one sentence and one `Button`.
- **Error:** one German sentence in Sie-form that says what happened and what to do, plus a Retry button that refetches. Never render raw API text. The backend sends codes, and the client maps them to the `errors` namespace (see `.agents/skills/acp-i18n/SKILL.md`).

```tsx
// Do: error copy plus Retry
<p>Die Kunden konnten nicht geladen werden. Bitte versuchen Sie es erneut.</p>
<Button variant="outline" onClick={() => refetch()}>{t('common:actions.retry')}</Button>

// Don't: raw error text from the API, no action
<p>{error.message}</p>
```

`common:actions` has no `retry` key yet. Add `retry` ("Erneut versuchen" in `locales/de/common.json`, "Try again" in `locales/en/common.json`) when you need it.

- **Buttons while saving:** keep the label, add a spinner, disable the button, and use the ellipsis form ("Speichern…"). Do not swap the label for a different phrase.

```tsx
// Do: same label, spinner, disabled. Add actions.saving next to actions.save in both locales.
<Button disabled={isPending}>
  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
  {isPending ? t('common:actions.saving') : t('common:actions.save')}
</Button>

// Don't: stays clickable while pending, so a double submit is possible
<Button onClick={save}>{t('common:actions.save')}</Button>
```

The spinner-in-button pattern already exists in `apps/core-web/src/features/purchase-bills/components/PurchaseBillPageHeader.tsx`. Copy its spinner, not its `bg-blue-600` color.

## 4. Tables and numbers

- Every list is a `DataTable` (`apps/core-web/src/components/data-table/DataTable.tsx`). Sorting (`data-table-column-header.tsx`), column options (`data-table-view-options.tsx`) and CSV export (`data-table-csv.ts`) come with it. Model: `apps/core-web/src/pages/customers/CustomerList.tsx`, where each sortable header is a `DataTableColumnHeader`.
- **No raw `<table>` in new code.** Seven app files still hand-write one, for example `apps/core-web/src/pages/vehicle-stock/VehicleStockReportsPage.tsx`. Move a file to `DataTable` when you touch it. The area-by-area migration is T6 (AUT-659).
- Numbers are right-aligned with `text-right tabular-nums`, as in `apps/core-web/src/components/labor/LaborOperationsTab.tsx`.
- Amounts and dates come only from `@/lib/format` (`apps/core-web/src/lib/format/`).

```tsx
// Do
import { formatCurrency } from '@/lib/format'
<TableCell className="text-right tabular-nums">{formatCurrency(row.original.total)}</TableCell>

// Don't: hand-rolled number and currency formatting
<TableCell>{row.original.total.toFixed(2)} €</TableCell>
<TableCell>{new Intl.NumberFormat('de-AT').format(row.original.total)}</TableCell>
```

`apps/core-web/src/lib/utils.ts` re-exports `formatCurrency` for older code. Do not add new imports from it. ESLint already rejects direct `Intl` use outside `src/lib/format/`.

## 5. Layout

- **Today:** admin pages render inside `PageContainer` (`apps/core-web/src/components/layout/PageContainer.tsx`). It adds `p-6`, takes the page width from the `--container-page` token, and accepts optional breadcrumbs.
- **Target (T5):** `PageHeader`. Until it exists, follow the existing `components/layout` pattern: wrap the page in `PageContainer` and build the header inline as a flex row with `gap-4`, one `h1` with `text-2xl font-semibold tracking-tight`, and actions on the right. `apps/core-web/src/features/purchase-bills/components/PurchaseBillPageHeader.tsx` shows the markup.
- **Spacing:** sections on a page use `gap-6`. Cards and form groups inside a section use `gap-4`.
- **Dense B2B look, not a marketing look.** Default controls are `h-9` (`apps/core-web/src/components/ui/button.tsx`), tables are compact, and work screens have no hero blocks, gradients or decorative illustrations.

```tsx
// Do: shared wrapper, section gaps, table from the shared component
const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })

<PageContainer breadcrumbs={crumbs}>
  <div className="flex flex-col gap-6">
    <div className="flex items-center justify-between gap-4">...</div>
    <DataTable columns={columns} data={rows} {...tableState} />
  </div>
</PageContainer>

// Don't: marketing spacing and a custom width that ignores --container-page
<div className="mx-auto max-w-5xl space-y-16 px-12 py-20">...</div>
```

## 6. Interaction and a11y

- **Visible focus:** every control shows a `focus-visible` ring. The base button already does (`apps/core-web/src/components/ui/button.tsx`: `focus-visible:ring-1 focus-visible:ring-ring`). Never remove an outline without a replacement ring.
- **Links are links.** Navigation uses react-router's `<Link>`, as `apps/core-web/src/components/data-table/data-table-row-link.tsx` does, so middle-click and copy-link work.

```tsx
// Do
<Link to={`/customers/${id}`}>{name}</Link>

// Don't: a link without href, no keyboard access, no copy-link
<span onClick={() => navigate(`/customers/${id}`)}>{name}</span>
```

- **Destructive actions are confirmed** with `AlertDialog` (`apps/core-web/src/components/ui/alert-dialog.tsx`), as `PurchaseBillPageHeader.tsx` does. Never call a delete mutation straight from `onClick`.
- **Deep links:** filters, sort, page size and tabs live in the URL. `apps/core-web/src/hooks/useDataTableQuery.ts` reads page, pageSize, search, sortField and sortDirection from the query string. `CustomerList.tsx` opens its create dialog from `?action=create`. Keep view state in `useState` only when it must not survive a reload.
- **Reduced motion:** every loop or large motion honors `prefers-reduced-motion` (Tailwind `motion-safe:` and `motion-reduce:`, or framer-motion's `useReducedMotion`). Only `apps/core-web/src/App.css` mentions it today. `PageLoader.tsx` loops without a check; do not copy that.
- **Hit targets** are at least 24 × 24 CSS px. Icon-only buttons use `size="icon"` (36 px).
- **Labels:** an icon-only button gets an `aria-label`, as the back button in `PurchaseBillPageHeader.tsx` has.
- **Automated check:** `apps/core-web/e2e/a11y-smoke.spec.ts` fails the build on serious or critical axe findings and on color-contrast problems, route by route. It also checks reflow at 320 px and no horizontal scroll at 200% zoom.

## 7. Visual design

Adapted from Anthropic's `frontend-design` skill (Apache-2.0), toned down for a dealer management system (DMS).

- **Hierarchy by weight and size first, color second.** One `h1` per page, section titles `font-semibold`, metadata `text-sm text-muted-foreground`.
- **Calm surfaces.** The page sits on `bg-background`; groups sit on `bg-card` with `border-border`. No stacked shadows, gradients or saturated fills.
- **One accent.** `bg-primary` marks the single primary action in a view. Other buttons are `outline`, `secondary` or `ghost` (`apps/core-web/src/components/ui/button.tsx`). Otherwise color only signals state.
- **Motion explains a change** (a panel opens, a save completes). It stays short and is off under reduced motion.
- **Typography:** Inter via `@fontsource/inter` today. Font and theme changes belong to T2 (AUT-655), not to a feature PR.

```tsx
// Do: one primary action per panel
<Button>{t('common:actions.save')}</Button>
<Button variant="outline">{t('common:actions.cancel')}</Button>

// Don't: three competing colored calls to action
<Button className="bg-blue-600">...</Button>
<Button className="bg-green-600">...</Button>
```

## 8. Review checklist for UI PRs

Paste this into the PR body and tick every line.

- [ ] **Screenshots:** before and after for every changed screen, at desktop width and at 390 px, in the PR body. Docs-only PRs write `Screenshots: n/a (docs-only, no UI change)`.
- [ ] **States:** loading, empty, error and loaded each checked in the browser.
- [ ] **Rules grep:** no new `slate-`, `gray-` or `amber-` classes, no `text-[Npx]`, no raw `<table>`, no `@radix-ui/react-icons` import, no `toLocaleString` or `Intl` outside `src/lib/format/`.
- [ ] **Keyboard:** a keyboard-only pass over the change, with a visible focus ring on every control.
- [ ] **Playwright:** the CI jobs "Frontend Lint, Build and Unit Tests" and "Frontend UI Smoke" are green. Read the smoke job log, not only the check mark. The axe spec is `apps/core-web/e2e/a11y-smoke.spec.ts`.
- [ ] **i18n:** every new string exists in `locales/de` and `locales/en`. `npm run i18n:check` and `npm run lint --workspace=core-web` pass. Rules: `.agents/skills/acp-i18n/SKILL.md`.
- [ ] **Repowise:** `npm run repowise:gate -- --base origin/main` passes locally, and the CI log line `Repowise health gate passed` is quoted in the PR. The job is advisory, so the log line is the proof. New source files score at least 6.0, and changed files must not get worse. Rules: `.agents/skills/repowise-gate/SKILL.md`.
- [ ] **Scope:** the PR does not implement a target (T2 tokens, T3 sidebar, T5 PageHeader, T6 migration) by accident.

## Sources and licenses

- [vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines), MIT License, Copyright (c) 2025 Vercel Labs. Section 6 condenses its interaction and accessibility guidance.
- [anthropics/skills, `skills/frontend-design`](https://github.com/anthropics/skills/tree/main/skills/frontend-design), Apache License 2.0. Section 7 adapts its visual-design guidance.

Both sources are paraphrased; no text is copied. The rules above are ACP's own. The sources are credited here, not vendored.
