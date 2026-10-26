import type { Prisma } from '@prisma/client';
import type { ImportApplySequenceOrderKey } from './import-apply-sequence-order.js';

/** Set-based apply_seq assignment; must run in the same transaction as DRY_RUN_DONE → APPLYING. */
export async function fillImportJobApplySequences(
  tx: Prisma.TransactionClient,
  tenantId: string,
  jobId: string,
  orderKey: ImportApplySequenceOrderKey,
): Promise<void> {
  if (orderKey === 'row_no') {
    // eslint-disable-next-line no-restricted-syntax -- AUT-623: set-based apply_seq fill; tenant_id explicit in both predicates
    await tx.$executeRaw`
      UPDATE import_job_rows r
      SET apply_seq = s.seq
      FROM (
        SELECT row_no, ROW_NUMBER() OVER (ORDER BY row_no) AS seq
        FROM import_job_rows
        WHERE tenant_id = ${tenantId} AND import_job_id = ${jobId}
      ) s
      WHERE r.tenant_id = ${tenantId}
        AND r.import_job_id = ${jobId}
        AND r.row_no = s.row_no
    `;
    return;
  }
  // eslint-disable-next-line no-restricted-syntax -- AUT-623: set-based apply_seq fill; tenant_id explicit in both predicates
  await tx.$executeRaw`
    UPDATE import_job_rows r
    SET apply_seq = s.seq
    FROM (
      SELECT row_no, ROW_NUMBER() OVER (ORDER BY (action <> 'UPDATE'::"ImportRowAction"), row_no) AS seq
      FROM import_job_rows
      WHERE tenant_id = ${tenantId} AND import_job_id = ${jobId}
    ) s
    WHERE r.tenant_id = ${tenantId}
      AND r.import_job_id = ${jobId}
      AND r.row_no = s.row_no
  `;
}
