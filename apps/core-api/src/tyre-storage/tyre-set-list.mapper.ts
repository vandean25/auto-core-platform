import type { Prisma } from '@prisma/client';
import type { TyreSetResponseDto } from './dto/tyre-set.dto.js';

type TyreSetListRow = Prisma.TyreSetGetPayload<{
  include: {
    customer: {
      select: {
        first_name: true;
        last_name: true;
        phone: true;
        email: true;
      };
    };
    vehicle: { select: { plate: true } };
    location: { select: { code: true } };
  };
}>;

/** List-row mapping aligned with {@link TyreStorageService} list responses (no events). */
export function toTyreSetListRowDto(row: TyreSetListRow): TyreSetResponseDto {
  return {
    id: row.id,
    customerId: row.customer_id,
    vehicleId: row.vehicle_id,
    siteId: row.site_id,
    locationId: row.location_id,
    locationCode: row.location?.code ?? null,
    label: row.label,
    season: row.season,
    tyreCount: row.tyre_count,
    rimType: row.rim_type,
    brand: row.brand,
    model: row.model,
    dimension: row.dimension,
    dotCodes: row.dot_codes,
    treadDepthMm: row.tread_depth_mm_json as Record<string, number> | null,
    conditionNotes: row.condition_notes,
    status: row.status,
    storedSince: row.stored_since?.toISOString().slice(0, 10) ?? null,
    plannedSwapOn: row.planned_swap_on?.toISOString().slice(0, 10) ?? null,
    binLabel: row.bin_label,
    customerName: `${row.customer.first_name} ${row.customer.last_name}`,
    customerPhone: row.customer.phone,
    customerEmail: row.customer.email,
    vehiclePlate: row.vehicle?.plate ?? null,
  };
}
