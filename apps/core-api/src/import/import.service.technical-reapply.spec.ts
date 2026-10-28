import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
} from '@prisma/client';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import { ImportRowDomainError } from './import-apply.errors.js';
import {
  JOB_ID,
  TENANT_ID,
  arrangeApply,
  importJobRecord,
  jobRowRecord,
  setupImportHarness,
} from './import.service.spec.support.js';

const PRIVATE = {
  type: 'PRIVATE',
  first_name: 'Anna',
  last_name: 'Berger',
};

function customerRow(
  rowNo: number,
  action: ImportRowAction,
  externalId: string,
  code?: string,
) {
  return jobRowRecord({
    row_no: rowNo,
    action,
    external_id: externalId,
    entity_id: action === ImportRowAction.UPDATE ? 'cust-existing' : null,
    errors_json: code ? [{ code, message: code }] : null,
    normalized_json: { external_id: externalId, ...PRIVATE },
  });
}

function wireReset(h: ReturnType<typeof setupImportHarness>, rows: Array<Record<string, unknown>>) {
  h.prisma.importJobRow.updateMany = jest.fn();
  h.prisma.importJobRow.updateMany.mockImplementation(
    async (args: {
      where?: { row_no?: { in?: number[] } };
      data?: { action?: ImportRowAction };
    }) => {
      const rowNos = args.where?.row_no?.in ?? [];
      for (const row of rows) {
        if (!rowNos.includes(row.row_no as number)) {
          continue;
        }
        row.action = args.data?.action;
        row.errors_json = null;
        await h.prisma.importJobRow.update({
          where: {
            tenant_id_import_job_id_row_no: { row_no: row.row_no as number },
          },
          data: args.data,
        });
      }
      return { count: rowNos.length };
    },
  );
}

