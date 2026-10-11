import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type {
  DryRunRowResult,
  ImportJobOptions,
  ImportJobTotals,
} from './import.types.js';

export type CreateDryRunJobInput = {
  tenantId: string;
  entityType: ImportEntityType;
  sourceSystem: string;
  fileName?: string;
  fileSha256: string;
  mapping: Record<string, string>;
  options: ImportJobOptions;
  totals: ImportJobTotals;
  actorUserId: string;
  rows: DryRunRowResult[];
};

function toRowCreate(row: DryRunRowResult) {
  return {
    row_no: row.row_no,
    external_id: row.external_id,
    action: row.action,
    entity_id: row.entity_id,
    errors_json:
      row.errors.length > 0
        ? (row.errors as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    warnings_json:
      row.warnings.length > 0
        ? (row.warnings as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    normalized_json:
      row.normalized === null
        ? Prisma.JsonNull
        : (row.normalized as Prisma.InputJsonValue),
  };
}

/** Reads and writes import jobs and their rows. Every query is scoped to the tenant. */
export class ImportJobStore {
  constructor(private readonly prisma: PrismaService) {}

  findJob(tenantId: string, jobId: string) {
    return this.prisma.importJob.findFirst({
      where: { tenant_id: tenantId, id: jobId },
    });
  }

  createDryRunJob(input: CreateDryRunJobInput) {
    return this.prisma.importJob.create({
      data: {
        tenant_id: input.tenantId,
        entity_type: input.entityType,
        source_system: input.sourceSystem,
        file_name: input.fileName ?? 'import.csv',
        file_sha256: input.fileSha256,
        status: ImportJobStatus.DRY_RUN_DONE,
        mapping_json: input.mapping,
        options_json: input.options,
        totals_json: input.totals,
        created_by: input.actorUserId,
        rows: { create: input.rows.map(toRowCreate) },
      },
    });
  }

  findRowsPage(
    where: Prisma.ImportJobRowWhereInput,
    skip: number,
    take: number,
  ) {
    return Promise.all([
      this.prisma.importJobRow.findMany({
        where,
        orderBy: { row_no: 'asc' },
        skip,
        take,
      }),
      this.prisma.importJobRow.count({ where }),
    ]);
  }

  findErrorRows(tenantId: string, jobId: string) {
    return this.prisma.importJobRow.findMany({
      where: {
        tenant_id: tenantId,
        import_job_id: jobId,
        action: ImportRowAction.ERROR,
      },
      orderBy: { row_no: 'asc' },
    });
  }

  findApplyRows(tenantId: string, jobId: string) {
    return this.prisma.importJobRow.findMany({
      where: { tenant_id: tenantId, import_job_id: jobId },
      orderBy: { row_no: 'asc' },
    });
  }

  /** Moves a dry-run job to APPLYING. The status guard makes concurrent applies fail. */
  lockForApply(tenantId: string, jobId: string) {
    return this.prisma.importJob.updateMany({
      where: {
        tenant_id: tenantId,
        id: jobId,
        status: ImportJobStatus.DRY_RUN_DONE,
      },
      data: { status: ImportJobStatus.APPLYING },
    });
  }
}

/** Records a row that failed during apply, with the code and message shown on the row. */
export function markImportRowFailed(
  prisma: PrismaService,
  tenantId: string,
  jobId: string,
  rowNo: number,
  error: { code: string; message: string },
) {
  return prisma.importJobRow.update({
    where: {
      tenant_id_import_job_id_row_no: {
        tenant_id: tenantId,
        import_job_id: jobId,
        row_no: rowNo,
      },
    },
    data: {
      action: ImportRowAction.ERROR,
      errors_json: [error],
    },
  });
}
