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
import { ForbiddenException } from '@nestjs/common';
import { listImportEntityTypes } from './import-entity-type.registry.js';

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
/** ImportService getTemplate characterization (split for repowise; AUT-602). */

describe('ImportService job lifecycle — getJob', () => {
  const h = setupImportHarness();

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
        progress: null,
        stalled: false,
        recovery_hint: null,
        applied_at: null,
      });
    });

    it('reports stalled when an APPLYING job lease has expired', async () => {
      h.prisma.importJob.findFirst.mockResolvedValue(
        importJobRecord({
          status: ImportJobStatus.APPLYING,
          totals_json: DRY_RUN_CREATE_TOTALS,
          options_json: {
            worker: {
              phase: 'apply',
              lease_token: 'token-old',
              lease_until: new Date(0).toISOString(),
              processed_rows: 0,
              started_at: new Date(0).toISOString(),
            },
          },
        }),
      );

      await expect(h.service.getJob(JOB_ID)).resolves.toMatchObject({
        status: ImportJobStatus.APPLYING,
        stalled: true,
        recovery_hint: 'Job is stalled. Re-apply it (POST apply) to resume.',
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

});

describe('ImportService job lifecycle — listJobRows', () => {
  const h = setupImportHarness();

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

});

describe('ImportService getTemplate (characterization)', () => {
  const h = setupImportHarness();

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
      [
        ImportEntityType.VEHICLE_PARTY,
        'external_id;vehicle_external_id;customer_external_id;role;valid_from;valid_to;notes\n',
        7,
      ],
      [
        ImportEntityType.VEHICLE_DUE_DATE,
        'external_id;vehicle_external_id;kind;inspected_on;plaketten_valid_until_year;plaketten_valid_until_month;due_date;due_mileage;external_ref;station_name;notes\n',
        11,
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

  describe('listEntityTypes', () => {
    it('returns the registry entries to tenant admins', () => {
      expect(h.service.listEntityTypes()).toEqual(listImportEntityTypes());
    });

    it('rejects sales users', () => {
      h.tenantContext.getAuthenticatedUser.mockReturnValue({
        userId: ACTOR_AUTH_UID,
        role: 'SALES',
      });

      expect(() => h.service.listEntityTypes()).toThrow(ForbiddenException);
    });
  });
});
