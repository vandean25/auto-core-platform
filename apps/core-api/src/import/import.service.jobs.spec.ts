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

describe('ImportService job lifecycle (characterization)', () => {
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

    it('rejects a file over the byte limit with IMPORT_FILE_TOO_LARGE', async () => {
      const file = {
        ...csvUpload(CUSTOMER_CSV),
        size: IMPORT_MAX_FILE_BYTES + 1,
      };

      await expect(
        h.service.createDryRunFromUpload(
          dryRunParams(ImportEntityType.CUSTOMER, CUSTOMER_CSV, { file }),
        ),
      ).rejects.toMatchObject({
        status: 400,
        response: {
          code: IMPORT_ERROR_CODES.FILE_TOO_LARGE,
          message: `CSV file exceeds ${IMPORT_MAX_FILE_BYTES} bytes`,
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
      const dataRows = Array.from({ length: 20_001 }, (_, i) => `K-${i}`);
      const text = ['external_id', ...dataRows].join('\n');

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
    });
  });

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
        created_by: ACTOR_DB_ID,
        created_at: CREATED_AT.toISOString(),
        applied_at: null,
      });
    });
  });

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

  describe('getJob', () => {
    it('returns the stored job scoped to the caller tenant', async () => {
      h.prisma.importJob.findFirst.mockResolvedValue(
        importJobRecord({
          totals_json: DRY_RUN_CREATE_TOTALS,
          mapping_json: CUSTOMER_MAPPING,
        }),
      );

      const result = await h.service.getJob(JOB_ID);

      expect(h.prisma.importJob.findFirst).toHaveBeenCalledWith({
        where: { tenant_id: TENANT_ID, id: JOB_ID },
      });
      expect(result).toMatchObject({
        id: JOB_ID,
        status: ImportJobStatus.DRY_RUN_DONE,
        mapping: CUSTOMER_MAPPING,
        totals: DRY_RUN_CREATE_TOTALS,
        applied_at: null,
      });
    });

    it('throws IMPORT_JOB_NOT_FOUND when the job is missing for this tenant', async () => {
      h.prisma.importJob.findFirst.mockResolvedValue(null);

      await expect(h.service.getJob('foreign-job')).rejects.toMatchObject({
        status: 404,
        response: {
          code: IMPORT_ERROR_CODES.JOB_NOT_FOUND,
          message: 'Import job not found',
        },
      });
    });

    it('rejects non-admin callers before querying', async () => {
      h.tenantContext.getAuthenticatedUser.mockReturnValue({
        userId: ACTOR_AUTH_UID,
        role: 'TECH',
      });

      await expect(h.service.getJob(JOB_ID)).rejects.toThrow(
        'Tenant admin access is required.',
      );
      expect(h.prisma.importJob.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('listJobRows', () => {
    beforeEach(() => {
      h.prisma.importJob.findFirst.mockResolvedValue(importJobRecord());
      h.prisma.importJobRow.count.mockResolvedValue(3);
    });

    it('pages rows in row order, serializes them and reports the total', async () => {
      h.prisma.importJobRow.findMany.mockResolvedValue([
        jobRowRecord({
          row_no: 1,
          external_id: 'K-1',
          action: ImportRowAction.CREATE,
          normalized_json: { external_id: 'K-1' },
        }),
      ]);

      const result = await h.service.listJobRows(JOB_ID, {});

      expect(h.prisma.importJobRow.findMany).toHaveBeenCalledWith({
        where: { tenant_id: TENANT_ID, import_job_id: JOB_ID },
        orderBy: { row_no: 'asc' },
        skip: 0,
        take: 50,
      });
      expect(h.prisma.importJobRow.count).toHaveBeenCalledWith({
        where: { tenant_id: TENANT_ID, import_job_id: JOB_ID },
      });
      expect(result).toEqual({
        data: [
          {
            row_no: 1,
            external_id: 'K-1',
            action: ImportRowAction.CREATE,
            entity_id: null,
            errors: [],
            warnings: [],
            normalized: { external_id: 'K-1' },
          },
        ],
        meta: { total: 3, page: 1, limit: 50 },
      });
    });

    it.each([
      [
        { page: 0, limit: 500 },
        { page: 1, limit: 200, skip: 0 },
      ],
      [
        { page: 3, limit: 0 },
        { page: 3, limit: 1, skip: 2 },
      ],
      [
        { page: 2, limit: 10 },
        { page: 2, limit: 10, skip: 10 },
      ],
    ])('clamps query %j to page %j', async (query, expected) => {
      await h.service.listJobRows(JOB_ID, query);

      expect(h.prisma.importJobRow.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: expected.skip, take: expected.limit }),
      );
      await expect(h.service.listJobRows(JOB_ID, query)).resolves.toMatchObject(
        {
          meta: { page: expected.page, limit: expected.limit },
        },
      );
    });

    it('filters by action when no error filter is given', async () => {
      await h.service.listJobRows(JOB_ID, { action: ImportRowAction.UPDATE });

      expect(h.prisma.importJobRow.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenant_id: TENANT_ID,
            import_job_id: JOB_ID,
            action: ImportRowAction.UPDATE,
          },
        }),
      );
    });

    it('lets hasErrors override an action filter and select ERROR rows', async () => {
      await h.service.listJobRows(JOB_ID, {
        action: ImportRowAction.CREATE,
        hasErrors: true,
      });

      expect(h.prisma.importJobRow.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenant_id: TENANT_ID,
            import_job_id: JOB_ID,
            action: ImportRowAction.ERROR,
          },
        }),
      );
    });

    it('ignores hasErrors when it is false', async () => {
      await h.service.listJobRows(JOB_ID, { hasErrors: false });

      expect(h.prisma.importJobRow.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenant_id: TENANT_ID, import_job_id: JOB_ID },
        }),
      );
    });

    it('throws IMPORT_JOB_NOT_FOUND before listing rows of a foreign job', async () => {
      h.prisma.importJob.findFirst.mockResolvedValue(null);

      await expect(
        h.service.listJobRows('foreign-job', {}),
      ).rejects.toMatchObject({
        status: 404,
        response: { code: IMPORT_ERROR_CODES.JOB_NOT_FOUND },
      });
      expect(h.prisma.importJobRow.findMany).not.toHaveBeenCalled();
    });
  });

  describe('downloadErrorRowsCsv', () => {
    it('exports only error rows as a semicolon CSV with JSON error payloads', async () => {
      h.prisma.importJob.findFirst.mockResolvedValue(importJobRecord());
      h.prisma.importJobRow.findMany.mockResolvedValue([
        jobRowRecord({
          row_no: 2,
          external_id: 'A-2',
          action: ImportRowAction.ERROR,
          errors_json: [{ code: 'X', message: 'm' }],
        }),
      ]);

      const csv = await h.service.downloadErrorRowsCsv(JOB_ID);

      expect(h.prisma.importJobRow.findMany).toHaveBeenCalledWith({
        where: {
          tenant_id: TENANT_ID,
          import_job_id: JOB_ID,
          action: ImportRowAction.ERROR,
        },
        orderBy: { row_no: 'asc' },
      });
      expect(csv).toBe(
        'row_no;external_id;errors\n2;A-2;"[{""code"":""X"",""message"":""m""}]"\n',
      );
    });

    it('neutralises spreadsheet formulas and writes missing values as blanks', async () => {
      h.prisma.importJob.findFirst.mockResolvedValue(importJobRecord());
      h.prisma.importJobRow.findMany.mockResolvedValue([
        jobRowRecord({
          row_no: 3,
          external_id: '=HYPERLINK("x")',
          action: ImportRowAction.ERROR,
          errors_json: null,
        }),
        jobRowRecord({
          row_no: 4,
          external_id: null,
          action: ImportRowAction.ERROR,
          errors_json: null,
        }),
      ]);

      const csv = await h.service.downloadErrorRowsCsv(JOB_ID);

      expect(csv).toBe(
        'row_no;external_id;errors\n3;"\'=HYPERLINK(""x"")";[]\n4;;[]\n',
      );
    });

    it('throws IMPORT_JOB_NOT_FOUND for a job of another tenant', async () => {
      h.prisma.importJob.findFirst.mockResolvedValue(null);

      await expect(
        h.service.downloadErrorRowsCsv('foreign-job'),
      ).rejects.toMatchObject({
        status: 404,
        response: { code: IMPORT_ERROR_CODES.JOB_NOT_FOUND },
      });
      expect(h.prisma.importJobRow.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getTemplate', () => {
    it.each([
      [
        ImportEntityType.CUSTOMER,
        'Kunden-Nr;Typ;Firmenname;Vorname;Nachname;E-Mail;Telefon;UID;Straße;PLZ;Ort;Land\n',
        12,
      ],
      [
        ImportEntityType.VEHICLE,
        'Fahrzeug-Nr;FIN;Kennzeichen;Marke;Modell;Baujahr;Erstzulassung;Kilometerstand;Farbe;Kunden-Nr;Schlüsselnummer\n',
        11,
      ],
      [
        ImportEntityType.SUPPLIER_PRICE_LIST,
        'Lieferanten-Artikelnummer;EAN;Beschreibung;Marke;Einkaufspreis;UVP;Einheit\n',
        7,
      ],
      [
        ImportEntityType.LABOR_OPERATION,
        'Arbeitswert-Nr;AW-Code;Beschreibung;AW;Stundensatz;Interner Kostensatz;Kategorie;Marke;Modell;Baujahr von;Baujahr bis;Motorcode\n',
        12,
      ],
    ])(
      'returns the %s template header, fields and CSV',
      (entityType, csv, fieldCount) => {
        const template = h.service.getTemplate(entityType);

        expect(template.entity_type).toBe(entityType);
        expect(template.fields).toHaveLength(fieldCount);
        expect(template.csv).toBe(csv);
      },
    );

    it('rejects non-admin callers', () => {
      h.tenantContext.getAuthenticatedUser.mockReturnValue({
        userId: ACTOR_AUTH_UID,
        role: 'TECH',
      });

      expect(() => h.service.getTemplate(ImportEntityType.CUSTOMER)).toThrow(
        'Tenant admin access is required.',
      );
    });
  });

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

    it('refuses a job that is already applying without loading its rows', async () => {
      h.prisma.importJob.findFirst.mockResolvedValue(
        importJobRecord({ status: ImportJobStatus.APPLYING }),
      );

      await expect(h.service.applyJob(JOB_ID)).rejects.toMatchObject({
        status: 409,
        response: {
          code: IMPORT_ERROR_CODES.APPLY_IN_PROGRESS,
          message: 'Import job is already being applied',
        },
      });
      expect(h.prisma.importJobRow.findMany).not.toHaveBeenCalled();
      expect(h.prisma.importJob.updateMany).not.toHaveBeenCalled();
    });

    it('refuses to apply a job twice', async () => {
      h.prisma.importJob.findFirst.mockResolvedValue(
        importJobRecord({ status: ImportJobStatus.APPLIED }),
      );

      await expect(h.service.applyJob(JOB_ID)).rejects.toMatchObject({
        status: 409,
        response: {
          code: IMPORT_ERROR_CODES.JOB_ALREADY_APPLIED,
          message: 'Import job was already applied',
        },
      });
    });

    it.each([ImportJobStatus.FAILED, ImportJobStatus.CANCELLED])(
      'refuses to apply a %s job with JOB_STALE',
      async (status) => {
        h.prisma.importJob.findFirst.mockResolvedValue(
          importJobRecord({ status }),
        );

        await expect(h.service.applyJob(JOB_ID)).rejects.toMatchObject({
          status: 409,
          response: {
            code: IMPORT_ERROR_CODES.JOB_STALE,
            message: 'Import job cannot be applied in its current status',
          },
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

      await expect(h.service.applyJob(JOB_ID)).rejects.toMatchObject({
        status: 409,
        response: { code: IMPORT_ERROR_CODES.APPLY_IN_PROGRESS },
      });

      expect(h.prisma.importJob.findFirst).toHaveBeenCalledWith({
        where: { tenant_id: TENANT_ID, id: JOB_ID },
      });
      expect(h.prisma.importJob.updateMany).toHaveBeenCalledWith({
        where: {
          tenant_id: TENANT_ID,
          id: JOB_ID,
          status: ImportJobStatus.DRY_RUN_DONE,
        },
        data: { status: ImportJobStatus.APPLYING },
      });
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
      expect(h.prisma.importJob.update).toHaveBeenCalledWith({
        where: { id: JOB_ID },
        data: {
          status: ImportJobStatus.APPLIED,
          appliedAt: expect.any(Date),
          totals_json: totals,
        },
      });
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
  });
});
