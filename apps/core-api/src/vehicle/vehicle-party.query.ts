import {
  VehicleNoticeStatus,
  VehicleNoticeType,
  type Prisma,
} from '@prisma/client';

/** Parties active on `day` (a UTC date-only value): `valid_from <= day < valid_to`, blank bounds open. */
export function activeOnDay(day: Date): Prisma.VehiclePartyWhereInput {
  return {
    AND: [
      { OR: [{ valid_from: null }, { valid_from: { lte: day } }] },
      { OR: [{ valid_to: null }, { valid_to: { gt: day } }] },
    ],
  };
}

export function activePartyWhere(
  tenantId: string,
  vehicleId: string,
  day: Date,
): Prisma.VehiclePartyWhereInput {
  return { tenant_id: tenantId, vehicle_id: vehicleId, ...activeOnDay(day) };
}

/** Open SERVICE_DUE notices of a vehicle, soonest due date first. */
export const OPEN_SERVICE_DUE = {
  type: VehicleNoticeType.SERVICE_DUE,
  status: VehicleNoticeStatus.OPEN,
} as const;

export function openServiceDueWhere(
  tenantId: string,
  vehicleId: string,
): Prisma.VehicleNoticeWhereInput {
  return { tenant_id: tenantId, vehicle_id: vehicleId, ...OPEN_SERVICE_DUE };
}

export const OPEN_DUE_DATE_LIMIT = 25;
