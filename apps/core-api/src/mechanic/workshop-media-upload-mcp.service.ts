import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { WorkshopMediaUrlStrategy } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { assertOrderEditable } from '../workshop/workshop-order.helpers.js';
import {
  assertMcpWorkshopMediaUploadDeclared,
  resolveMcpWorkshopMediaPurpose,
} from '../workshop/workshop-mcp-media-validation.js';
import type { RequestWorkshopMediaUploadInput } from './mechanic-finding-propose.schema.js';
import { MechanicMediaStorage } from './mechanic-media.storage.js';
import type { AllowedMediaMimeType } from './dto/media.dto.js';

export type WorkshopMediaUploadSlotResult = {
  id: string;
  entityId: string;
  media_id: string;
  upload_url: string;
  fields: Record<string, string>;
  expires_at: string;
};

@Injectable()
export class WorkshopMediaUploadMcpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly mediaStorage: MechanicMediaStorage,
  ) {}

  async createUploadSlot(
    input: RequestWorkshopMediaUploadInput,
  ): Promise<WorkshopMediaUploadSlotResult> {
    assertMcpWorkshopMediaUploadDeclared(input.mime_type, input.size_bytes);

    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const userId = this.tenantContext.getAuthenticatedUser()?.userId;
    if (!userId) {
      throw new UnprocessableEntityException('Authenticated user is required');
    }

    const employee = await this.prisma.employee.findFirst({
      where: { tenant_id: tenantId, user_id: userId, is_active: true },
      select: { id: true },
    });
    if (!employee) {
      throw new UnprocessableEntityException(
        'No active employee profile is linked to this user for media upload',
      );
    }

    const task = await this.prisma.workshopTask.findFirst({
      where: { id: input.workshop_task_id, tenant_id: tenantId },
      select: {
        id: true,
        status: true,
        workshop_order_id: true,
        workshop_order: {
          select: { id: true, site_id: true, status: true, purpose: true },
        },
      },
    });
    if (!task || task.workshop_order.site_id !== siteId) {
      throw new NotFoundException(
        `Workshop task ${input.workshop_task_id} not found`,
      );
    }
    if (task.status === 'DONE') {
      throw new UnprocessableEntityException(
        `Cannot upload media for completed task ${input.workshop_task_id}.`,
      );
    }
    assertOrderEditable(task.workshop_order);

    const mimeType = input.mime_type as AllowedMediaMimeType;
    const policy = await this.mediaStorage.generateUploadPolicy({
      tenantId,
      orderId: task.workshop_order_id,
      taskId: task.id,
      mimeType,
      sizeBytes: input.size_bytes,
    });

    const media = await this.prisma.workshopMedia.create({
      data: {
        tenant_id: tenantId,
        workshop_order_id: task.workshop_order_id,
        workshop_task_id: task.id,
        uploaded_by_employee_id: employee.id,
        purpose: resolveMcpWorkshopMediaPurpose(input.purpose),
        storage_bucket: policy.storageBucket,
        storage_key: policy.storageKey,
        url_strategy: WorkshopMediaUrlStrategy.SIGNED,
        mime_type: input.mime_type,
        size_bytes: input.size_bytes,
      },
      select: { id: true },
    });

    const expiresAt = policy.expiresAt.toISOString();
    return {
      id: media.id,
      entityId: media.id,
      media_id: media.id,
      upload_url: policy.uploadUrl,
      fields: policy.formFields,
      expires_at: expiresAt,
    };
  }
}
