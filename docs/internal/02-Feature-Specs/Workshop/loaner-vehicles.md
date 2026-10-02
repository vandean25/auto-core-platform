# Loaner vehicles (Ersatzmobilität)

## Summary

The pilot customer offers replacement mobility during repairs. This feature tracks a dedicated loaner fleet (normal `Vehicle` rows; `inventory_role` unchanged), bookings linked to customers and optional workshop orders, and hand-over/return protocol fields (odometer, fuel, damage notes, licence check).

## Database

Expand-only migration `20261002160000_loaner_vehicles`:

- `loaner_vehicles` — fleet entry per tenant/site/vehicle; `LoanerVehicleStatus`
- `loaner_bookings` — reservations and hand-over/return; `LoanerBookingStatus`
- Exclusion constraint on overlapping `RESERVED`/`HANDED_OVER` bookings per loaner (btree_gist + `tsrange`)
- `vehicles` tenant composite unique `(tenant_id, id)` for tenant-safe FKs

Registered in tenant-restore manifest.

## API

- `GET/POST/PATCH/DELETE /api/workshop/loaner-vehicles`
- `GET /api/workshop/loaner-vehicles/availability`
- `GET/POST/PATCH /api/workshop/loaner-bookings`
- `POST .../cancel`, `.../hand-over`, `.../return`
- `GET /api/workshop/loaner-bookings/overdue`
- Workshop order detail includes optional `loanerBooking` summary.

RBAC: write — tenant `OWNER`/`ADMIN` or linked `SERVICE_ADVISOR` employee; read — all authenticated members.

## UI

- **Ersatzfahrzeuge** list page with fleet table, booking timeline, dialogs, overdue badge
- Workshop order chip with link
- Print protocol page (`/workshop/loaner-bookings/:id/print`) — no new PDF engine

## Out of scope

Rental invoicing, insurance telematics, customer self-service booking.

## Testing

Unit, e2e (overlap concurrency, tenant/site isolation, return validation), Playwright mocked smoke.
