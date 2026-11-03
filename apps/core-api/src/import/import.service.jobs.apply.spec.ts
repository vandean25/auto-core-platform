import { createHash } from 'node:crypto';
import {
  AuditActorType,
  AuditLogAction,
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import { IMPORT_ERROR_CODES, IMPORT_MAX_FILE_BYTES } from './import.constants.js';
import {
  ACTOR_AUTH_UID,
  ACTOR_DB_ID,
  ACTOR_EMAIL,
  CREATED_AT,
  JOB_ID,
  SOURCE_SYSTEM,
  TENANT_ID,
  TRACE_ID,
  arrangeApply,
  csvUpload,
  dryRunParams,
  importJobRecord,
  jobRowRecord,
  setupImportHarness,
} from './import.service.spec.support.js';
import { ImportRowDomainError } from './import-apply.errors.js';

const CUSTOMER_CSV = 'Kunden-Nr;Vorname;Nachname\nK-1;Anna;Berger\n';
const CUSTOMER_MAPPING = {
  external_id: 'Kunden-Nr',
  first_name: 'Vorname',
  last_name: 'Nachname',
};
const DRY_RUN_CREATE_TOTALS = {
  rows: 1,
  create: 1,
  update: 0,
  skip: 0,
  error: 0,
  flagged_jumps: 0,
};
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

describe('ImportService job lifecycle — applyJob request guards and state machine', () => {
  const h = setupImportHarness();

  describe('applyJob request guards and state machine', () => {
    it('rejects non-admin callers before loading the job', async () => {
      h.tenantContext.getAuthenticatedUser.mockReturnValue({
        userId: ACTOR_AUTH_UID,
        role: 'TECH',
      });

      await expect(h.service.applyJob(JOB_ID)).rejects.toThrow(
        'Tenant admin access is required.',
      );
      expect(h.prisma.importJob.findFirst).not.toHaveBeenCalled();
    });

    it('throws IMPORT_JOB_NOT_FOUND for an unknown job', async () => {
      h.prisma.importJob.findFirst.mockResolvedValue(null);

      await expect(h.service.applyJob('missing')).rejects.toMatchObject({
        status: 404,
        response: { code: IMPORT_ERROR_CODES.JOB_NOT_FOUND },
      });
    });

    it('returns the live APPLYING job without starting another run', async () => {
      const leaseExpiresAt = new Date(Date.now() + 60_000).toISOString();
      h.prisma.importJob.findFirst.mockResolvedValue(
        importJobRecord({
          status: ImportJobStatus.APPLYING,
          updatedAt: new Date(),
          options_json: {
            worker: {
              phase: 'apply',
              lease_token: 'token-live',
              lease_until: leaseExpiresAt,
              processed_rows: 0,
              started_at: new Date().toISOString(),
            },
          },
        }),
      );

      await expect(h.service.applyJobHttp(JOB_ID)).resolves.toMatchObject({
        httpStatus: 202,
        job: { status: ImportJobStatus.APPLYING },
      });
      expect(h.prisma.importJobRow.findMany).not.toHaveBeenCalled();
      expect(h.prisma.importJob.updateMany).not.toHaveBeenCalled();
    });

    it('returns 202 for a job between batches and does not start a second run', async () => {
      h.prisma.importJob.findFirst.mockResolvedValue(
        importJobRecord({
          status: ImportJobStatus.APPLYING,
          updatedAt: new Date(),
          options_json: {
            worker: {
              phase: 'apply',
              lease_token: 'token-between',
              lease_until: new Date(0).toISOString(),
              processed_rows: 4,
              started_at: new Date().toISOString(),
            },
          },
        }),
      );

      await expect(h.service.applyJobHttp(JOB_ID)).resolves.toMatchObject({
        httpStatus: 202,
        job: { status: ImportJobStatus.APPLYING, stalled: false },
      });
      expect(h.prisma.importJob.updateMany).not.toHaveBeenCalled();
    });

    it.each([
      [
        'takes over a released lease after the grace period',
        new Date(Date.now() - 120_000),
        new Date(0).toISOString(),
      ],
      [
        'takes over a job whose real lease has expired',
        new Date(),
        new Date(Date.now() - 1000).toISOString(),
      ],
    ])(
      '%s by claiming the job APPLYING with a new lease token',
      async (_label, updatedAt, leaseUntil) => {
        h.prisma.importJob.findFirst.mockResolvedValue(
          importJobRecord({
            status: ImportJobStatus.APPLYING,
            updatedAt,
            options_json: {
              worker: {
                phase: 'apply',
                lease_token: 'token-old',
                lease_until: leaseUntil,
                processed_rows: 4,
                started_at: new Date().toISOString(),
              },
            },
          }),
        );

        await h.service.applyJobHttp(JOB_ID).catch(() => undefined);
        expect(h.prisma.importJob.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              status: ImportJobStatus.APPLYING,
              options_json: expect.objectContaining({ equals: 'token-old' }),
            }),
            data: expect.objectContaining({
              options_json: expect.objectContaining({
                worker: expect.objectContaining({
                  phase: 'apply',
                  lease_token: expect.not.stringContaining('token-old'),
                }),
              }),
            }),
          }),
        );
      },
    );

    it('returns 200 for an applied job with no technical error rows', async () => {
      h.prisma.importJob.findFirst.mockResolvedValue(
        importJobRecord({ status: ImportJobStatus.APPLIED }),
      );
      h.prisma.importJobRow.findMany.mockResolvedValue([]);

      await expect(h.service.applyJobHttp(JOB_ID)).resolves.toMatchObject({
        httpStatus: 200,
        job: { status: ImportJobStatus.APPLIED },
      });
      expect(h.prisma.importJob.updateMany).not.toHaveBeenCalled();
    });

    it('refuses to apply a FAILED job when the upload was already purged and no rows remain', async () => {
      h.prisma.importJob.findFirst.mockResolvedValue(
        importJobRecord({
          status: ImportJobStatus.FAILED,
          options_json: {},
        }),
      );
      h.prisma.importJobRow.count = jest.fn(async () => 0);

      await expect(h.service.applyJob(JOB_ID)).rejects.toMatchObject({
        status: 409,
        response: {
          code: IMPORT_ERROR_CODES.JOB_STALE,
          message: 'Import job cannot be applied in its current status',
        },
      });
    });

    it('allows re-apply on a FAILED job that still has dry-run rows', async () => {
      h.prisma.importJob.findFirst.mockResolvedValue(
        importJobRecord({
          status: ImportJobStatus.FAILED,
          options_json: {},
        }),
      );
      h.prisma.importJobRow.count = jest
        .fn()
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1);
      arrangeApply(
        h,
        importJobRecord({ status: ImportJobStatus.FAILED }),
        [
          jobRowRecord({
            row_no: 1,
            action: ImportRowAction.CREATE,
            external_id: 'K-1',
            normalized_json: {
              external_id: 'K-1',
              type: 'PRIVATE',
              first_name: 'Anna',
              last_name: 'Berger',
            },
          }),
        ],
      );

      await expect(h.service.applyJob(JOB_ID)).resolves.toMatchObject({
        status: ImportJobStatus.APPLIED,
      });
    });

    it.each([
      [
        'expired CANCELLED job (cancel_reason: expired)',
        ImportJobStatus.CANCELLED,
        { cancel_reason: 'expired' },
        IMPORT_ERROR_CODES.JOB_EXPIRED,
        'Import job has expired; please upload and run the dry run again',
      ],
      [
        'FAILED job with purged rows',
        ImportJobStatus.FAILED,
        { rows_purged: true },
        IMPORT_ERROR_CODES.JOB_PURGED,
        'Staged rows for this import job were purged; please upload again',
      ],
      [
        'CANCELLED job with purged rows',
        ImportJobStatus.CANCELLED,
        { rows_purged: true },
        IMPORT_ERROR_CODES.JOB_PURGED,
        'Staged rows for this import job were purged; please upload again',
      ],
      [
        'CANCELLED job',
        ImportJobStatus.CANCELLED,
        {},
        IMPORT_ERROR_CODES.JOB_STALE,
        'Import job cannot be applied in its current status',
      ],
    ])(
      'refuses to apply a %s without locking the job',
      async (_label, status, optionsJson, code, message) => {
        h.prisma.importJob.findFirst.mockResolvedValue(
          importJobRecord({ status, options_json: optionsJson }),
        );

        await expect(h.service.applyJob(JOB_ID)).rejects.toMatchObject({
          status: 409,
          response: { code, message },
        });
        expect(h.prisma.importJob.updateMany).not.toHaveBeenCalled();
      },
    );

    it('locks the job with a tenant- and status-scoped update before writing rows', async () => {
      arrangeApply(
        h,
        importJobRecord({ entity_type: ImportEntityType.CUSTOMER }),
        [],
      );
      h.prisma.importJob.updateMany.mockResolvedValue({ count: 0 });

      await expect(h.service.applyJobHttp(JOB_ID)).resolves.toMatchObject({
        httpStatus: 202,
        job: { status: ImportJobStatus.DRY_RUN_DONE },
      });

      expect(h.prisma.importJob.findFirst).toHaveBeenCalledWith({
        where: { tenant_id: TENANT_ID, id: JOB_ID },
      });
      expect(h.prisma.importJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenant_id: TENANT_ID,
            id: JOB_ID,
            status: {
              in: [ImportJobStatus.DRY_RUN_DONE, ImportJobStatus.FAILED],
            },
          }),
          data: expect.objectContaining({
            status: ImportJobStatus.APPLYING,
            options_json: expect.objectContaining({
              worker: expect.objectContaining({
                phase: 'apply',
                lease_token: expect.any(String),
              }),
            }),
          }),
        }),
      );
      expect(h.prisma.importJob.update).not.toHaveBeenCalled();
      expect(h.prisma.customer.create).not.toHaveBeenCalled();
      expect(h.prisma.importJobRow.update).not.toHaveBeenCalled();
    });

    it('applies customer rows once and reports totals with an applied audit entry', async () => {
      arrangeApply(
        h,
        importJobRecord({
          entity_type: ImportEntityType.CUSTOMER,
          options_json: {},
        }),
        [
          jobRowRecord({
            row_no: 1,
            action: ImportRowAction.CREATE,
            external_id: 'K-1',
            normalized_json: {
              external_id: 'K-1',
              type: 'PRIVATE',
              first_name: 'Anna',
              last_name: 'Berger',
            },
          }),
          jobRowRecord({
            row_no: 2,
            action: ImportRowAction.SKIP,
            external_id: 'K-2',
          }),
          jobRowRecord({
            row_no: 3,
            action: ImportRowAction.ERROR,
            external_id: 'K-3',
          }),
        ],
      );
      h.prisma.customer.create.mockResolvedValue({
        id: 'cust-1',
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
      });
      h.prisma.externalIdMapping.findFirst.mockResolvedValue(null);
      h.prisma.externalIdMapping.create.mockResolvedValue({});

      const result = await h.service.applyJob(JOB_ID);

      const totals = { rows: 3, create: 1, update: 0, skip: 1, error: 1 };
      expect(h.prisma.importJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: JOB_ID },
          data: expect.objectContaining({
            status: ImportJobStatus.APPLIED,
            appliedAt: expect.any(Date),
            totals_json: totals,
          }),
        }),
      );
      expect(h.prisma.auditLog.create).toHaveBeenLastCalledWith({
        data: {
          tenant_id: TENANT_ID,
          entity_type: 'ImportJob',
          entity_id: JOB_ID,
          action: AuditLogAction.UPDATE,
          actor_user_id: ACTOR_DB_ID,
          actor_email: ACTOR_EMAIL,
          actor_role: 'ADMIN',
          actor_type: AuditActorType.USER,
          source: 'import',
          after: { event: 'import_job.applied', importJobId: JOB_ID, totals },
        },
      });
      expect(result).toMatchObject({
        status: ImportJobStatus.APPLIED,
        totals,
        applied_at: expect.any(String),
      });
    });

    it('a second POST does not apply the same rows again', async () => {
      arrangeApply(
        h,
        importJobRecord({
          totals_json: DRY_RUN_CREATE_TOTALS,
        }),
        [
          jobRowRecord({
            row_no: 1,
            action: ImportRowAction.CREATE,
            external_id: 'K-1',
            normalized_json: {
              external_id: 'K-1',
              type: 'PRIVATE',
              first_name: 'Anna',
              last_name: 'Berger',
            },
          }),
        ],
      );
      h.prisma.customer.create.mockResolvedValue({
        id: 'cust-1',
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
      });
      h.prisma.externalIdMapping.findFirst.mockResolvedValue(null);
      h.prisma.externalIdMapping.create.mockResolvedValue({});

      await h.service.applyJob(JOB_ID);
      const creates = h.prisma.customer.create.mock.calls.length;
      const second = await h.service.applyJobHttp(JOB_ID);

      expect([200, 202]).toContain(second.httpStatus);
      expect(second.job.status).toBe(ImportJobStatus.APPLIED);
      expect(h.prisma.customer.create.mock.calls.length).toBe(creates);
    });
  });
});

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
