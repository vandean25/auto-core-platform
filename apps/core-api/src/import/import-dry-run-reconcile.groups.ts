import type { PrismaService } from '../prisma/prisma.service.js';
import { ImportEntityType } from '@prisma/client';
import {
  computeImportDryRunReconcileUnits,
  type ImportDryRunReconcileUnit,
} from './import-dry-run-reconcile.units.js';

/** @deprecated Use computeImportDryRunReconcileUnits */
export type ImportDryRunReconcileRange = {
  from_row: number;
  to_row: number;
};

export async function computeImportDryRunReconcileRanges(
  prisma: PrismaService,
  params: {
    tenantId: string;
    jobId: string;
    entityType: ImportEntityType;
    batchSize: number;
  },
): Promise<ImportDryRunReconcileRange[]> {
  const units = await computeImportDryRunReconcileUnits(prisma, params);
  return units.map((unit) => ({
    from_row: unit.context_from_row,
    to_row: unit.context_to_row,
  }));
}

export { computeImportDryRunReconcileUnits, type ImportDryRunReconcileUnit };
