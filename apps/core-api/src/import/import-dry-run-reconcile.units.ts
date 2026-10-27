import { ImportEntityType } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ImportDryRunReconcileUnit } from './import-job.worker-state.js';
import { collectReconcileKeyGroups } from './import-dry-run-reconcile.keys.js';

type RowSpan = { min_row: number; max_row: number };

function spansImportBatches(span: RowSpan, batchSize: number): boolean {
  const firstBatch = Math.floor((span.min_row - 1) / batchSize);
  const lastBatch = Math.floor((span.max_row - 1) / batchSize);
  return firstBatch !== lastBatch;
}

function keyNeedsReconcile(rowNos: number[], batchSize: number): boolean {
  if (rowNos.length < 2) {
    return false;
  }
  const min = Math.min(...rowNos);
  const max = Math.max(...rowNos);
  return spansImportBatches({ min_row: min, max_row: max }, batchSize);
}

class RowUnionFind {
  private readonly parent = new Map<number, number>();

  find(rowNo: number): number {
    let root = this.parent.get(rowNo) ?? rowNo;
    if (root !== rowNo) {
      root = this.find(root);
      this.parent.set(rowNo, root);
    }
    return root;
  }

  union(left: number, right: number): void {
    const rootLeft = this.find(left);
    const rootRight = this.find(right);
    if (rootLeft !== rootRight) {
      this.parent.set(rootLeft, rootRight);
    }
  }
}

function unionActiveKeys(
  union: RowUnionFind,
  keyGroups: Map<string, number[]>,
  batchSize: number,
): void {
  for (const rowNos of keyGroups.values()) {
    if (!keyNeedsReconcile(rowNos, batchSize)) {
      continue;
    }
    const [first, ...rest] = rowNos;
    for (const rowNo of rest) {
      union.union(first, rowNo);
    }
  }
}

function componentsFromUnion(
  union: RowUnionFind,
  keyGroups: Map<string, number[]>,
  batchSize: number,
): ImportDryRunReconcileUnit[] {
  const components = new Map<number, Set<number>>();
  for (const rowNos of keyGroups.values()) {
    if (!keyNeedsReconcile(rowNos, batchSize)) {
      continue;
    }
    for (const rowNo of rowNos) {
      const root = union.find(rowNo);
      const set = components.get(root) ?? new Set<number>();
      set.add(rowNo);
      components.set(root, set);
    }
  }
  const units: ImportDryRunReconcileUnit[] = [];
  for (const rowSet of components.values()) {
    if (rowSet.size < 2) {
      continue;
    }
    const replan = [...rowSet].sort((left, right) => left - right);
    units.push({
      context_from_row: replan[0],
      context_to_row: replan[replan.length - 1],
      replan_row_nos: replan,
    });
  }
  return units;
}

/** Cross-batch reconcile units: connected components over reconcile keys (never row-range merge). */
export async function computeImportDryRunReconcileUnits(
  prisma: PrismaService,
  params: {
    tenantId: string;
    jobId: string;
    entityType: ImportEntityType;
    batchSize: number;
  },
): Promise<ImportDryRunReconcileUnit[]> {
  const rows = await prisma.importJobRow.findMany({
    where: {
      tenant_id: params.tenantId,
      import_job_id: params.jobId,
    },
    select: {
      row_no: true,
      external_id: true,
      normalized_json: true,
    },
    orderBy: { row_no: 'asc' },
  });

  const keyGroups = collectReconcileKeyGroups(params.entityType, rows);
  const union = new RowUnionFind();
  unionActiveKeys(union, keyGroups, params.batchSize);
  const units = componentsFromUnion(union, keyGroups, params.batchSize);
  return units.sort(
    (left, right) => left.context_from_row - right.context_from_row,
  );
}
