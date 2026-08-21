---
title: "WorkshopPlannerPage"
date: "2026-08-21"
tags:
  - component-spec
  - workshop
  - planner
  - shadcn
---

# WorkshopPlannerPage

## Purpose

Service Advisor calendar at `/workshop/planner`. Shows bay occupancy over time, lets the advisor click a free cell to create a `SCHEDULED` workshop order, and drag a scheduled block to reschedule.

This is not the kanban board. Board remains `/workshop/board`.

Target files:

- `apps/core-web/src/pages/workshop/WorkshopPlannerPage.tsx`
- `apps/core-web/src/components/workshop/planner/PlannerDayGrid.tsx`
- `apps/core-web/src/components/workshop/planner/PlannerWeekGrid.tsx`
- `apps/core-web/src/components/workshop/planner/PlannerBookingBlock.tsx`
- `apps/core-web/src/components/workshop/planner/PlannerCreateSheet.tsx`

Source of truth: [Feature Spec: Workshop Planner Calendar](../../02-Feature-Specs/Workshop/2026-08-21-workshop-planner-calendar.md), [ADR-0019](../../01-ADR/2026-08-21-workshop-planner-calendar.md).

## Layout

- **Top-left:** title `Workshop Planner` (`text-2xl font-semibold tracking-tight`), subtitle selected day or week range (`text-slate-500`).
- **Top-right:** previous/next date, Day | Week toggle, `+ Workshop Order`.
- **Canvas:** CSS grid. No DataTable. No third-party calendar widget.

## Required shadcn/ui

- `Button`, `ToggleGroup` (Day/Week)
- `Sheet` for create (not Dialog)
- `Alert` for outside-hours (including holiday) and mechanic-overlap warnings
- `Card` for empty states (no bays / closed weekday / closed holiday)
- `StatusBadge` for order status
- `Skeleton` while planner query loads

Icons: `lucide-react` only (`Calendar`, `ChevronLeft`, `ChevronRight`, `Wrench`).

## Interactions

| Gesture | Behavior |
|---------|----------|
| Click empty cell | Open `PlannerCreateSheet` with bay + start prefilled; end = start + 60 minutes |
| Click `BOOKING` block | Navigate to `/workshop/orders/:id` |
| Drag `SCHEDULED` block | `PATCH` new start/end/bay; optimistic; rollback on 409 |
| Drag `INTAKE` / `IN_PROGRESS` / `UNSCHEDULED_ON_FLOOR` | Disabled |
| Closed weekday | Empty card + `Go to Settings`; still render after-hours / on-floor blocks |
| Closed holiday | Empty card `Closed — {name}` + `Go to Settings`; still render after-hours / on-floor blocks |

`localStorage` key `workshop-planner-view` stores `day` \| `week`. Default `day`.

## Query keys

Use `workshopKeys.planner(from, to, bayId?)`, `workshopKeys.settings()`, and `workshopKeys.holidays(...)`. Invalidate planner keys from `dashboard-entity-map.ts` on `WORKSHOP_ORDER`. Holiday edits refetch on return from Settings.

## Related

- `WorkshopBoard.tsx` — do not reuse kanban columns here
- Intake search UI — reuse for customer/vehicle in the create Sheet
- Settings Hours tab — `+ Holiday` and **Import public holidays** (OpenHolidays), not this page
