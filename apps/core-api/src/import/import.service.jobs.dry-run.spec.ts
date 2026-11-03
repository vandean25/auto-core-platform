import { createHash } from 'node:crypto';
import {
  AuditActorType,
  AuditLogAction,
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import {
  IMPORT_ERROR_CODES,
  IMPORT_UPLOAD_MAX_FILE_BYTES,
  IMPORT_MAX_FILE_BYTES,
} from './import.constants.js';
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

describe('ImportService job lifecycle — createDryRunFromUpload request guards', () => {
  const h = setupImportHarness();

  describe('createDryRunFromUpload request guards', () => {
    it('rejects a non-admin caller before reading the file or the database', async () => {
      h.tenantContext.getAuthenticatedUser.mockReturnValue({
        userId: ACTOR_AUTH_UID,
        role: 'TECH',
        email: ACTOR_EMAIL,
      });

      await expect(
        h.service.createDryRunFromUpload(
          dryRunParams(ImportEntityType.CUSTOMER, CUSTOMER_CSV),
        ),
      ).rejects.toThrow('Tenant admin access is required.');

      expect(h.prisma.user.findUnique).not.toHaveBeenCalled();
      expect(h.prisma.importJob.create).not.toHaveBeenCalled();
    });

    it('rejects a caller whose user row does not exist', async () => {
      h.prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        h.service.createDryRunFromUpload(
          dryRunParams(ImportEntityType.CUSTOMER, CUSTOMER_CSV),
        ),
      ).rejects.toThrow('Active tenant membership is required.');
      expect(h.prisma.importJob.create).not.toHaveBeenCalled();
    });

    it('rejects a caller without an active membership in this tenant', async () => {
      h.prisma.tenantMember.findFirst.mockResolvedValue(null);

      await expect(
        h.service.createDryRunFromUpload(
          dryRunParams(ImportEntityType.CUSTOMER, CUSTOMER_CSV),
        ),
      ).rejects.toThrow('Active tenant membership is required.');
      expect(h.prisma.tenantMember.findFirst).toHaveBeenCalledWith({
        where: { tenant_id: TENANT_ID, user_id: ACTOR_DB_ID, is_active: true },
        select: { id: true },
      });
    });

    it('rejects a missing file buffer with IMPORT_EMPTY_FILE', async () => {
      await expect(
        h.service.createDryRunFromUpload({
          ...dryRunParams(ImportEntityType.CUSTOMER, CUSTOMER_CSV),
          file: {
            buffer: undefined,
            size: 0,
          } as unknown as Express.Multer.File,
        }),
      ).rejects.toMatchObject({
        status: 400,
        response: {
          code: IMPORT_ERROR_CODES.EMPTY_FILE,
          message: 'CSV file is required',
        },
      });
    });

    it('rejects a file over the upload byte limit with IMPORT_FILE_TOO_LARGE', async () => {
      const file = {
        ...csvUpload(CUSTOMER_CSV),
        size: IMPORT_UPLOAD_MAX_FILE_BYTES + 1,
      };

      await expect(
        h.service.createDryRunFromUpload(
          dryRunParams(ImportEntityType.CUSTOMER, CUSTOMER_CSV, { file }),
        ),
      ).rejects.toMatchObject({
        status: 413,
        response: {
          code: IMPORT_ERROR_CODES.FILE_TOO_LARGE,
          message: 'Datei zu groß (max. 30 MB), bitte aufteilen',
        },
      });
    });

    it.each([
      ['a header-only CSV', 'Kunden-Nr;Vorname\n'],
      ['a blank CSV', '   \n  \n'],
    ])('rejects %s with IMPORT_EMPTY_FILE', async (_label, text) => {
      await expect(
        h.service.createDryRunFromUpload(
          dryRunParams(ImportEntityType.CUSTOMER, text),
        ),
      ).rejects.toMatchObject({
        status: 400,
        response: {
          code: IMPORT_ERROR_CODES.EMPTY_FILE,
          message: 'CSV file has no data rows',
        },
      });
      expect(h.prisma.importJob.create).not.toHaveBeenCalled();
    });

    it('rejects more than the row limit with IMPORT_ROW_LIMIT_EXCEEDED', async () => {
      const previousLimit = process.env.IMPORT_MAX_ROW_COUNT;
      process.env.IMPORT_MAX_ROW_COUNT = '20000';
      const dataRows = Array.from({ length: 20_001 }, (_, i) => `K-${i}`);
      const text = ['external_id', ...dataRows].join('\n');

      try {
        await expect(
          h.service.createDryRunFromUpload(
            dryRunParams(ImportEntityType.CUSTOMER, text),
          ),
        ).rejects.toMatchObject({
          status: 400,
          response: {
            code: IMPORT_ERROR_CODES.ROW_LIMIT_EXCEEDED,
            message: 'CSV exceeds 20000 rows',
          },
        });
      } finally {
        if (previousLimit === undefined) {
          delete process.env.IMPORT_MAX_ROW_COUNT;
        } else {
          process.env.IMPORT_MAX_ROW_COUNT = previousLimit;
        }
      }
    });
  });

});

