import { Readable } from 'node:stream';
import { ForbiddenException } from '@nestjs/common';
import { ImportEntityType, ImportJobStatus } from '@prisma/client';
import {
  ACTOR_AUTH_UID,
  ACTOR_EMAIL,
  JOB_ID,
  SOURCE_SYSTEM,
  TENANT_ID,
  csvUpload,
  dryRunParams,
  importJobRecord,
  setupImportCollaborators,
  setupImportHarness,
} from './import.service.spec.support.js';

const CUSTOMER_CSV = 'Kunden-Nr;Vorname;Nachname\nK-1;Anna;Berger\n';
const CUSTOMER_MAPPING = {
  external_id: 'Kunden-Nr',
  first_name: 'Vorname',
  last_name: 'Nachname',
};
const OBJECT_KEY = 'tenant-1/job-1/source.csv';

/**
 * Focused spec for the upload-flow collaborator. The facade specs already cover
 * the sync dry-run guards and the persisted job, so this covers the two paths
 * that are the collaborator's own: the background branch and the stored-upload
 * entry point.
 */
describe('ImportUploadFlow', () => {
  const h = setupImportHarness();
  const c = setupImportCollaborators(h);

  describe('background dry run over the sync size limit', () => {
    beforeEach(() => {
      process.env.IMPORT_SYNC_MAX_FILE_BYTES = '40';
      process.env.CLOUD_TASKS_TARGET_BASE_URL = 'http://127.0.0.1:3000/api/';
      h.cloudTasks.isEnabled.mockReturnValue(true);
      h.cloudTasks.enqueueImportWorker.mockResolvedValue(undefined);
      h.fileStorage.openReadStream.mockReturnValue(
        Readable.from([Buffer.from(CUSTOMER_CSV)]),
      );
      h.prisma.importJob.findFirst.mockResolvedValue(
        importJobRecord({
          status: ImportJobStatus.APPLYING,
          worker_claim_seq: 0,
          worker_recovery_seq: 0,
          options_json: {
            worker: {
              phase: 'dry_run',
              lease_token: 'lease-bg',
              lease_until: new Date(0).toISOString(),
              processed_rows: 0,
              started_at: new Date().toISOString(),
            },
          },
        }),
      );
    });

    afterEach(() => {
      delete process.env.IMPORT_SYNC_MAX_FILE_BYTES;
      delete process.env.CLOUD_TASKS_TARGET_BASE_URL;
    });

    it('stores the upload, creates an APPLYING job and enqueues a dry-run worker', async () => {
      const result = await c.uploadFlow.createDryRunFromUpload(
        dryRunParams(ImportEntityType.CUSTOMER, CUSTOMER_CSV, {
          file: csvUpload(CUSTOMER_CSV, 'kunden.csv'),
          mappingJson: CUSTOMER_MAPPING,
        }),
      );

      expect(h.fileStorage.storeUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          fileName: 'kunden.csv',
        }),
      );
      expect(h.prisma.importJob.create.mock.calls[0][0].data).toMatchObject({
        tenant_id: TENANT_ID,
        status: ImportJobStatus.APPLYING,
        totals_json: { rows: 1, create: 0, update: 0, skip: 0, error: 0 },
        options_json: expect.objectContaining({
          upload: expect.objectContaining({
            headers: ['Kunden-Nr', 'Vorname', 'Nachname'],
          }),
          worker: expect.objectContaining({ phase: 'dry_run' }),
        }),
      });
      expect(h.cloudTasks.enqueueImportWorker).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          jobId: JOB_ID,
          phase: 'dry_run',
        }),
      );
      expect(result).toMatchObject({ status: ImportJobStatus.APPLYING });
    });

    it('deletes the stored upload when the background job cannot be created', async () => {
      h.prisma.importJob.create.mockRejectedValue(new Error('db down'));
      h.fileStorage.deleteUpload.mockResolvedValue(undefined);

      await expect(
        c.uploadFlow.createDryRunFromUpload(
          dryRunParams(ImportEntityType.CUSTOMER, CUSTOMER_CSV, {
            mappingJson: CUSTOMER_MAPPING,
          }),
        ),
      ).rejects.toThrow('db down');

      expect(h.fileStorage.deleteUpload).toHaveBeenCalledWith({
        object_key: OBJECT_KEY,
      });
      expect(h.cloudTasks.enqueueImportWorker).not.toHaveBeenCalled();
    });
  });

  it('rejects a non-admin stored upload before the entity-type check', async () => {
    h.tenantContext.getAuthenticatedUser.mockReturnValue({
      userId: ACTOR_AUTH_UID,
      role: 'TECH',
      email: ACTOR_EMAIL,
    });

    await expect(
      c.uploadFlow.createDryRunFromStoredUpload({
        jobId: JOB_ID,
        ref: { object_key: OBJECT_KEY },
        fileName: 'kunden.csv',
        entityType: ImportEntityType.PART,
        sourceSystem: SOURCE_SYSTEM,
        mappingJson: CUSTOMER_MAPPING,
        optionsJson: {},
        fileSha256: 'sha-fixture',
        rowCount: 1,
      }),
    ).rejects.toThrow(ForbiddenException);

    expect(h.prisma.importJob.create).not.toHaveBeenCalled();
    expect(h.cloudTasks.enqueueImportWorker).not.toHaveBeenCalled();
  });
});