describe('ImportService re-apply of technical error rows', () => {
  const h = setupImportHarness();

  const createdCustomer = {
    id: 'cust-new',
    type: 'PRIVATE',
    company_name: null,
    first_name: 'Anna',
    last_name: 'Berger',
    email: null,
    phone: null,
    vat_id: null,
    address_street: null,
    address_zip: null,
    address_city: null,
    address_country: 'AT',
  };

  function arrange(
    status: ImportJobStatus,
    rows: Array<Record<string, unknown>>,
    options_json: Record<string, unknown> = {},
  ) {
    arrangeApply(
      h,
      importJobRecord({
        status,
        entity_type: ImportEntityType.CUSTOMER,
        worker_claim_seq: 1,
        attempts_without_progress: 0,
        options_json,
        totals_json: {
          rows: rows.length,
          create: 1,
          update: 0,
          skip: 0,
          error: rows.length - 1,
        },
      }),
      rows,
    );
    wireReset(h, rows);
    h.prisma.customer.create.mockResolvedValue(createdCustomer);
    h.prisma.externalIdMapping.findFirst.mockImplementation(
      async (args: { where?: { external_id?: string } }) =>
        args.where?.external_id === 'K-done'
          ? { first_seen_import_job_id: JOB_ID }
          : null,
    );
    h.prisma.externalIdMapping.create.mockResolvedValue({});
    h.prisma.importJobRow.findFirst = jest.fn(async () => ({
      row_no: rows.length,
      apply_seq: rows.length,
    }));
  }

  it('retries technical rows and leaves business errors', async () => {
    const rows = [
      customerRow(1, ImportRowAction.CREATE, 'K-done'),
      customerRow(2, ImportRowAction.ERROR, 'K-tech', IMPORT_ERROR_CODES.APPLY_FAILED),
      customerRow(3, ImportRowAction.ERROR, 'K-timeout', 'P2028'),
      customerRow(4, ImportRowAction.ERROR, 'K-overlap', 'VEHICLE_PARTY_OVERLAP'),
      customerRow(
        5,
        ImportRowAction.ERROR,
        'K-dup',
        IMPORT_ERROR_CODES.DUPLICATE_EXTERNAL_ID_IN_FILE,
      ),
      customerRow(6, ImportRowAction.ERROR, 'K-bad', IMPORT_ERROR_CODES.ROW_STALE),
    ];
    arrange(ImportJobStatus.FAILED, rows);

    const result = await h.service.applyJob(JOB_ID);

    expect(h.prisma.customer.create.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(rows[3].action).toBe(ImportRowAction.ERROR);
    expect(rows[4].action).toBe(ImportRowAction.ERROR);
    expect(rows[5].action).toBe(ImportRowAction.ERROR);
    expect(rows[1].action).toBe(ImportRowAction.CREATE);
    expect(result.totals?.rows).toBe(6);
    expect(result.totals?.error).toBeGreaterThanOrEqual(3);
  });

  it('takes over a stale APPLYING job and keeps the saved cursor', async () => {
    const rows = [customerRow(5, ImportRowAction.CREATE, 'K-done')];
    rows[0].apply_seq = 5;
    arrange(ImportJobStatus.APPLYING, rows, {
      worker: {
        phase: 'apply',
        lease_token: 'old-token',
        lease_until: new Date(0).toISOString(),
        processed_rows: 5,
        last_committed_apply_seq: 5,
        started_at: '2026-10-01T00:00:00.000Z',
      },
    });

    await expect(h.service.applyJob(JOB_ID)).resolves.toMatchObject({
      id: JOB_ID,
    });

    const claimed = (
      h.prisma.importJob.updateMany.mock.calls as Array<
        [
          {
            data?: {
              options_json?: {
                worker?: {
                  last_committed_apply_seq?: number;
                  lease_token?: string;
                };
              };
            };
          },
        ]
      >
    ).find((call) => {
      const worker = call[0]?.data?.options_json?.worker;
      return worker?.last_committed_apply_seq === 5;
    });
    expect(claimed?.[0]?.data?.options_json?.worker?.lease_token).not.toBe(
      'old-token',
    );
  });

  it('merges a new technical error with retry rows that are not ERROR yet', async () => {
    const rows = [
      customerRow(2, ImportRowAction.CREATE, 'K-reset'),
      customerRow(4, ImportRowAction.CREATE, 'K-reset-2'),
      customerRow(8, ImportRowAction.ERROR, 'K-tech', IMPORT_ERROR_CODES.APPLY_FAILED),
    ];
    arrange(ImportJobStatus.FAILED, rows);
    h.prisma.importJob.findFirst.mockResolvedValue(
      importJobRecord({
        status: ImportJobStatus.FAILED,
        entity_type: ImportEntityType.CUSTOMER,
        options_json: {
          worker: {
            phase: 'apply',
            lease_token: 'old-token',
            lease_until: new Date(0).toISOString(),
            processed_rows: 0,
            last_committed_apply_seq: 0,
            started_at: '2026-10-01T00:00:00.000Z',
            technical_retry_row_nos: [2, 4],
          },
        },
        totals_json: { rows: 3, create: 2, update: 0, skip: 0, error: 1 },
      }),
    );

    await h.service.applyJob(JOB_ID);

    const locked = (
      h.prisma.importJob.updateMany.mock.calls as Array<
        [
          {
            data?: {
              options_json?: {
                worker?: { technical_retry_row_nos?: number[] };
              };
            };
          },
        ]
      >
    ).find((call) =>
      Array.isArray(call[0]?.data?.options_json?.worker?.technical_retry_row_nos),
    );
    expect(
      locked?.[0]?.data?.options_json?.worker?.technical_retry_row_nos,
    ).toEqual(expect.arrayContaining([2, 4, 8]));
  });

  it('rejects an APPLIED job with only business errors', async () => {
    h.prisma.importJob.findFirst.mockResolvedValue(
      importJobRecord({ status: ImportJobStatus.APPLIED }),
    );
    h.prisma.importJobRow.updateMany = jest.fn();
    h.prisma.importJobRow.findMany.mockResolvedValue([
      customerRow(1, ImportRowAction.ERROR, 'K-overlap', 'VEHICLE_PARTY_OVERLAP'),
    ]);

    await expect(h.service.applyJobHttp(JOB_ID)).resolves.toMatchObject({
      httpStatus: 200,
      job: { status: ImportJobStatus.APPLIED },
    });
    expect(h.prisma.importJobRow.updateMany).not.toHaveBeenCalled();
  });

  it('re-applies an APPLIED job that still has technical errors', async () => {
    const rows = [
      customerRow(1, ImportRowAction.ERROR, 'K-tech', IMPORT_ERROR_CODES.APPLY_FAILED),
    ];
    arrange(ImportJobStatus.APPLIED, rows);

    const result = await h.service.applyJob(JOB_ID);

    expect(result.status).toBe(ImportJobStatus.APPLIED);
    expect(result.totals).toMatchObject({ create: 1, error: 0, rows: 1 });
    expect(h.prisma.importJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: expect.objectContaining({
            in: expect.arrayContaining([ImportJobStatus.APPLIED]),
          }),
        }),
      }),
    );
  });

  it('keeps IMPORT_APPLY_FAILED when the retried row fails again', async () => {
    const rows = [
      customerRow(1, ImportRowAction.ERROR, 'K-tech', IMPORT_ERROR_CODES.APPLY_FAILED),
    ];
    arrange(ImportJobStatus.FAILED, rows);
    h.prisma.customer.create.mockRejectedValue(
      new ImportRowDomainError(IMPORT_ERROR_CODES.APPLY_FAILED, 'Row failed during apply'),
    );

    const result = await h.service.applyJob(JOB_ID);

    expect(h.prisma.customer.create).toHaveBeenCalledTimes(1);
    expect(h.prisma.importJobRow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: ImportRowAction.ERROR,
          errors_json: [
            {
              code: IMPORT_ERROR_CODES.APPLY_FAILED,
              message: 'Row failed during apply',
            },
          ],
        }),
      }),
    );
    expect(result.status).toBe(ImportJobStatus.APPLIED);
    expect(result.totals).toMatchObject({ create: 0, error: 1, rows: 1 });
  });
});