describe('ImportService job lifecycle — createDryRunFromUpload decision hooks', () => {
  const h = setupImportHarness();

  describe('createDryRunFromUpload decision hooks', () => {
    it('uses live customer decisions and returns their totals when the tenant is live', async () => {
      const liveTotals = { ...DRY_RUN_CREATE_TOTALS, create: 0, skip: 1 };
      h.decisionLive.applyCustomerImportDecisions.mockResolvedValue({
        mode: 'live',
        totals: liveTotals,
      });

      const result = await h.service.createDryRunFromUpload(
        dryRunParams(ImportEntityType.CUSTOMER, CUSTOMER_CSV, {
          mappingJson: CUSTOMER_MAPPING,
        }),
      );

      expect(result.totals).toEqual(liveTotals);
      expect(h.decisionLive.applyCustomerImportDecisions).toHaveBeenCalledWith({
        tenantId: TENANT_ID,
        traceId: TRACE_ID,
        jobId: JOB_ID,
        rows: expect.any(Array),
        totals: DRY_RUN_CREATE_TOTALS,
      });
      expect(
        h.decisionHooks.scheduleCustomerImportDryRunShadows,
      ).not.toHaveBeenCalled();
      // The job itself keeps the dry-run totals; live totals only shape the response.
      expect(
        h.prisma.importJob.create.mock.calls[0][0].data.totals_json,
      ).toEqual(DRY_RUN_CREATE_TOTALS);
    });

    it('schedules shadow decisions and keeps dry-run totals in shadow mode', async () => {
      const result = await h.service.createDryRunFromUpload(
        dryRunParams(ImportEntityType.CUSTOMER, CUSTOMER_CSV, {
          mappingJson: CUSTOMER_MAPPING,
        }),
      );

      expect(result.totals).toEqual(DRY_RUN_CREATE_TOTALS);
      expect(
        h.decisionHooks.scheduleCustomerImportDryRunShadows,
      ).toHaveBeenCalledWith(
        TENANT_ID,
        TRACE_ID,
        expect.arrayContaining([
          expect.objectContaining({
            row_no: 1,
            action: ImportRowAction.CREATE,
          }),
        ]),
      );
    });

    it('does not let a failing shadow schedule fail the upload', async () => {
      h.decisionHooks.scheduleCustomerImportDryRunShadows.mockRejectedValue(
        new Error('shadow scheduler down'),
      );

      await expect(
        h.service.createDryRunFromUpload(
          dryRunParams(ImportEntityType.CUSTOMER, CUSTOMER_CSV, {
            mappingJson: CUSTOMER_MAPPING,
          }),
        ),
      ).resolves.toMatchObject({ status: ImportJobStatus.DRY_RUN_DONE });
    });

    it('consults no customer decisions for vehicle or supplier uploads', async () => {
      await h.service.createDryRunFromUpload(
        dryRunParams(
          ImportEntityType.VEHICLE,
          'Fahrzeug-Nr;FIN;Marke;Modell;Baujahr\nV-1;;VW;Golf;2019\n',
          {
            mappingJson: {
              external_id: 'Fahrzeug-Nr',
              vin: 'FIN',
              make: 'Marke',
              model: 'Modell',
              year: 'Baujahr',
            },
            optionsJson: { allow_missing_vin: true },
          },
        ),
      );

      expect(
        h.decisionLive.applyCustomerImportDecisions,
      ).not.toHaveBeenCalled();
      expect(
        h.decisionHooks.scheduleCustomerImportDryRunShadows,
      ).not.toHaveBeenCalled();
    });
  });

});

