import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  exhaustedQuarantineUpdate,
  pendingValidationWhere,
  RECOVERY_LOG_CONTEXT,
  safeError,
} from './document-branding-upload-recovery.rules.js';
import { DocumentBrandingUploadTaskService } from './document-branding-upload-task.service.js';

/** Re-dispatches quarantined uploads whose validation stalled and rejects exhausted ones. */
@Injectable()
export class DocumentBrandingUploadRequeueService {
  private readonly logger = new Logger(RECOVERY_LOG_CONTEXT);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: DocumentBrandingUploadTaskService,
  ) {}

  async rejectExhausted(now: Date) {
    await this.prisma.documentBrandAsset.updateMany(
      exhaustedQuarantineUpdate(now),
    );
  }

  async requeuePending(now: Date) {
    const pending = await this.prisma.documentBrandAsset.findMany({
      where: pendingValidationWhere(now),
      select: { id: true, tenant_id: true },
      take: 100,
      orderBy: { createdAt: 'asc' },
    });
    await Promise.all(
      pending.map(({ id, tenant_id }) =>
        this.tasks
          .enqueue({ assetId: id, tenantId: tenant_id })
          .catch((error: unknown) => {
            this.logger.warn(
              `Could not requeue quarantined branding asset ${id}: ${safeError(error)}`,
            );
          }),
      ),
    );
  }
}
