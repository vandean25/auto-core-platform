import { normalizePlate } from '../vehicle/vehicle-plate.util.js';
import {
  CustomFieldEntity,
  ImportEntityType,
  ImportRowAction,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ParsedCsv } from './csv-parse.util.js';
import { pickVehicleImportAuditSnapshot } from './vehicle-import-audit.snapshot.js';
import { planParsedCsvRowsWithBudget } from './import-dry-run-plan-budget.js';
import type { ImportDryRunInput } from './import-type-handler.js';
import type { DryRunRowResult } from './import.types.js';
import {
  guardDryRunGroupCap,
  oversizedRowNosFromParsedCsv,
} from './import-dry-run-group-limit.js';
import { normalizeVehicleRow } from './vehicle-import-normalize.row.js';
import {
  planVehicleDryRunRow,
  type VehicleMatchContext,
} from './vehicle-import-plan.row.js';
import type { CustomFieldsDryRunContext } from './customer-import.logic.js';
import {
  extractCustomFieldMappings,
  loadValidatedImportCustomFieldDefs,
} from './import-custom-fields.util.js';

async function loadVehicleMatchContext(
  prisma: PrismaService,
  tenantId: string,
  sourceSystem: string,
  includeCustomFields: boolean,
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
    const snapshot = pickVehicleImportAuditSnapshot(vehicle);
    if (includeCustomFields) {
      snapshot.custom_fields = vehicle.custom_fields;
    }
    vehicleById.set(vehicle.id, snapshot);
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
  customFieldsContext?: CustomFieldsDryRunContext,
): DryRunRowResult {
  const normalized = normalizeVehicleRow(
    record,
    input.mapping,
    input.options,
    customFieldsContext,
  );
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
  const mappedFields = extractCustomFieldMappings(input.mapping);
  const defsByKey = await loadValidatedImportCustomFieldDefs(
    prisma,
    input.tenantId,
    CustomFieldEntity.VEHICLE,
    mappedFields,
  );
  const customFieldsContext: CustomFieldsDryRunContext = {
    mappedFields,
    defsByKey,
  };
  const context = await loadVehicleMatchContext(
    prisma,
    input.tenantId,
    input.sourceSystem,
    mappedFields.length > 0,
  );
  const oversized = oversizedRowNosFromParsedCsv(
    parsed,
    input.mapping,
    ImportEntityType.VEHICLE,
    input.planBudget,
  );
  return planParsedCsvRowsWithBudget(
    parsed,
    input.planBudget,
    (rowNo, record) =>
      guardDryRunGroupCap(
        oversized,
        rowNo,
        record[input.mapping.external_id ?? ''] ?? null,
        () =>
          planVehicleCsvRow(rowNo, record, input, context, customFieldsContext),
      ),
  );
}
