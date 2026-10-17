import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Storage } from '@google-cloud/storage';
import { SideEffectGuard } from '../../dry-run/side-effect-guard.js';

export const VEHICLE_MEDIA_STORAGE = Symbol('VEHICLE_MEDIA_STORAGE');

export interface VehicleMediaStorage {
  resolveBucket(): string;
  objectPrefix(tenantId: string, vehicleId: string, mediaId: string): string;
  storeProcessedObject(params: {
    tenantId: string;
    vehicleId: string;
    mediaId: string;
    variantName: string;
    bytes: Buffer;
    contentType: string;
  }): Promise<string>;
  deleteObjects(bucket: string, keys: string[]): Promise<void>;
  deleteVehicleMediaPrefix(params: {
    tenantId: string;
    vehicleId: string;
  }): Promise<void>;
  deleteTenantVehicleMediaPrefix(tenantId: string): Promise<void>;
}

@Injectable()
export class GcsVehicleMediaStorage implements VehicleMediaStorage {
  private readonly logger = new Logger(GcsVehicleMediaStorage.name);
  private readonly storage = new Storage();

  resolveBucket(): string {
    const bucket =
      process.env.VEHICLE_MEDIA_BUCKET?.trim() ||
      process.env.WORKSHOP_MEDIA_BUCKET?.trim();
    if (!bucket) {
      throw new InternalServerErrorException(
        'Vehicle photo storage is not configured. Set VEHICLE_MEDIA_BUCKET or WORKSHOP_MEDIA_BUCKET.',
      );
    }
    return bucket;
  }

  objectPrefix(tenantId: string, vehicleId: string, mediaId: string): string {
    return `tenants/${tenantId}/vehicles/${vehicleId}/media/${mediaId}/`;
  }

  async storeProcessedObject(params: {
    tenantId: string;
    vehicleId: string;
    mediaId: string;
    variantName: string;
    bytes: Buffer;
    contentType: string;
  }): Promise<string> {
    SideEffectGuard.assertAllowed('GCS_WRITE');
    const bucketName = this.resolveBucket();
    const objectKey = `${this.objectPrefix(
      params.tenantId,
      params.vehicleId,
      params.mediaId,
    )}${params.variantName}.jpg`;
    const file = this.storage.bucket(bucketName).file(objectKey);
    await file.save(params.bytes, {
      resumable: false,
      validation: 'crc32c',
      metadata: {
        contentType: params.contentType,
        cacheControl: 'private, no-store',
      },
    });
    return objectKey;
  }

  async deleteObjects(bucket: string, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    SideEffectGuard.assertAllowed('GCS_WRITE');
    const unique = [...new Set(keys)];
    await Promise.all(
      unique.map((key) =>
        this.storage
          .bucket(bucket)
          .file(key)
          .delete({ ignoreNotFound: true })
          .catch((error) => {
            this.logger.warn(
              `Failed to delete vehicle media object ${key}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }),
      ),
    );
  }

  async deleteVehicleMediaPrefix(params: {
    tenantId: string;
    vehicleId: string;
  }): Promise<void> {
    SideEffectGuard.assertAllowed('GCS_WRITE');
    const bucketName = this.resolveBucket();
    const prefix = `tenants/${params.tenantId}/vehicles/${params.vehicleId}/media/`;
    const [files] = await this.storage
      .bucket(bucketName)
      .getFiles({ prefix });
    await Promise.all(
      files.map((file) => file.delete({ ignoreNotFound: true })),
    );
  }

  async deleteTenantVehicleMediaPrefix(tenantId: string): Promise<void> {
    SideEffectGuard.assertAllowed('GCS_WRITE');
    const bucketName = this.resolveBucket();
    const prefix = `tenants/${tenantId}/vehicles/`;
    const [files] = await this.storage
      .bucket(bucketName)
      .getFiles({ prefix: `${prefix}` });
    const mediaFiles = files.filter((file) =>
      file.name.includes('/media/'),
    );
    await Promise.all(
      mediaFiles.map((file) => file.delete({ ignoreNotFound: true })),
    );
  }
}
