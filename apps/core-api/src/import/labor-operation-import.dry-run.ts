import { ImportEntityType, ImportRowAction } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ParsedCsv } from './csv-parse.util.js';
import { planParsedCsvRowsWithBudget } from './import-dry-run-plan-budget.js';
import type { ImportDryRunInput } from './import-type-handler.js';
import type { DryRunRowResult } from './import.types.js';
import {
  normalizeLaborOperationRow,
  planLaborOperationDryRunRow,
  type LaborMatchContext,
  type LaborOperationSnapshot,
} from './labor-operation-import.logic.js';

function mapFitment(fitment: {
  make: string;
  model: string;
  year_from: number | null;
  year_to: number | null;
  engine_code: string | null;
}) {
  return {
    make: fitment.make,
    model: fitment.model,
    year_from: fitment.year_from,
    year_to: fitment.year_to,
    engine_code: fitment.engine_code,
  };
}

async function loadLaborMatchContext(
  prisma: PrismaService,
  tenantId: string,
  sourceSystem: string,
): Promise<LaborMatchContext> {
  const [mappings, operations, categories] = await Promise.all([
    prisma.externalIdMapping.findMany({
      where: {
        tenant_id: tenantId,
        entity_type: ImportEntityType.LABOR_OPERATION,
        source_system: sourceSystem,
      },
    }),
    prisma.laborOperation.findMany({
      where: { tenant_id: tenantId },
      include: { fitments: true },
    }),
    prisma.laborCategory.findMany({
      where: { tenant_id: tenantId, is_active: true },
      select: { id: true, name: true },
    }),
  ]);

  const operationByCode = new Map<string, string>();
  const operationById = new Map<string, LaborOperationSnapshot>();
  for (const operation of operations) {
    operationByCode.set(operation.code.toLowerCase(), operation.id);
    operationById.set(operation.id, {
      code: operation.code,
      description: operation.description,
      standard_aw: Number(operation.standard_aw),
      hourly_rate: Number(operation.hourly_rate),
      internal_cost:
        operation.internal_cost !== null
          ? Number(operation.internal_cost)
          : null,
      category_id: operation.category_id,
      fitments: operation.fitments.map(mapFitment),
    });
  }

  const categoryByName = new Map<string, string>();
  for (const category of categories) {
    categoryByName.set(category.name.trim().toLowerCase(), category.id);
  }

  return {
    mappingByExternalId: new Map(
      mappings.map((row) => [row.external_id, row.entity_id]),
    ),
    operationByCode,
    operationById,
    categoryByName,
    externalIdSeenInFile: new Map<string, number>(),
    codeSeenInFile: new Map<string, number>(),
  };
}

function planLaborCsvRow(
  rowNo: number,
  record: Record<string, string>,
  input: ImportDryRunInput,
  context: LaborMatchContext,
): DryRunRowResult {
  const normalized = normalizeLaborOperationRow(record, input.mapping, context);
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

  return planLaborOperationDryRunRow(
    rowNo,
    normalized.row,
    context,
    input.options,
    normalized.warnings,
  );
}

/** Plans every labor operation row of an upload, in file order. */
export async function planLaborOperationDryRun(
  prisma: PrismaService,
  input: ImportDryRunInput,
  parsed: ParsedCsv,
): Promise<DryRunRowResult[]> {
  const context = await loadLaborMatchContext(
    prisma,
    input.tenantId,
    input.sourceSystem,
  );
  return planParsedCsvRowsWithBudget(parsed, input.planBudget, (rowNo, record) =>
    planLaborCsvRow(rowNo, record, input, context),
  );
}
