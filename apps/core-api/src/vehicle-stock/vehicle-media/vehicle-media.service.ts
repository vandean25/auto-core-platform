import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TenantContextService } from '../../common/services/tenant-context.service.js';
import { SiteContextService } from '../../site/site-context.service.js';
import { requireActiveCurrentUser } from '../../site/site.authorization.js';
import { processUploadImage } from '../../common/media/image-processing.js';
import {
  assertVehiclePhotoMimeType,
  detectVehiclePhotoMimeType,
  requireVehiclePhotoUpload,
  VEHICLE_MEDIA_MAX_INPUT_PIXELS,
} from './vehicle-media-upload.rules.js';
import {
  DEFAULT_VEHICLE_MEDIA_MAIN_LIMITS,
  resolveVehicleMediaPortalVariants,
} from './vehicle-media-portal-variants.js';
import {
  VEHICLE_MEDIA_STORAGE,
  type VehicleMediaStorage,
} from './vehicle-media.storage.js';
import {
  collectVehicleMediaObjectKeys,
  type VehicleMediaVariantMap,
} from './vehicle-media.types.js';
import { toVehicleMediaDto, type VehicleMediaDto } from './dto/vehicle-media.dto.js';

@Injectable()
export class VehicleMediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    @Inject(VEHICLE_MEDIA_STORAGE)
    private readonly storage: VehicleMediaStorage,
  ) {}

  async list(vehicleId: string): Promise<VehicleMediaDto[]> {
    const tenantId = await this.tenantContext.getTenantId();
    await this.assertStockVehicleAtActiveSite(tenantId, vehicleId);
    const rows = await this.prisma.vehicleMedia.findMany({
      where: { tenant_id: tenantId, vehicle_id: vehicleId },
      orderBy: { sort_order: 'asc' },
    });
    return rows.map(toVehicleMediaDto);
  }

  async upload(
    vehicleId: string,
    file: Express.Multer.File | undefined,
  ): Promise<VehicleMediaDto> {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    await this.assertStockVehicleAtActiveSite(tenantId, vehicleId);
    const bytes = requireVehiclePhotoUpload(file);
    const detectedMime = detectVehiclePhotoMimeType(bytes);
    assertVehiclePhotoMimeType(detectedMime);

    const metadata = await sharp(bytes, {
      limitInputPixels: VEHICLE_MEDIA_MAX_INPUT_PIXELS,
      failOn: 'warning',
    }).metadata();
    const pixelCount = (metadata.width ?? 0) * (metadata.height ?? 0);
    if (pixelCount > VEHICLE_MEDIA_MAX_INPUT_PIXELS) {
      throw new BadRequestException({
        code: 'VEHICLE_PHOTO_TOO_MANY_PIXELS',
        message: 'Vehicle photo exceeds the maximum pixel count.',
      });
    }

    const portalVariants = resolveVehicleMediaPortalVariants();
    const processed = await processUploadImage(bytes, {
      main: DEFAULT_VEHICLE_MEDIA_MAIN_LIMITS,
      variants: portalVariants,
      limitInputPixels: VEHICLE_MEDIA_MAX_INPUT_PIXELS,
    });

    const mediaId = randomUUID();
    const bucket = this.storage.resolveBucket();
    const processedKey = await this.storage.storeProcessedObject({
      tenantId,
      vehicleId,
      mediaId,
      variantName: 'processed',
      bytes: processed.main.bytes,
      contentType: processed.main.contentType,
    });

    const variantMap: VehicleMediaVariantMap = {};
    for (const [name, variant] of Object.entries(processed.variants ?? {})) {
      const storageKey = await this.storage.storeProcessedObject({
        tenantId,
        vehicleId,
        mediaId,
        variantName: name,
        bytes: variant.bytes,
        contentType: variant.contentType,
      });
      variantMap[name] = {
        storage_key: storageKey,
        width: variant.width,
        height: variant.height,
        content_type: variant.contentType,
      };
    }

    const contentSha256 = createHash('sha256')
      .update(processed.main.bytes)
      .digest('hex');
    const actor = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );

    const created = await this.prisma.$transaction(async (tx) => {
      const maxOrder = await tx.vehicleMedia.aggregate({
        where: { tenant_id: tenantId, vehicle_id: vehicleId },
        _max: { sort_order: true },
      });
      const nextOrder = (maxOrder._max.sort_order ?? -1) + 1;
      const existingCount = await tx.vehicleMedia.count({
        where: { tenant_id: tenantId, vehicle_id: vehicleId },
      });
      const isFirst = existingCount === 0;

      return tx.vehicleMedia.create({
        data: {
          id: mediaId,
          tenant_id: tenantId,
          vehicle_id: vehicleId,
          site_id: siteId,
          sort_order: nextOrder,
          is_cover: isFirst,
          storage_bucket: bucket,
          processed_storage_key: processedKey,
          variant_storage_keys: variantMap,
          content_type: processed.main.contentType,
          width: processed.main.width,
          height: processed.main.height,
          content_sha256: contentSha256,
          created_by_user_id: actor.id,
        },
      });
    });

    return toVehicleMediaDto(created);
  }

  async reorder(vehicleId: string, mediaIds: string[]): Promise<VehicleMediaDto[]> {
    const tenantId = await this.tenantContext.getTenantId();
    await this.assertStockVehicleAtActiveSite(tenantId, vehicleId);

    if (!Array.isArray(mediaIds) || mediaIds.length === 0) {
      throw new BadRequestException('mediaIds must be a non-empty ordered list.');
    }
    const unique = new Set(mediaIds);
    if (unique.size !== mediaIds.length) {
      throw new BadRequestException('mediaIds must not contain duplicates.');
    }

    const existing = await this.prisma.vehicleMedia.findMany({
      where: { tenant_id: tenantId, vehicle_id: vehicleId },
      select: { id: true },
    });
    if (existing.length !== mediaIds.length) {
      throw new BadRequestException(
        'mediaIds must list every photo for this vehicle exactly once.',
      );
    }
    const existingIds = new Set(existing.map((row) => row.id));
    for (const id of mediaIds) {
      if (!existingIds.has(id)) {
        throw new BadRequestException(
          'mediaIds contains a photo that does not belong to this vehicle.',
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      for (let index = 0; index < mediaIds.length; index++) {
        const id = mediaIds[index];
        const updated = await tx.vehicleMedia.updateMany({
          where: {
            tenant_id: tenantId,
            vehicle_id: vehicleId,
            id,
          },
          data: { sort_order: index },
        });
        if (updated.count !== 1) {
          throw new BadRequestException(
            'mediaIds contains a photo that does not belong to this vehicle.',
          );
        }
      }
    });

    return this.list(vehicleId);
  }

  async setCover(vehicleId: string, mediaId: string): Promise<VehicleMediaDto> {
    const tenantId = await this.tenantContext.getTenantId();
    await this.assertStockVehicleAtActiveSite(tenantId, vehicleId);

    const target = await this.prisma.vehicleMedia.findFirst({
      where: {
        tenant_id: tenantId,
        vehicle_id: vehicleId,
        id: mediaId,
      },
    });
    if (!target) {
      throw new NotFoundException('Vehicle photo not found.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.vehicleMedia.updateMany({
        where: {
          tenant_id: tenantId,
          vehicle_id: vehicleId,
          is_cover: true,
        },
        data: { is_cover: false },
      });
      return tx.vehicleMedia.update({
        where: { tenant_id: tenantId, id: mediaId },
        data: { is_cover: true },
      });
    });

    return toVehicleMediaDto(updated);
  }

  async remove(vehicleId: string, mediaId: string): Promise<void> {
    const tenantId = await this.tenantContext.getTenantId();
    await this.assertStockVehicleAtActiveSite(tenantId, vehicleId);

    const row = await this.prisma.vehicleMedia.findFirst({
      where: {
        tenant_id: tenantId,
        vehicle_id: vehicleId,
        id: mediaId,
      },
    });
    if (!row) {
      throw new NotFoundException('Vehicle photo not found.');
    }

    const keys = collectVehicleMediaObjectKeys(row);
    await this.storage.deleteObjects(row.storage_bucket, keys);

    await this.prisma.$transaction(async (tx) => {
      await tx.vehicleMedia.delete({
        where: { tenant_id: tenantId, id: mediaId },
      });
      if (row.is_cover) {
        const replacement = await tx.vehicleMedia.findFirst({
          where: { tenant_id: tenantId, vehicle_id: vehicleId },
          orderBy: { sort_order: 'asc' },
        });
        if (replacement) {
          await tx.vehicleMedia.update({
            where: { tenant_id: tenantId, id: replacement.id },
            data: { is_cover: true },
          });
        }
      }
    });
  }

  async purgeStoredObjectsForVehicle(
    tenantId: string,
    vehicleId: string,
  ): Promise<void> {
    await this.storage.deleteVehicleMediaPrefix({ tenantId, vehicleId });
  }

  private async assertStockVehicleAtActiveSite(
    tenantId: string,
    vehicleId: string,
  ) {
    const siteId = await this.siteContext.getSiteId();
    const vehicle = await this.prisma.vehicle.findFirst({
      where: {
        id: vehicleId,
        tenant_id: tenantId,
        location: { site_id: siteId },
      },
      select: { id: true, site_id: true },
    });
    if (!vehicle) {
      throw new NotFoundException(`Vehicle ${vehicleId} not found`);
    }
    return vehicle;
  }
}
