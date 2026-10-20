import { Injectable } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { isSameCustomerName } from '../customer/customer-match.util.js';
import type {
  RegistrationFieldEvidence,
  RegistrationMatchSnapshot,
} from './registration-document-extraction.types.js';

const MATCH_LIMIT = 25;

const VEHICLE_MATCH_SELECT = {
  id: true,
  vin: true,
  plate: true,
  customer_id: true,
  national_code: true,
  first_registration_date: true,
  co2_wltp_g_km: true,
  co2_nedc_g_km: true,
} as const;

// A Map, so a cycle the provider sends outside WLTP/NEDC is ignored.
const CO2_COLUMN_BY_CYCLE = new Map([
  ['WLTP', 'co2_wltp_g_km'],
  ['NEDC', 'co2_nedc_g_km'],
] as const);

type HolderName = { first: string; last: string };
type VehicleRow = Awaited<ReturnType<typeof findVehicleRows>>[number];

function stringOrNull(value: RegistrationFieldEvidence['normalized']) {
  return typeof value === 'string' ? value : null;
}

function readHolderName(
  holder: RegistrationFieldEvidence['normalized'] | undefined,
): HolderName | null {
  if (
    !holder ||
    typeof holder !== 'object' ||
    !('firstName' in holder) ||
    !('lastName' in holder)
  ) {
    return null;
  }
  const first = holder.firstName.trim();
  const last = holder.lastName.trim();
  return first && last ? { first, last } : null;
}

async function findCustomers(
  prisma: PrismaService,
  tenantId: string,
  name: HolderName,
): Promise<RegistrationMatchSnapshot['customers']> {
  const rows = await prisma.customer.findMany({
    where: {
      tenant_id: tenantId,
      first_name: { equals: name.first, mode: 'insensitive' },
      last_name: { equals: name.last, mode: 'insensitive' },
    },
    take: MATCH_LIMIT,
    select: { id: true, first_name: true, last_name: true },
  });
  return rows
    .filter((row) =>
      isSameCustomerName(row.first_name, row.last_name, name.first, name.last),
    )
    .map((row) => ({
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
    }));
}

// The VIN wins over the plate, even when the VIN finds no vehicle.
async function findVehicleRows(
  prisma: PrismaService,
  tenantId: string,
  vin: string | null,
  plate: string | null,
) {
  if (vin) {
    return prisma.vehicle.findMany({
      where: { tenant_id: tenantId, vin },
      take: MATCH_LIMIT,
      select: VEHICLE_MATCH_SELECT,
    });
  }
  if (plate) {
    return prisma.vehicle.findMany({
      where: {
        tenant_id: tenantId,
        plate: { equals: plate, mode: 'insensitive' },
      },
      take: MATCH_LIMIT,
      select: VEHICLE_MATCH_SELECT,
    });
  }
  return [];
}

type MatchFields = Record<string, RegistrationFieldEvidence>;
type MatchedCustomers = RegistrationMatchSnapshot['customers'];

function isNationalCodeConflict(fields: MatchFields, vehicle: VehicleRow) {
  const code = stringOrNull(fields.nationalcode?.normalized);
  return Boolean(
    code && vehicle.national_code && vehicle.national_code !== code,
  );
}

function isFirstRegistrationConflict(fields: MatchFields, vehicle: VehicleRow) {
  const firstReg = stringOrNull(fields.firstRegistration?.normalized);
  return Boolean(
    firstReg &&
    vehicle.first_registration_date &&
    vehicle.first_registration_date.toISOString().slice(0, 10) !== firstReg,
  );
}

function isCo2Conflict(fields: MatchFields, vehicle: VehicleRow) {
  const co2 = fields.co2;
  if (!co2?.cycle || typeof co2.normalized !== 'number') {
    return false;
  }
  const column = CO2_COLUMN_BY_CYCLE.get(co2.cycle);
  if (!column) {
    return false;
  }
  const stored = vehicle[column];
  return stored !== null && stored !== co2.normalized;
}

function isOwnershipConflict(
  _fields: MatchFields,
  vehicle: VehicleRow,
  customers: MatchedCustomers,
) {
  return Boolean(
    customers.length === 1 &&
    vehicle.customer_id &&
    vehicle.customer_id !== customers[0].id,
  );
}

// Order is the order of the cases in the snapshot.
const VEHICLE_CONFLICT_CHECKS = [
  ['NATIONALCODE_CONFLICT', isNationalCodeConflict],
  ['FIRST_REGISTRATION_CONFLICT', isFirstRegistrationConflict],
  ['CO2_CONFLICT', isCo2Conflict],
  ['OWNERSHIP_CONFLICT', isOwnershipConflict],
] as const;

function findVehicleConflicts(
  fields: MatchFields,
  vehicle: VehicleRow,
  customers: MatchedCustomers,
): string[] {
  return VEHICLE_CONFLICT_CHECKS.filter(([, isConflict]) =>
    isConflict(fields, vehicle, customers),
  ).map(([conflict]) => conflict);
}

@Injectable()
export class RegistrationIntakeMatchService {
  async buildMatchSnapshot(
    prisma: PrismaService,
    tenantId: string,
    fields: Record<string, RegistrationFieldEvidence>,
    extraCases: string[],
  ): Promise<RegistrationMatchSnapshot> {
    const cases = [...extraCases];

    const holder = readHolderName(fields.holder?.normalized);
    const customers = holder
      ? await findCustomers(prisma, tenantId, holder)
      : [];
    if (customers.length === 1) {
      cases.push('EXISTING_CUSTOMER');
    } else if (customers.length > 1) {
      cases.push('DUPLICATE_CUSTOMERS');
    }

    const rows = await findVehicleRows(
      prisma,
      tenantId,
      stringOrNull(fields.vin?.normalized),
      stringOrNull(fields.plate?.normalized),
    );
    if (rows.length === 1) {
      cases.push(
        'EXISTING_VEHICLE',
        ...findVehicleConflicts(fields, rows[0], customers),
      );
    } else if (rows.length > 1) {
      cases.push('DUPLICATE_VEHICLES');
    }

    return {
      customers,
      vehicles: rows.map((row) => ({
        id: row.id,
        vin: row.vin,
        plate: row.plate,
        customerId: row.customer_id,
      })),
      cases: [...new Set(cases)],
    };
  }
}
