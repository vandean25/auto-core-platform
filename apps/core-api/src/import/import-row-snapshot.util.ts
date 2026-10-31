import type { Prisma } from '@prisma/client';

export async function recordImportRowEntityId(
  tx: Prisma.TransactionClient,
  tenantId: string,
  jobId: string,
  rowNo: number,
  entityId: string,
): Promise<void> {
  await tx.importJobRow?.update({
    where: {
      tenant_id_import_job_id_row_no: {
        tenant_id: tenantId,
        import_job_id: jobId,
        row_no: rowNo,
      },
    },
    data: { entity_id: entityId },
  });
}

export async function recordImportRowBeforeSnapshot(
  tx: Prisma.TransactionClient,
  tenantId: string,
  jobId: string,
  rowNo: number,
  beforeSnapshot: Prisma.InputJsonValue,
): Promise<void> {
  await tx.importJobRow?.update({
    where: {
      tenant_id_import_job_id_row_no: {
        tenant_id: tenantId,
        import_job_id: jobId,
        row_no: rowNo,
      },
    },
    data: { before_snapshot_json: beforeSnapshot },
  });
}
