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

describe('ImportService job lifecycle — downloadErrorRowsCsv', () => {
  const h = setupImportHarness();

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

});
