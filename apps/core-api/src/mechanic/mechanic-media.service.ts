import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Prisma,
  WorkshopMediaUrlStrategy,
  WorkshopTaskStatus,
} from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateMediaDto, RequestMediaUploadDto } from './dto/media.dto';
import type { MediaUploadPolicyDto, WorkshopMediaDto } from './dto/media.dto';
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from './dto/media.dto';
import {
  IMAGE_MIME_TYPES,
  MechanicMediaStorage,
} from './mechanic-media.storage';
import { assertTaskAssignedToMechanic } from './mechanic-task-access';

@Injectable()
export class MechanicMediaService {
  /**
   * Cached on first use; undefined when the env var is absent (e.g. during
   * OpenAPI generation).  Methods that actually need the bucket call
   * `getWorkshopMediaBucket()` which throws lazily so the app can still start
   * without this var set.
   */
  private readonly workshopMediaBucket: string | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly mediaStorage: MechanicMediaStorage,
  ) {
    this.workshopMediaBucket = process.env.WORKSHOP_MEDIA_BUCKET;
  }

  /** Returns the configured bucket name or throws at call time (not startup). */
  private getWorkshopMediaBucket(): string {
    if (!this.workshopMediaBucket) {
      throw new InternalServerErrorException(
        'WORKSHOP_MEDIA_BUCKET environment variable is not configured.',
      );
    }
    return this.workshopMediaBucket;
  }
  // ─── Media Upload Policy ───────────────────────────────────────────────────

  /**
   * Generates a short-lived GCS presigned POST upload policy for direct-to-
   * storage upload (ADR-0014 §7.1).
   *
   * The client must call `POST /media` after successfully uploading to
   * persist the metadata (ADR-0014 §7.2).
   */
  async createMediaUploadPolicy(
    mechanicId: string,
    taskId: string,
    dto: RequestMediaUploadDto,
  ): Promise<MediaUploadPolicyDto> {
    const tenantId = await this.tenantContext.getTenantId();

    const task = await this.prisma.workshopTask.findFirst({
      where: { id: taskId, tenant_id: tenantId },
      select: {
        id: true,
        bay_id: true,
        status: true,
        mechanic_id: true,
        workshop_order_id: true,
        workshop_order: { select: { mechanic_id: true, bay_id: true } },
      },
    });

    if (!task) {
      throw new NotFoundException(`Task ${taskId} not found.`);
    }

    assertTaskAssignedToMechanic(task, mechanicId);

    if (task.status === WorkshopTaskStatus.DONE) {
      throw new UnprocessableEntityException(
        `Cannot upload media for completed task ${taskId}.`,
      );
    }

    const policy = await this.mediaStorage.generateUploadPolicy({
      tenantId,
      orderId: task.workshop_order_id,
      taskId,
      mimeType: dto.mimeType,
      sizeBytes: dto.sizeBytes,
      filename: dto.filename,
    });

    return {
      uploadUrl: policy.uploadUrl,
      formFields: policy.formFields,
      storageBucket: policy.storageBucket,
      storageKey: policy.storageKey,
      expiresAt: policy.expiresAt.toISOString(),
    } satisfies MediaUploadPolicyDto;
  }

  // ─── Media Metadata Persist ────────────────────────────────────────────────

  /**
   * Persists `WorkshopMedia` metadata after a successful direct upload.
   *
   * Media metadata is stored only after the upload policy was successfully
   * used and the client confirms the upload.  File blobs are never written
   * to Postgres (ADR-0014 §7.1).
   */
  async saveMediaMetadata(
    mechanicId: string,
    taskId: string,
    dto: CreateMediaDto,
  ): Promise<WorkshopMediaDto> {
    const tenantId = await this.tenantContext.getTenantId();

    const task = await this.prisma.workshopTask.findFirst({
      where: { id: taskId, tenant_id: tenantId },
      select: {
        id: true,
        bay_id: true,
        status: true,
        mechanic_id: true,
        workshop_order_id: true,
        workshop_order: { select: { mechanic_id: true, bay_id: true } },
      },
    });

    if (!task) {
      throw new NotFoundException(`Task ${taskId} not found.`);
    }

    assertTaskAssignedToMechanic(task, mechanicId);

    if (task.status === WorkshopTaskStatus.DONE) {
      throw new UnprocessableEntityException(
        `Cannot persist media for completed task ${taskId}.`,
      );
    }

    // Validate that the client-supplied bucket and key refer to the expected
    // tenant/order/task-scoped location.  This prevents callers from pointing
    // WorkshopMedia records at arbitrary buckets or objects outside their scope
    // (ADR-0014 §7.2 security).
    if (dto.storageBucket !== this.getWorkshopMediaBucket()) {
      throw new BadRequestException(
        `Invalid storage bucket. Expected "${this.getWorkshopMediaBucket()}".`,
      );
    }
    const expectedKeyPrefix = `tenants/${tenantId}/orders/${task.workshop_order_id}/tasks/${taskId}/`;
    if (!dto.storageKey.startsWith(expectedKeyPrefix)) {
      throw new BadRequestException(
        `Invalid storage key. Key must start with "${expectedKeyPrefix}".`,
      );
    }

    // Enforce the same per-MIME-type size caps used by the upload policy endpoint.
    const isImage = IMAGE_MIME_TYPES.has(dto.mimeType);
    const hardCap = isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    if (dto.sizeBytes > hardCap) {
      throw new BadRequestException(
        `Reported file size ${dto.sizeBytes} bytes exceeds the maximum allowed for ${dto.mimeType} (${hardCap} bytes).`,
      );
    }

    const media = await this.prisma.workshopMedia.create({
      data: {
        tenant_id: tenantId,
        workshop_order_id: task.workshop_order_id,
        workshop_task_id: taskId,
        uploaded_by_employee_id: mechanicId,
        storage_bucket: dto.storageBucket,
        storage_key: dto.storageKey,
        url_strategy: WorkshopMediaUrlStrategy.SIGNED,
        mime_type: dto.mimeType,
        size_bytes: dto.sizeBytes,
        duration_seconds:
          dto.durationSeconds != null
            ? new Prisma.Decimal(dto.durationSeconds)
            : null,
        caption: dto.caption ?? null,
      },
    });

    // The Prisma dashboard-realtime extension emits WORKSHOP_MEDIA CREATED
    // automatically for this create; no manual emit is needed.

    return {
      id: media.id,
      workshopOrderId: media.workshop_order_id,
      workshopTaskId: media.workshop_task_id,
      uploadedByEmployeeId: media.uploaded_by_employee_id,
      storageBucket: media.storage_bucket,
      storageKey: media.storage_key,
      urlStrategy: media.url_strategy,
      mimeType: media.mime_type,
      sizeBytes: media.size_bytes,
      durationSeconds: media.duration_seconds
        ? Number(media.duration_seconds)
        : null,
      caption: media.caption,
      createdAt: media.createdAt,
      updatedAt: media.updatedAt,
    } satisfies WorkshopMediaDto;
  }
}
