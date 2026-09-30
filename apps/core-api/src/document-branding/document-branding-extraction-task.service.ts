import { Injectable } from '@nestjs/common';
import { CloudTasksService } from '../common/services/cloud-tasks.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class DocumentBrandingExtractionTaskService {
  constructor(
    private readonly cloudTasks: CloudTasksService,
    private readonly prisma: PrismaService,
  ) {}

  async enqueue(params: {
    extractionId: string;
    legalEntityId: string;
    tenantId: string;
    expectedAttemptCount: number;
    delaySeconds?: number;
  }) {
    const acceptedTask =
      await this.cloudTasks.enqueueDocumentBrandingExtraction({
        ...params,
        targetBaseUrl: process.env.CLOUD_TASKS_TARGET_BASE_URL ?? '',
      });
    await this.recordSuccessfulDispatch(params);
    return acceptedTask;
  }

  private async recordSuccessfulDispatch(params: {
    extractionId: string;
    legalEntityId: string;
    tenantId: string;
    expectedAttemptCount: number;
  }) {
    const dispatchedAt = new Date();
    const queuedUpdate = await this.prisma.documentBrandExtraction.updateMany({
      where: {
        id: params.extractionId,
        tenant_id: params.tenantId,
        legal_entity_id: params.legalEntityId,
        state: 'QUEUED',
        attempt_count: params.expectedAttemptCount,
        dispatched_at: null,
      },
      data: {
        dispatched_at: dispatchedAt,
        dispatch_count: { increment: 1 },
      },
    });
    if (queuedUpdate.count === 1) return;

    await this.prisma.documentBrandExtraction.updateMany({
      where: {
        id: params.extractionId,
        tenant_id: params.tenantId,
        legal_entity_id: params.legalEntityId,
        state: { in: ['RUNNING', 'SUCCEEDED', 'FAILED'] },
        attempt_count: params.expectedAttemptCount + 1,
        dispatched_at: null,
      },
      data: {
        dispatched_at: dispatchedAt,
        dispatch_count: { increment: 1 },
      },
    });
  }
}
