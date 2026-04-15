---
title: "WorkshopOrderPickDrawer"
date: "2026-04-15"
tags:
  - component-spec
  - workshop
  - inventory
  - kitting
  - shadcn
---

# WorkshopOrderPickDrawer

## Component Overview & File Path

`WorkshopOrderPickDrawer.tsx` is the warehouse execution surface for Project 1 (Parts Kitting & Tote Staging). It opens from the Workshop pick list row click and guides a worker through:

1. Reviewing required `WorkshopTaskLineItem` parts.
2. Entering pick quantities per line.
3. Selecting one destination tote (`StorageLocation.type === 'staging_tote'`).
4. Submitting one atomic pick operation to `POST /api/workshop/:id/pick-parts`.

Target runtime file path:

- `apps/core-web/src/features/workshop/components/WorkshopOrderPickDrawer.tsx`

Specification file path:

- `docs/internal/03-Component-Specs/workshop/WorkshopOrderPickDrawer.md`

Architectural constraints enforced by this component:

- Must use shadcn/ui `Sheet` (slide-out drawer), not centered dialog.
- Primary action (`Confirm Pick`) must live in the top-right of `SheetHeader`.
- Must trigger explicit workshop detail cache invalidation after successful mutation.
- Must keep workflow scanner-friendly by minimizing required UI steps.

## Required shadcn/ui Components

Mandatory components:

- `Sheet`, `SheetContent`, `SheetHeader`, `SheetTitle`, `SheetDescription`
- `Button` (primary + secondary)
- `Input` (per-line quantity)
- `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableCell`
- `Popover` + `Command` stack for tote selection combobox:
  - `Popover`, `PopoverTrigger`, `PopoverContent`
  - `Command`, `CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandItem`
- `ScrollArea` (required for long part lists)
- `Separator` (visual grouping between header controls and line-item grid)
- `Skeleton` (loading state)

Recommended utility components:

- `Badge` to show order status and line count.
- `Alert` for non-blocking warnings (for example, low-availability hints from API pre-checks).

Icon set (strict):

- `lucide-react` only (for example: `Package`, `Check`, `Loader2`, `Search`, `MapPin`).

Layout rule:

- Do not use `SheetFooter` for the primary CTA.
- Header right action area hosts `Confirm Pick` and optional `Cancel`.

## API & Query Hooks (TanStack Query v5)

### Query Dependencies

This component reads two data domains:

1. Workshop order pick details (required parts, current order status, existing staging assignment).
2. Available staging tote locations filtered by `type === 'staging_tote'`.

Expected hooks:

- `useWorkshopOrderPickDetailsQuery(orderId)`
- `useStorageLocationsQuery({ type: 'staging_tote' })`

Fetch strategy for totes (fixed-capacity optimization):

- Fetch all `staging_tote` locations once when the drawer opens.
- Do not use debounced server-side search for tote selection in this component.
- Use shadcn `Command` client-side filtering for instant local search across the seeded tote set.

### Mutation Hook

Required mutation:

- `useMutation` for `POST /api/workshop/:id/pick-parts`

Mutation payload contract:

```ts
{
  destinationLocationId: string,
  items: Array<{
    workshopTaskLineItemId: string,
    quantity: number,
    sourceLocationId?: string
  }>
}
```

Contract alignment requirement: backend NestJS DTO and OpenAPI schema must use `destinationLocationId` so frontend generated clients/types remain contract-accurate and naming-consistent with ADR-0012.

### Cache Invalidation Rules

On success, must invalidate at minimum:

- Workshop order detail query for the specific `orderId`.
- Any pick-list query that can reflect "requires parts" state.

Suggested pattern:

```ts
queryClient.invalidateQueries({ queryKey: workshopKeys.detail(orderId) })
queryClient.invalidateQueries({ queryKey: workshopKeys.pickList() })
```

If key names differ in repository, use the canonical equivalents in `workshopKeys.ts`.

### Toast Contract (sonner)

- Success: `toast.success('Parts picked and staged successfully.')`
- Conflict (409): `toast.error('This order was updated by another user. Data was refreshed.')`
- Validation/business error: `toast.error(errorMessageFromApi)`

## State Management & Form Handling

Local component state:

- `selectedStagingLocationId: string | null`
- `quantitiesByLineId: Record<string, string>` (string in UI to preserve raw input)
- `isSubmitting: boolean` (derived from mutation)
- `formError: string | null` (optional inline message)

Initialization rule:

