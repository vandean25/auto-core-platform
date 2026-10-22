import { ImportEntityType } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import { viennaIsoDay } from '../vehicle-stock/gewaehrleistung/gewaehrleistung-status.js';
import { dateToDay } from '../vehicle/vehicle-party-date.util.js';
import { loadVehicleBoundMappings } from './canonical-csv-cell.util.js';
import { rowToRecord, type ParsedCsv } from './csv-parse.util.js';
import type { ImportDryRunInput } from './import-type-handler.js';
import type { DryRunRowResult } from './import.types.js';
import {
  planVehiclePartyRows,
  type PartyCsvRow,
  type PartyPlanContext,
} from './vehicle-party-import.logic.js';

async function loadPartyPlanContext(
  prisma: PrismaService,
  input: ImportDryRunInput,
  rows: PartyCsvRow[],
): Promise<PartyPlanContext> {
  const { byType, vehicleIdByExternalId, vehicleIds } =
    await loadVehicleBoundMappings(prisma, input, rows, [
      ImportEntityType.CUSTOMER,
      ImportEntityType.VEHICLE_PARTY,
    ]);
  const { tenantId } = input;
  const [stored, vehicles] = await Promise.all([
    prisma.vehicleParty.findMany({
      where: { tenant_id: tenantId, vehicle_id: { in: vehicleIds } },
    }),
    prisma.vehicle.findMany({
      where: { tenant_id: tenantId, id: { in: vehicleIds } },
      select: { id: true, customer_id: true },
    }),
  ]);
  return {
    vehicleIdByExternalId,
    customerIdByExternalId: byType(ImportEntityType.CUSTOMER),
    partyIdByExternalId: byType(ImportEntityType.VEHICLE_PARTY),
    storedParties: stored.map((party) => ({
      id: party.id,
      vehicle_id: party.vehicle_id,
      customer_id: party.customer_id,
      role: party.role,
      valid_from: dateToDay(party.valid_from),
      valid_to: dateToDay(party.valid_to),
      notes: party.notes,
    })),
    vehicleContact: new Map(vehicles.map((v) => [v.id, v.customer_id])),
    options: input.options,
    today: viennaIsoDay(new Date()),
  };
}

/** Plans every vehicle party row of an upload, in file order. */
export async function planVehiclePartyDryRun(
  prisma: PrismaService,
  input: ImportDryRunInput,
  parsed: ParsedCsv,
): Promise<DryRunRowResult[]> {
  const rows = parsed.rows.map((cells, index) => ({
    rowNo: index + 1,
    record: rowToRecord(parsed.headers, cells),
  }));
  const context = await loadPartyPlanContext(prisma, input, rows);
  return planVehiclePartyRows(rows, input.mapping, context);
}
