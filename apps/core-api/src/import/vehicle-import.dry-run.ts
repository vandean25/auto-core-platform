import { normalizePlate } from '../vehicle/vehicle-plate.util.js';
import { ImportEntityType, ImportRowAction } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ParsedCsv } from './csv-parse.util.js';
import { pickVehicleImportAuditSnapshot } from './vehicle-import-audit.snapshot.js';
import { planParsedCsvRowsWithBudget } from './import-dry-run-plan-budget.js';
import type { ImportDryRunInput } from './import-type-handler.js';
import type { DryRunRowResult } from './import.types.js';
import {
  seedExternalIdSeenFromPriors,
  seedVinSeenFromPriors,
} from './import-dry-run-reconcile.prior.js';
import { normalizeVehicleRow } from './vehicle-import-normalize.row.js';
import {
  planVehicleDryRunRow,
  type VehicleMatchContext,
} from './vehicle-import-plan.row.js';

async function loadVehicleMatchContext(
  prisma: PrismaService,
  tenantId: string,
  sourceSystem: string,
): Promise<VehicleMatchContext> {
  const mappings = await prisma.externalIdMapping.findMany({
    where: { tenant_id: tenantId, source_system: sourceSystem },
  });
  const vehicleMappings = mappings.filter(
    (row) => row.entity_type === ImportEntityType.VEHICLE,
  );
  const customerMappings = mappings.filter(
    (row) => row.entity_type === ImportEntityType.CUSTOMER,
  );

  const vehicles = await prisma.vehicle.findMany({
    where: { tenant_id: tenantId },
  });
  const vehicleByVin = new Map<string, string>();
  const vehicleByPlate = new Map<string, string>();
  const vehicleById = new Map<string, Record<string, unknown>>();
  for (const vehicle of vehicles) {
    vehicleById.set(vehicle.id, pickVehicleImportAuditSnapshot(vehicle));
    if (vehicle.vin) {
      vehicleByVin.set(vehicle.vin.toUpperCase(), vehicle.id);
    }
    const plate = normalizePlate(vehicle.plate);
    if (plate) {
      vehicleByPlate.set(plate, vehicle.id);
    }
  }

  return {
    mappingByExternalId: new Map(
      vehicleMappings.map((row) => [row.external_id, row.entity_id]),
    ),
    vehicleByVin,
    vehicleByPlate,
    vehicleById,
    customerExternalToEntityId: new Map(
      customerMappings.map((row) => [row.external_id, row.entity_id]),
    ),
    vinSeenInFile: new Map<string, number>(),
    externalIdSeenInFile: new Map<string, number>(),
  };
}

function planVehicleCsvRow(
  rowNo: number,
  record: Record<string, string>,
  input: ImportDryRunInput,
  context: VehicleMatchContext,
): DryRunRowResult {
  const normalized = normalizeVehicleRow(record, input.mapping, input.options);
  if (!normalized.row) {
    return {
      row_no: rowNo,
      external_id: record[input.mapping.external_id ?? ''] ?? null,
      action: ImportRowAction.ERROR,
      entity_id: null,
      errors: normalized.issues,
      warnings: normalized.warnings,
      normalized: null,
    };
  }
  return planVehicleDryRunRow(
    rowNo,
    normalized.row,
    context,
    input.options,
    normalized.warnings,
  );
}

/** Plans every vehicle row of an upload, in file order. */
export async function planVehicleDryRun(
  prisma: PrismaService,
  input: ImportDryRunInput,
  parsed: ParsedCsv,
): Promise<DryRunRowResult[]> {
  const context = await loadVehicleMatchContext(
    prisma,
    input.tenantId,
    input.sourceSystem,
  );
  const priors = input.reconcilePriorResults ?? [];
  seedExternalIdSeenFromPriors(context.externalIdSeenInFile, priors);
  seedVinSeenFromPriors(context.vinSeenInFile, priors);
  return planParsedCsvRowsWithBudget(
    parsed,
    input.planBudget,
    (rowNo, record) => planVehicleCsvRow(rowNo, record, input, context),
  );
}
