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
