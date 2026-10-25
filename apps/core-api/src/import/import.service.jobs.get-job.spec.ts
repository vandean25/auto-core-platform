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

});
