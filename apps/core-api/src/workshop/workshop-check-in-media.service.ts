import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  WorkshopCheckInStatus,
  WorkshopMediaPurpose,
  WorkshopMediaUrlStrategy,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../common/services/site-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { MechanicMediaStorage } from '../mechanic/mechanic-media.storage.js';
import { resolveEstimateScope } from './workshop-estimate-scope.js';
import { CHECK_IN_ERROR_CODES } from './workshop-check-in.rules.js';
import {
  assertCheckInAllowsMediaMutation,
  assertMcpWorkshopMediaUploadDeclared,
} from './workshop-check-in-media-validation.js';
import { lockWorkshopCheckInForUpdate } from './workshop-check-in-lock.helpers.js';
import { resolveCheckInMediaUploaderEmployeeId } from './workshop-check-in-media-attribution.js';
import type {
  WorkshopCheckInMediaItemDto,
  WorkshopCheckInMediaListDto,
} from './dto/workshop-check-in-media.dto.js';

type UploadInput = {
  file: Express.Multer.File | undefined;
  clientUploadId: string;
  purpose: string;
  expectedRevision: number;
};

@Injectable()
export class WorkshopCheckInMediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly mediaStorage: MechanicMediaStorage,
  ) {}

  async list(orderId: string): Promise<WorkshopCheckInMediaListDto> {
    const { tenantId, siteId } = await resolveEstimateScope({
      prisma: this.prisma,
      tenantContext: this.tenantContext,
      siteContext: this.siteContext,
    });

    const checkIn = await this.findCheckInForOrder(tenantId, siteId, orderId);
    if (!checkIn) {
      throw new NotFoundException('Workshop check-in not found');
    }

    const rows = await this.prisma.workshopMedia.findMany({
      where: {
        tenant_id: tenantId,
        check_in_id: checkIn.id,
        purpose: WorkshopMediaPurpose.CHECK_IN,
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        purpose: true,
        mime_type: true,
        size_bytes: true,
        storage_bucket: true,
        storage_key: true,
      },
    });

    const data = await Promise.all(
      rows.map((row) => this.toMediaDto(row)),
    );
    return { data };
  }

  async upload(orderId: string, input: UploadInput): Promise<WorkshopCheckInMediaItemDto> {
    if (!input.file?.buffer?.length) {
      throw new BadRequestException('Multipart field "file" is required.');
    }
    if (input.purpose !== 'CHECK_IN') {
      throw new BadRequestException(
        'Only CHECK_IN purpose is supported on this route.',
      );
    }
    if (!input.clientUploadId?.trim()) {
      throw new BadRequestException('client_upload_id is required.');
    }

    const mimeType = input.file.mimetype || 'application/octet-stream';
    assertMcpWorkshopMediaUploadDeclared(mimeType, input.file.size);

    const { tenantId, siteId } = await resolveEstimateScope({
      prisma: this.prisma,
      tenantContext: this.tenantContext,
      siteContext: this.siteContext,
    });

    const order = await this.prisma.workshopOrder.findFirst({
      where: { id: orderId, tenant_id: tenantId, site_id: siteId },
      select: { id: true },
    });
    if (!order) {
      throw new NotFoundException('Workshop order not found');
    }

    const uploadedByEmployeeId = await resolveCheckInMediaUploaderEmployeeId(
      this.prisma,
      this.tenantContext,
      tenantId,
    );

    const checkInRow = await this.prisma.workshopCheckIn.findFirst({
      where: { tenant_id: tenantId, workshop_order_id: orderId },
      select: { id: true },
    });
    if (!checkInRow) {
      throw new NotFoundException('Workshop check-in not found');
    }

    const stored = await this.mediaStorage.uploadCheckInPhoto({
      tenantId,
      orderId,
      checkInId: checkInRow.id,
      bytes: input.file.buffer,
      mimeType,
      filename: input.file.originalname,
    });

    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await lockWorkshopCheckInForUpdate(
          tx,
          tenantId,
          checkInRow.id,
        );
        if (!locked) {
          throw new NotFoundException('Workshop check-in not found');
        }
        if (locked.workshop_order_id !== orderId) {
          throw new NotFoundException('Workshop check-in not found');
        }

        await assertCheckInAllowsMediaMutation(tx, tenantId, locked.id);

        const current = await tx.workshopCheckIn.findFirst({
          where: { tenant_id: tenantId, id: locked.id },
          select: { revision: true, status: true },
        });
        if (!current || current.status !== WorkshopCheckInStatus.DRAFT) {
          throw new ConflictException({
            code: CHECK_IN_ERROR_CODES.CHECK_IN_COMPLETED,
            message: 'Completed check-in records cannot be changed.',
          });
        }
        if (current.revision !== input.expectedRevision) {
          throw new ConflictException({
            code: CHECK_IN_ERROR_CODES.CHECK_IN_CONFLICT,
            message: 'Check-in revision is stale. Reload and retry.',
          });
        }

        const mediaId = randomUUID();
        const nextRevision = current.revision + 1;

        await tx.workshopMedia.create({
          data: {
            id: mediaId,
            tenant_id: tenantId,
            workshop_order_id: orderId,
            workshop_task_id: null,
            check_in_id: locked.id,
            uploaded_by_employee_id: uploadedByEmployeeId,
            purpose: WorkshopMediaPurpose.CHECK_IN,
            storage_bucket: stored.storageBucket,
            storage_key: stored.storageKey,
            url_strategy: WorkshopMediaUrlStrategy.SIGNED,
            mime_type: mimeType,
            size_bytes: input.file!.size,
          },
        });

        const { count } = await tx.workshopCheckIn.updateMany({
          where: {
            tenant_id: tenantId,
            id: locked.id,
            status: WorkshopCheckInStatus.DRAFT,
            revision: input.expectedRevision,
          },
          data: { revision: nextRevision },
        });
        if (count !== 1) {
          throw new ConflictException({
            code: CHECK_IN_ERROR_CODES.CHECK_IN_CONFLICT,
            message: 'Check-in revision is stale. Reload and retry.',
          });
        }

        return {
          id: mediaId,
          purpose: WorkshopMediaPurpose.CHECK_IN,
          mime_type: mimeType,
          size_bytes: input.file!.size,
          preview_url: await this.mediaStorage
            .generateSignedReadUrl(
              stored.storageBucket,
              stored.storageKey,
              mimeType,
            )
            .catch(() => null),
          processing_status: 'READY',
        } satisfies WorkshopCheckInMediaItemDto;
      });
    } catch (error) {
      await this.mediaStorage
        .deleteObjectIfExists(stored.storageBucket, stored.storageKey)
        .catch(() => undefined);
      throw error;
    }
  }

  private async findCheckInForOrder(
    tenantId: string,
    siteId: string,
    orderId: string,
  ) {
    const order = await this.prisma.workshopOrder.findFirst({
      where: { id: orderId, tenant_id: tenantId, site_id: siteId },
      select: { id: true },
    });
    if (!order) {
      return null;
    }
    return this.prisma.workshopCheckIn.findFirst({
      where: { tenant_id: tenantId, workshop_order_id: orderId },
      select: { id: true },
    });
  }

  private async toMediaDto(row: {
    id: string;
    purpose: WorkshopMediaPurpose;
    mime_type: string;
    size_bytes: number;
    storage_bucket: string;
    storage_key: string;
  }): Promise<WorkshopCheckInMediaItemDto> {
    const preview_url = await this.mediaStorage
      .generateSignedReadUrl(row.storage_bucket, row.storage_key, row.mime_type)
      .catch(() => null);
    return {
      id: row.id,
      purpose: row.purpose,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      preview_url,
      processing_status: 'READY',
    };
  }
}
