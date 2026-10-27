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

    it('refuses to apply a CANCELLED job with JOB_STALE', async () => {
      h.prisma.importJob.findFirst.mockResolvedValue(
        importJobRecord({ status: ImportJobStatus.CANCELLED }),
      );

      await expect(h.service.applyJob(JOB_ID)).rejects.toMatchObject({
        status: 409,
        response: {
          code: IMPORT_ERROR_CODES.JOB_STALE,
          message: 'Import job cannot be applied in its current status',
        },
      });
      expect(h.prisma.importJob.updateMany).not.toHaveBeenCalled();
    });

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
          status: {
            in: [ImportJobStatus.DRY_RUN_DONE, ImportJobStatus.FAILED],
          },
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
