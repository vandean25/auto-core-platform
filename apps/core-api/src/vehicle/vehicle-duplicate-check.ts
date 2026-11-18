import type { PrismaService } from '../prisma/prisma.service.js';
import { findVehicleMatchRows } from '../registration-intake/registration-intake-match.service.js';
import { normalizeVin } from '../import/vin.validation.js';
import { normalizePlate } from './vehicle-plate.util.js';

export const VEHICLE_MATCH_REASONS = {
  vin: 'vin',
  plate: 'plate',
  ownerMakeModelFirstRegistration: 'owner_make_model_first_registration',
} as const;

export type VehicleMatchReason =
  (typeof VEHICLE_MATCH_REASONS)[keyof typeof VEHICLE_MATCH_REASONS];

export type VehicleDuplicateCandidate = {
  vehicle_id: string;
  match_reasons: VehicleMatchReason[];
  vin_last4: string | null;
  plate: string | null;
  make: string | null;
  model: string | null;
};

export type VehicleMatchProbe = {
  vin?: string | null;
  plate?: string | null;
  owner_customer_id?: string | null;
  make?: string | null;
  model?: string | null;
  first_registration_date?: Date | null;
};

type CandidateRow = {
  id: string;
  vin: string | null;
  plate: string | null;
  plate_normalized?: string | null;
  make?: string | null;
  model?: string | null;
};

const CANDIDATE_LIMIT = 25;

/**
 * Finds tenant vehicles that match the proposed vehicle by:
 * 1. Exact VIN (blocks create/update with DUPLICATE_VEHICLE) — reuses registration-intake matcher.
 * 2. Exact normalized plate (warning + candidate; plates get reassigned).
 * 3. Same make + model + first_registration_date for the same owner (warning + candidate).
 */
export async function findVehicleDuplicateCandidates(
  prisma: PrismaService,
  tenantId: string,
  probe: VehicleMatchProbe,
  excludeVehicleId?: string,
): Promise<VehicleDuplicateCandidate[]> {
  const vin = normalizeVin(probe.vin);
  const plateNormalized = normalizePlate(probe.plate);
  const [vinRows, plateRows, ownerRows] = await Promise.all([
    vin
      ? findVehicleMatchRows(prisma, tenantId, vin, null)
      : Promise.resolve([]),
    plateNormalized
      ? findByNormalizedPlate(prisma, tenantId, plateNormalized)
      : Promise.resolve([]),
    findByOwnerMakeModelFirstReg(prisma, tenantId, probe),
  ]);

  const reasonsById = new Map<string, Set<VehicleMatchReason>>();
  const rowById = new Map<string, CandidateRow>();

  const recordMatch = (row: CandidateRow, reason: VehicleMatchReason) => {
    if (excludeVehicleId && row.id === excludeVehicleId) {
      return;
    }
    rowById.set(row.id, row);
    const set = reasonsById.get(row.id) ?? new Set<VehicleMatchReason>();
    set.add(reason);
    reasonsById.set(row.id, set);
  };

  for (const row of vinRows) {
    recordMatch(row, VEHICLE_MATCH_REASONS.vin);
  }
  for (const row of plateRows) {
    recordMatch(row, VEHICLE_MATCH_REASONS.plate);
  }
  for (const row of ownerRows) {
    recordMatch(row, VEHICLE_MATCH_REASONS.ownerMakeModelFirstRegistration);
  }

  return [...reasonsById.entries()].map(([vehicleId, reasons]) =>
    toDuplicateCandidate(vehicleId, rowById.get(vehicleId), reasons),
  );
}

function toDuplicateCandidate(
  vehicleId: string,
  row: CandidateRow | undefined,
  reasons: Set<VehicleMatchReason>,
): VehicleDuplicateCandidate {
  const rowVin = row?.vin ?? null;
  return {
    vehicle_id: vehicleId,
    match_reasons: [...reasons],
    vin_last4: rowVin && rowVin.length >= 4 ? rowVin.slice(-4) : null,
    plate: row?.plate ?? null,
    make: row?.make ?? null,
    model: row?.model ?? null,
  };
}

async function findByNormalizedPlate(
  prisma: PrismaService,
  tenantId: string,
  plateNormalized: string,
): Promise<CandidateRow[]> {
  return prisma.vehicle.findMany({
    where: {
      tenant_id: tenantId,
      OR: [
        { plate_normalized: plateNormalized },
        { plate: { equals: plateNormalized, mode: 'insensitive' } },
      ],
    },
    take: CANDIDATE_LIMIT,
    select: {
      id: true,
      vin: true,
      plate: true,
      plate_normalized: true,
      make: true,
      model: true,
    },
  });
}

async function findByOwnerMakeModelFirstReg(
  prisma: PrismaService,
  tenantId: string,
  probe: VehicleMatchProbe,
): Promise<CandidateRow[]> {
  if (
    !probe.owner_customer_id ||
    !probe.make ||
    !probe.model ||
    !probe.first_registration_date
  ) {
    return [];
  }
  return prisma.vehicle.findMany({
    where: {
      tenant_id: tenantId,
      customer_id: probe.owner_customer_id,
      make: { equals: probe.make.trim(), mode: 'insensitive' },
      model: { equals: probe.model.trim(), mode: 'insensitive' },
      first_registration_date: probe.first_registration_date,
    },
    take: CANDIDATE_LIMIT,
    select: {
      id: true,
      vin: true,
      plate: true,
      plate_normalized: true,
      make: true,
      model: true,
    },
  });
}