describe('ImportService job lifecycle — createDryRunFromUpload persisted job', () => {
  const h = setupImportHarness();

  describe('createDryRunFromUpload persisted job', () => {
    it('stores tenant, actor, file fingerprint, mapping and status on the job', async () => {
      const file = csvUpload(CUSTOMER_CSV, 'kunden.csv');

      await h.service.createDryRunFromUpload(
        dryRunParams(ImportEntityType.CUSTOMER, CUSTOMER_CSV, {
          file,
          mappingJson: CUSTOMER_MAPPING,
        }),
      );

      const { data } = h.prisma.importJob.create.mock.calls[0][0];
      expect(data).toMatchObject({
        tenant_id: TENANT_ID,
        entity_type: ImportEntityType.CUSTOMER,
        source_system: SOURCE_SYSTEM,
        file_name: 'kunden.csv',
        file_sha256: createHash('sha256').update(file.buffer).digest('hex'),
        status: ImportJobStatus.DRY_RUN_DONE,
        mapping_json: CUSTOMER_MAPPING,
        created_by: ACTOR_DB_ID,
        totals_json: DRY_RUN_CREATE_TOTALS,
      });
    });

    it('defaults the file name when the upload has no original name', async () => {
      await h.service.createDryRunFromUpload(
        dryRunParams(ImportEntityType.CUSTOMER, CUSTOMER_CSV, {
          mappingJson: CUSTOMER_MAPPING,
        }),
      );

      expect(h.prisma.importJob.create.mock.calls[0][0].data.file_name).toBe(
        'import.csv',
      );
    });

    it('normalizes options before persisting them and drops invalid values', async () => {
      await h.service.createDryRunFromUpload(
        dryRunParams(ImportEntityType.CUSTOMER, CUSTOMER_CSV, {
          mappingJson: CUSTOMER_MAPPING,
          optionsJson: {
            update_existing: 'yes' as unknown as boolean,
            fill_empty_only: true,
            accepted_row_numbers: [3, 'x', '4'] as unknown as number[],
            price_jump_threshold_percent: Number.NaN,
            vendor_id: '   ',
          },
        }),
      );

      expect(
        h.prisma.importJob.create.mock.calls[0][0].data.options_json,
      ).toEqual({
        update_existing: false,
        fill_empty_only: true,
        allow_missing_vin: false,
        invalid_vat_as_error: false,
        create_new_catalog_items: false,
        accept_all_price_jumps: false,
        accepted_row_numbers: [3, 4],
        upload: {
          object_key: 'tenant-1/job-1/source.csv',
          headers: ['Kunden-Nr', 'Vorname', 'Nachname'],
        },
      });
    });

    it('stores each dry-run row with JSON columns that are null when empty', async () => {
      const text =
        'Kunden-Nr;Vorname;Nachname\n;Anna;Berger\nK-2;Bruno;Huber\n';

      await h.service.createDryRunFromUpload(
        dryRunParams(ImportEntityType.CUSTOMER, text, {
          mappingJson: CUSTOMER_MAPPING,
        }),
      );

      const rows = h.prisma.importJob.create.mock.calls[0][0].data.rows.create;
      expect(rows[0]).toMatchObject({
        row_no: 1,
        external_id: '',
        action: ImportRowAction.ERROR,
        entity_id: null,
        errors_json: [
          {
            code: 'IMPORT_EXTERNAL_ID_REQUIRED',
            message: 'external_id is required',
            field: 'external_id',
          },
        ],
        warnings_json: Prisma.JsonNull,
        normalized_json: Prisma.JsonNull,
      });
      expect(rows[1]).toMatchObject({
        row_no: 2,
        external_id: 'K-2',
        action: ImportRowAction.CREATE,
        entity_id: null,
        errors_json: Prisma.JsonNull,
        warnings_json: Prisma.JsonNull,
      });
      expect(rows[1].normalized_json).toMatchObject({
        external_id: 'K-2',
        first_name: 'Bruno',
        last_name: 'Huber',
      });
    });

    it('writes one created audit entry for the job with the request actor', async () => {
      await h.service.createDryRunFromUpload(
        dryRunParams(ImportEntityType.CUSTOMER, CUSTOMER_CSV, {
          mappingJson: CUSTOMER_MAPPING,
        }),
      );

      expect(h.prisma.auditLog.create).toHaveBeenCalledTimes(1);
      expect(h.prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          tenant_id: TENANT_ID,
          entity_type: 'ImportJob',
          entity_id: JOB_ID,
          action: AuditLogAction.CREATE,
          actor_user_id: ACTOR_DB_ID,
          actor_email: ACTOR_EMAIL,
          actor_role: 'ADMIN',
          actor_type: AuditActorType.USER,
          source: 'import',
          // The created entry records no totals; only the applied entry does.
          after: { event: 'import_job.created', importJobId: JOB_ID },
        },
      });
    });

    it('returns the serialized job with dry-run totals and no applied timestamp', async () => {
      const result = await h.service.createDryRunFromUpload(
        dryRunParams(ImportEntityType.CUSTOMER, CUSTOMER_CSV, {
          file: csvUpload(CUSTOMER_CSV, 'kunden.csv'),
          mappingJson: CUSTOMER_MAPPING,
        }),
      );

      expect(result).toEqual({
        id: JOB_ID,
        entity_type: ImportEntityType.CUSTOMER,
        source_system: SOURCE_SYSTEM,
        file_name: 'kunden.csv',
        file_sha256: expect.any(String),
        status: ImportJobStatus.DRY_RUN_DONE,
        mapping: CUSTOMER_MAPPING,
        options: expect.objectContaining({ update_existing: false }),
        totals: DRY_RUN_CREATE_TOTALS,
        progress: null,
        stalled: false,
        recovery_hint: null,
        created_by: ACTOR_DB_ID,
        created_at: CREATED_AT.toISOString(),
        applied_at: null,
      });
    });
  });
});
