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
