import { ImportJobStatus } from '@prisma/client';
import {
  buildTerminalImportUploadRetentionWhere,
  importUploadRetentionCutoff,
  purgeStaleImportUploadsForTenant,
} from './import-upload-retention.helpers.js';

describe('import upload retention helpers', () => {
  const now = new Date('2026-10-27T12:00:00.000Z');
  const cutoff = importUploadRetentionCutoff(now, 7);

  it('targets only terminal jobs older than the retention cutoff', () => {
    const where = buildTerminalImportUploadRetentionWhere(cutoff);
    expect(where.status).toEqual({
      in: [ImportJobStatus.APPLIED, ImportJobStatus.CANCELLED, ImportJobStatus.FAILED],
    });
    expect(where.OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: ImportJobStatus.APPLIED }),
        expect.objectContaining({ status: ImportJobStatus.FAILED }),
        expect.objectContaining({ status: ImportJobStatus.CANCELLED }),
      ]),
    );
  });

  it('deletes upload objects for eligible terminal jobs', async () => {
    const deleted: string[] = [];
    const prisma = {
      importJob: {
        findMany: jest.fn(async () => [
          {
            id: 'job-old-failed',
            options_json: { upload: { object_key: 'imports/failed.csv' } },
          },
        ]),
        update: jest.fn(async () => ({})),
      },
    };
    const counts = await purgeStaleImportUploadsForTenant(
      prisma as never,
      'tenant-1',
      now,
      {
        deleteUpload: async (upload) => {
          deleted.push(upload.object_key);
        },
      },
    );
    expect(prisma.importJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenant_id: 'tenant-1',
          ...buildTerminalImportUploadRetentionWhere(cutoff),
        }),
      }),
    );
    expect(deleted).toEqual(['imports/failed.csv']);
    expect(counts.uploads_deleted).toBe(1);
  });
});
