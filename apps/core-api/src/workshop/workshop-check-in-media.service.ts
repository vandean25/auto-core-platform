import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  WorkshopCheckInStatus,
  WorkshopMediaPurpose,
  WorkshopMediaUrlStrategy,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../common/services/site-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { processUploadImage } from '../common/media/image-processing.js';
import { MechanicMediaStorage } from '../mechanic/mechanic-media.storage.js';
import { resolveEstimateScope } from './workshop-estimate-scope.js';
import { CHECK_IN_ERROR_CODES } from './workshop-check-in.rules.js';
import {
  assertCheckInAllowsMediaMutation,
  assertMcpWorkshopMediaUploadDeclared,
} from './workshop-check-in-media-validation.js';
import { lockWorkshopCheckInForUpdate } from './workshop-check-in-lock.helpers.js';
import { resolveCheckInMediaUploaderEmployeeId } from './workshop-check-in-media-attribution.js';
import { CHECK_IN_PHOTO_MAIN_LIMITS } from './workshop-check-in-photo-limits.js';
import type {
  WorkshopCheckInMediaItemDto,
  WorkshopCheckInMediaListDto,
} from './dto/workshop-check-in-media.dto.js';

const CLIENT_UPLOAD_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type UploadInput = {
  file: Express.Multer.File | undefined;
  clientUploadId: string;
  purpose: string;
  expectedRevision: number;
};

export type WorkshopCheckInMediaUploadResult = {
  item: WorkshopCheckInMediaItemDto;
  created: boolean;
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

    const data = await Promise.all(rows.map((row) => this.toMediaDto(row)));
    return { data };
  }

  async upload(
    orderId: string,
    input: UploadInput,
  ): Promise<WorkshopCheckInMediaUploadResult> {
    if (!input.file?.buffer?.length) {
      throw new BadRequestException('Multipart field "file" is required.');
    }
    if (input.purpose !== 'CHECK_IN') {
      throw new BadRequestException(
        'Only CHECK_IN purpose is supported on this route.',
      );
    }
    const clientUploadId = input.clientUploadId?.trim();
    if (!clientUploadId) {
      throw new BadRequestException('client_upload_id is required.');
    }
    if (!CLIENT_UPLOAD_ID_UUID_RE.test(clientUploadId)) {
      throw new BadRequestException(
        'client_upload_id must be a valid UUID.',
      );
    }

    const declaredMime = input.file.mimetype || 'application/octet-stream';
    assertMcpWorkshopMediaUploadDeclared(declaredMime, input.file.size);

    let processedBytes: Buffer;
    try {
      const processed = await processUploadImage(input.file.buffer, {
        main: CHECK_IN_PHOTO_MAIN_LIMITS,
      });
      processedBytes = processed.main.bytes;
    } catch {
      throw new UnprocessableEntityException({
        code: CHECK_IN_ERROR_CODES.CHECK_IN_MEDIA_INVALID,
        message: 'Check-in photo could not be processed.',
      });
    }

    const mimeType = 'image/jpeg';
    const sizeBytes = processedBytes.length;

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

    const existingMedia = await this.prisma.workshopMedia.findFirst({
      where: { tenant_id: tenantId, id: clientUploadId },
      select: {
        id: true,
        purpose: true,
        check_in_id: true,
        workshop_order_id: true,
        mime_type: true,
        size_bytes: true,
        storage_bucket: true,
        storage_key: true,
      },
    });
    if (existingMedia) {
      if (
        existingMedia.purpose !== WorkshopMediaPurpose.CHECK_IN ||
        existingMedia.check_in_id !== checkInRow.id ||
        existingMedia.workshop_order_id !== orderId
      ) {
        throw new ConflictException({
          code: CHECK_IN_ERROR_CODES.UPLOAD_ID_REUSED,
          message:
            'client_upload_id was already used for different check-in media.',
        });
      }
      const preview_url = await this.mediaStorage
        .generateSignedReadUrl(
          existingMedia.storage_bucket,
          existingMedia.storage_key,
          existingMedia.mime_type,
        )
        .catch(() => null);
      return {
        created: false,
        item: {
          id: existingMedia.id,
          purpose: existingMedia.purpose,
          mime_type: existingMedia.mime_type,
          size_bytes: existingMedia.size_bytes,
          preview_url,
          processing_status: 'READY',
        },
      };
    }

    const stored = await this.mediaStorage.uploadCheckInPhoto({
      tenantId,
      orderId,
      checkInId: checkInRow.id,
      bytes: processedBytes,
      mimeType,
      filename: input.file.originalname,
      objectId: clientUploadId,
    });

    let createdRow: {
      id: string;
      purpose: WorkshopMediaPurpose;
      mime_type: string;
      size_bytes: number;
      storage_bucket: string;
      storage_key: string;
    };

    try {
      createdRow = await this.prisma.$transaction(async (tx) => {
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

        const duplicate = await tx.workshopMedia.findFirst({
          where: { tenant_id: tenantId, id: clientUploadId },
          select: { id: true },
        });
        if (duplicate) {
          throw new ConflictException({
            code: CHECK_IN_ERROR_CODES.UPLOAD_ID_REUSED,
            message:
              'client_upload_id was already used for different check-in media.',
          });
        }

        const nextRevision = current.revision + 1;

        const row = await tx.workshopMedia.create({
          data: {
            id: clientUploadId,
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
            size_bytes: sizeBytes,
          },
          select: {
            id: true,
            purpose: true,
            mime_type: true,
            size_bytes: true,
            storage_bucket: true,
            storage_key: true,
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

        return row;
      });
    } catch (error) {
      await this.mediaStorage
        .deleteObjectIfExists(stored.storageBucket, stored.storageKey)
        .catch(() => undefined);
      throw error;
    }

    const preview_url = await this.mediaStorage
      .generateSignedReadUrl(
        createdRow.storage_bucket,
        createdRow.storage_key,
        createdRow.mime_type,
      )
      .catch(() => null);

    return {
      created: true,
      item: {
        id: createdRow.id,
        purpose: createdRow.purpose,
        mime_type: createdRow.mime_type,
        size_bytes: createdRow.size_bytes,
        preview_url,
        processing_status: 'READY',
      },
    };
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
