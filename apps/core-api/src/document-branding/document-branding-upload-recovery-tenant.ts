import type { PrismaService } from '../prisma/prisma.service.js';
import type { DocumentBrandingAssetCleanupService } from './document-branding-asset-cleanup.service.js';
import type { DocumentBrandingUploadRequeueService } from './document-branding-upload-requeue.service.js';

const QUOTA_EVENT_RETENTION_MS = 60 * 60 * 1000;

export async function runUploadRecoveryTenantSweep(params: {
  now: Date;
  prisma: PrismaService;
  requeue: DocumentBrandingUploadRequeueService;
  cleanup: DocumentBrandingAssetCleanupService;
}) {
  await params.prisma.documentBrandQuotaEvent.deleteMany({
    where: {
      created_at: {
        lt: new Date(params.now.getTime() - QUOTA_EVENT_RETENTION_MS),
      },
    },
  });
  await params.requeue.rejectExhausted(params.now);
  await params.requeue.requeuePending(params.now);
  await params.cleanup.purgeExpired(params.now);
  await params.cleanup.removeStaleQuarantineCopies();
}
