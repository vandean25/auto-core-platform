import { ImportRowAction } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { DryRunRowResult, ImportRowIssue } from './import.types.js';

export function dryRunRowResultFromJobRow(row: {
  row_no: number;
  external_id: string | null;
  action: ImportRowAction;
  entity_id: string | null;
  errors_json: unknown;
  warnings_json: unknown;
  normalized_json: unknown;
}): DryRunRowResult {
  return {
    row_no: row.row_no,
    external_id: row.external_id,
    action: row.action,
    entity_id: row.entity_id,
    errors: parseIssues(row.errors_json),
    warnings: parseIssues(row.warnings_json),
    normalized: parseNormalized(row.normalized_json),
  };
}

function parseIssues(value: unknown): ImportRowIssue[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value as ImportRowIssue[];
}

function parseNormalized(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export async function loadReconcilePriorDryRunResults(
  prisma: PrismaService,
  tenantId: string,
  jobId: string,
  priorRowNos: number[],
): Promise<DryRunRowResult[]> {
  if (priorRowNos.length === 0) {
    return [];
  }
  const stored = await prisma.importJobRow.findMany({
    where: {
      tenant_id: tenantId,
      import_job_id: jobId,
      row_no: { in: priorRowNos },
    },
    select: {
      row_no: true,
      external_id: true,
      action: true,
      entity_id: true,
      errors_json: true,
      warnings_json: true,
      normalized_json: true,
    },
    orderBy: { row_no: 'asc' },
  });
  return stored.map(dryRunRowResultFromJobRow);
}

export function seedExternalIdSeenFromPriors(
  seen: Map<string, number>,
  priors: DryRunRowResult[],
): void {
  for (const prior of priors) {
    if (prior.external_id && prior.errors.length === 0) {
      seen.set(prior.external_id, prior.row_no);
    }
  }
}

export function seedEmailSeenFromPriors(
  seen: Map<string, number>,
  priors: DryRunRowResult[],
): void {
  for (const prior of priors) {
    if (prior.errors.length > 0 || !prior.normalized) {
      continue;
    }
    const email = prior.normalized.email;
    if (typeof email === 'string' && email.trim() !== '') {
      seen.set(email.trim().toLowerCase(), prior.row_no);
    }
  }
}

export function seedVinSeenFromPriors(
  seen: Map<string, number>,
  priors: DryRunRowResult[],
): void {
  for (const prior of priors) {
    if (prior.errors.length > 0 || !prior.normalized) {
      continue;
    }
    const vin = prior.normalized.vin;
    if (typeof vin === 'string' && vin.trim() !== '') {
      seen.set(vin.trim().toUpperCase(), prior.row_no);
    }
  }
}

export function seedLaborCodeSeenFromPriors(
  seen: Map<string, number>,
  priors: DryRunRowResult[],
): void {
  for (const prior of priors) {
    if (prior.errors.length > 0 || !prior.normalized) {
      continue;
    }
    const code = prior.normalized.code;
    if (typeof code === 'string' && code.trim() !== '') {
      seen.set(code.trim().toLowerCase(), prior.row_no);
    }
  }
}

export function seedSupplierArticleSeenFromPriors(
  seen: Map<string, number>,
  priors: DryRunRowResult[],
): void {
  for (const prior of priors) {
    if (prior.errors.length > 0) {
      continue;
    }
    const article =
      typeof prior.normalized?.supplier_article_no === 'string'
        ? prior.normalized.supplier_article_no
        : prior.external_id;
    if (article && article.trim() !== '') {
      seen.set(article, prior.row_no);
    }
  }
}

export function dryRunRowSignaturesMatch(
  left: DryRunRowResult,
  right: DryRunRowResult,
): boolean {
  return (
    left.row_no === right.row_no &&
    left.action === right.action &&
    left.external_id === right.external_id &&
    issueSignatures(left.errors) === issueSignatures(right.errors) &&
    issueSignatures(left.warnings) === issueSignatures(right.warnings)
  );
}

function issueSignatures(issues: ImportRowIssue[]): string {
  return issues
    .map((issue) => `${issue.code}\0${issue.message}\0${issue.field ?? ''}`)
    .join('\n');
}

/** New target rows plus prior rows whose dry-run signature changed after reconcile. */
export function mergeReconcilePlanOutput(
  finished: DryRunRowResult[],
  newRowNos: ReadonlySet<number>,
  priors: DryRunRowResult[],
): DryRunRowResult[] {
  const priorByRow = new Map(priors.map((prior) => [prior.row_no, prior]));
  return finished.filter((result, index) => {
    if (newRowNos.has(result.row_no)) {
      return true;
    }
    const before = priorByRow.get(result.row_no);
    return (
      before !== undefined &&
      !dryRunRowSignaturesMatch(before, finished[index])
    );
  });
}

