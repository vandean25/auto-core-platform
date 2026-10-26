import type { Prisma } from '@prisma/client';
import type { ImportApplySequenceOrderKey } from './import-apply-sequence-order.js';

function executeRaw(
  tx: Prisma.TransactionClient,
): (
  query: TemplateStringsArray,
  ...values: unknown[]
) => Promise<unknown> {
  return tx['$executeRaw'].bind(tx) as (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown>;
}

/** Set-based apply_seq assignment; must run in the same transaction as DRY_RUN_DONE → APPLYING. */
export async function fillImportJobApplySequences(
  tx: Prisma.TransactionClient,
  tenantId: string,
  jobId: string,
  orderKey: ImportApplySequenceOrderKey,
): Promise<void> {
  const run = executeRaw(tx);
  if (orderKey === 'row_no') {
    await run`
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
  await run`
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
