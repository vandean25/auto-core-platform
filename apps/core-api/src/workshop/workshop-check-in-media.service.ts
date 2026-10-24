import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Prisma,
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
import { CHECK_IN_SIGNATURE_MAX_BYTES } from './workshop-check-in-signature-limits.js';
import { reencodeCheckInSignaturePng } from './workshop-check-in-signature-upload.js';
import { deleteCheckInStoredPhotoIfUnreferenced } from './workshop-check-in-media-storage-cleanup.js';
import type {
  WorkshopCheckInMediaItemDto,
  WorkshopCheckInMediaListDto,
} from './dto/workshop-check-in-media.dto.js';

const CLIENT_UPLOAD_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const checkInMediaRowSelect = {
  id: true,
  purpose: true,
  check_in_id: true,
  workshop_order_id: true,
  mime_type: true,
  size_bytes: true,
  storage_bucket: true,
  storage_key: true,
};

type CheckInMediaRow = {
  id: string;
  purpose: WorkshopMediaPurpose;
  check_in_id: string | null;
  workshop_order_id: string;
  mime_type: string;
  size_bytes: number;
  storage_bucket: string;
  storage_key: string;
};

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
        purpose: {
          in: [
            WorkshopMediaPurpose.CHECK_IN,
            WorkshopMediaPurpose.CHECK_IN_SIGNATURE,
          ],
        },
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
    if (
      input.purpose !== 'CHECK_IN' &&
      input.purpose !== 'CHECK_IN_SIGNATURE'
    ) {
      throw new BadRequestException(
        'purpose must be CHECK_IN or CHECK_IN_SIGNATURE.',
      );
    }
    const isSignature = input.purpose === 'CHECK_IN_SIGNATURE';
    const clientUploadId = input.clientUploadId?.trim();
    if (!clientUploadId) {
      throw new BadRequestException('client_upload_id is required.');
    }
    if (!CLIENT_UPLOAD_ID_UUID_RE.test(clientUploadId)) {
      throw new BadRequestException('client_upload_id must be a valid UUID.');
    }

    const declaredMime = input.file.mimetype || 'application/octet-stream';
    assertMcpWorkshopMediaUploadDeclared(declaredMime, input.file.size);

    let processedBytes: Buffer;
    let mimeType: string;
    if (isSignature) {
      if (declaredMime !== 'image/png') {
        throw new UnprocessableEntityException({
          code: CHECK_IN_ERROR_CODES.CHECK_IN_MEDIA_INVALID,
          message: 'Check-in signature must be a PNG image.',
        });
      }
      try {
        processedBytes = await reencodeCheckInSignaturePng(input.file.buffer);
      } catch {
        throw new UnprocessableEntityException({
          code: CHECK_IN_ERROR_CODES.CHECK_IN_MEDIA_INVALID,
          message: 'Check-in signature could not be processed.',
        });
      }
      mimeType = 'image/png';
    } else {
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
      mimeType = 'image/jpeg';
    }

    const sizeBytes = processedBytes.length;
    if (isSignature && sizeBytes > CHECK_IN_SIGNATURE_MAX_BYTES) {
      throw new UnprocessableEntityException({
        code: CHECK_IN_ERROR_CODES.CHECK_IN_MEDIA_INVALID,
        message: 'Check-in signature could not be processed.',
      });
    }

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
    const expectedPurpose = isSignature
      ? WorkshopMediaPurpose.CHECK_IN_SIGNATURE
      : WorkshopMediaPurpose.CHECK_IN;

    if (existingMedia) {
      if (
        existingMedia.purpose !== expectedPurpose ||
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

    const stored = isSignature
      ? await this.mediaStorage.uploadCheckInSignature({
          tenantId,
          orderId,
          checkInId: checkInRow.id,
          bytes: processedBytes,
          filename: input.file.originalname,
          objectId: clientUploadId,
        })
      : await this.mediaStorage.uploadCheckInPhoto({
          tenantId,
          orderId,
          checkInId: checkInRow.id,
          bytes: processedBytes,
          mimeType,
          filename: input.file.originalname,
          objectId: clientUploadId,
        });

    let uploadOutcome: {
      created: boolean;
      row: CheckInMediaRow;
      replacedSignatureRows: CheckInMediaRow[];
    };

    try {
      uploadOutcome = await this.prisma.$transaction(async (tx) => {
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
          select: checkInMediaRowSelect,
        });
        if (duplicate) {
          if (
            !isSameCheckInUpload(duplicate, locked.id, orderId, expectedPurpose)
          ) {
            throw new ConflictException({
              code: CHECK_IN_ERROR_CODES.UPLOAD_ID_REUSED,
              message:
                'client_upload_id was already used for different check-in media.',
            });
          }
          return {
            created: false,
            row: duplicate,
            replacedSignatureRows: [],
          };
        }

        const nextRevision = current.revision + 1;

        const replacedSignatureRows: CheckInMediaRow[] = [];
        if (isSignature) {
          const priorSignatures = await tx.workshopMedia.findMany({
            where: {
              tenant_id: tenantId,
              check_in_id: locked.id,
              purpose: WorkshopMediaPurpose.CHECK_IN_SIGNATURE,
              id: { not: clientUploadId },
            },
            select: checkInMediaRowSelect,
          });
          for (const prior of priorSignatures) {
            await tx.workshopMedia.delete({
              where: { tenant_id: tenantId, id: prior.id },
            });
            replacedSignatureRows.push(prior);
          }
        }

        const uploadedByEmployeeId =
          await resolveCheckInMediaUploaderEmployeeId(
            tx,
            this.tenantContext,
            tenantId,
          );

        let row: CheckInMediaRow;
        try {
          row = await tx.workshopMedia.create({
            data: {
              id: clientUploadId,
              tenant_id: tenantId,
              workshop_order_id: orderId,
              workshop_task_id: null,
              check_in_id: locked.id,
              uploaded_by_employee_id: uploadedByEmployeeId,
              purpose: expectedPurpose,
              storage_bucket: stored.storageBucket,
              storage_key: stored.storageKey,
              url_strategy: WorkshopMediaUrlStrategy.SIGNED,
              mime_type: mimeType,
              size_bytes: sizeBytes,
            },
            select: checkInMediaRowSelect,
          });
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            const raced = await tx.workshopMedia.findFirst({
              where: { tenant_id: tenantId, id: clientUploadId },
              select: checkInMediaRowSelect,
            });
            if (
              raced &&
              isSameCheckInUpload(raced, locked.id, orderId, expectedPurpose)
            ) {
              return {
                created: false,
                row: raced,
                replacedSignatureRows: [],
              };
            }
          }
          throw error;
        }

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

        return { created: true, row, replacedSignatureRows };
      });
    } catch (error) {
      await deleteCheckInStoredPhotoIfUnreferenced(
        this.prisma,
        this.mediaStorage,
        tenantId,
        stored.storageBucket,
        stored.storageKey,
      );
      throw error;
    }

    for (const prior of uploadOutcome.replacedSignatureRows ?? []) {
      await deleteCheckInStoredPhotoIfUnreferenced(
        this.prisma,
        this.mediaStorage,
        tenantId,
        prior.storage_bucket,
        prior.storage_key,
      );
    }

    const preview_url = await this.mediaStorage
      .generateSignedReadUrl(
        uploadOutcome.row.storage_bucket,
        uploadOutcome.row.storage_key,
        uploadOutcome.row.mime_type,
      )
      .catch(() => null);

    return {
      created: uploadOutcome.created,
      item: {
        id: uploadOutcome.row.id,
        purpose: uploadOutcome.row.purpose,
        mime_type: uploadOutcome.row.mime_type,
        size_bytes: uploadOutcome.row.size_bytes,
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

function isSameCheckInUpload(
  row: {
    purpose: WorkshopMediaPurpose;
    check_in_id: string | null;
    workshop_order_id: string;
  },
  checkInId: string,
  orderId: string,
  purpose: WorkshopMediaPurpose,
): boolean {
  return (
    row.purpose === purpose &&
    row.check_in_id === checkInId &&
    row.workshop_order_id === orderId
  );
}