- On drawer open, `quantitiesByLineId` MUST be pre-filled with each line item's remaining required quantity.
- Target workflow is zero-typing for common picks: open drawer -> select tote -> confirm.
- If user edits any quantity, edited values take precedence over prefill.
- Optional utility action: include a `Pick All` button in the table header to restore all rows to their remaining required quantities.

Derived/validated state:

- `normalizedItems`: line items where entered quantity > 0.
- `isConfirmDisabled` when:
  - no tote selected,
  - no positive quantities entered,
  - mutation pending,
  - order state is not pick-eligible.

Validation rules before mutation:

1. Destination tote is required.
2. Quantity must be numeric and > 0.
3. Quantity precision must match backend unit rules.
4. No duplicate line IDs in payload.

Submission strategy:

1. Build normalized payload from controlled inputs.
2. Call mutation once (single transaction intent).
3. On success:
   - show success toast,
   - invalidate required queries,
   - close drawer.
4. On failure:
   - preserve user-entered quantities,
   - show actionable error,
   - keep drawer open for correction/retry.

Accessibility rules:

- Focus starts on tote combobox when drawer opens.
- `Enter` on header primary button submits when enabled.
- Quantity inputs have semantic labels tied to part name and SKU.

## DOM Hierarchy & Tailwind Layout (Draft)

```tsx
<Sheet open={open} onOpenChange={onOpenChange}>
  <SheetContent side="right" className="w-full sm:max-w-3xl p-0 flex flex-col">
    <SheetHeader className="px-6 py-4 border-b">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <SheetTitle className="text-lg font-semibold">Pick Parts</SheetTitle>
          <SheetDescription className="text-sm text-muted-foreground">
            Assign parts to a staging tote for this workshop order.
          </SheetDescription>
        </div>

        <div className="shrink-0 flex items-center gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={onConfirmPick} disabled={isConfirmDisabled}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Confirm Pick
          </Button>
        </div>
      </div>
    </SheetHeader>

    <div className="px-6 py-4 space-y-4 flex-1 min-h-0">
      <div className="grid grid-cols-1 gap-3">
        {/* Tote combobox */}
      </div>

      <Separator />

      <ScrollArea className="h-[calc(100vh-17rem)] pr-2">
        {/* Parts table with quantity inputs */}
      </ScrollArea>
    </div>
  </SheetContent>
</Sheet>
```

Tailwind intent:

- `p-0` on `SheetContent` to enforce explicit section spacing.
- Fixed header (`border-b`) + scrollable body for long line sets.
- `sm:max-w-3xl` as baseline drawer width; expand only if table readability suffers.
- Avoid dense visual packing; prioritize rapid scan and edit by warehouse staff.

## Interaction & Mutation Flow

### Brainstormed Options

1. **Inline Editable Table (chosen):** one row per required part with direct quantity input.
   - Pros: fastest keyboard workflow, minimal clicks.
   - Cons: requires stronger per-cell validation.

2. Stepper/Wizard (not chosen): tote step then quantity step.
   - Pros: explicit sequence guidance.
   - Cons: slower and more click-heavy for repeated operations.

3. Bulk action with prefilled full required qty (not chosen for v1):
   - Pros: very fast for common case.
   - Cons: higher risk when partial picks are common.

Chosen approach: Inline editable table in one drawer view.

### Runtime Sequence

1. User clicks a pick-list row.
2. Drawer opens and fetches pick details + staging tote options.
3. User selects tote and enters one or more quantities.
4. User clicks top-right `Confirm Pick`.
5. Mutation sends one payload to `/api/workshop/:id/pick-parts`.
6. Backend executes atomic transaction with ledger-compliant movement.
7. Success path:
   - sonner success toast,
   - invalidate detail + list caches,
   - close drawer.
8. Failure path:
   - retain form state,
   - show error toast,
   - if 409, trigger explicit refetch/invalidation and keep UI synchronized.

### Error Handling Matrix

- `400`: show inline/message-level validation guidance.
- `404`: show entity-not-found toast and close drawer to avoid stale editing.
- `409`: show conflict toast, invalidate order detail immediately, keep drawer open only if refreshed data still pick-eligible.
- `422`: show business-rule toast (for example, order no longer eligible for pick).

### Performance and UX Guardrails

- Fetch totes once per drawer open and filter client-side in `Command`.
- Prevent duplicate submits while mutation is pending.
- Keep payload minimal (only changed lines with qty > 0).
- Maintain deterministic button placement and labels for muscle memory.

## Related

- `docs/internal/01-ADR/2026-04-15-parts-kitting-and-tote-staging.md`
- `docs/internal/03-Component-Specs/data-table.md`
- `docs/internal/03-Component-Specs/action-group.md`
