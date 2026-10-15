import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Storage } from '@google-cloud/storage';
import { SideEffectGuard } from '../dry-run/side-effect-guard.js';

export const REGISTRATION_INTAKE_BYTE_STORAGE = Symbol(
  'REGISTRATION_INTAKE_BYTE_STORAGE',
);

export interface RegistrationIntakeByteStorage {
  storePage(params: {
    tenantId: string;
    intakeId: string;
    page: number;
    bytes: Buffer;
    contentType: string;
  }): Promise<void>;
  deleteIntakePrefix(params: {
    tenantId: string;
    intakeId: string;
  }): Promise<void>;
  deleteTenantPrefix(tenantId: string): Promise<void>;
  intakeObjectPrefix(tenantId: string, intakeId: string): string;
}

@Injectable()
export class GcsRegistrationIntakeByteStorage implements RegistrationIntakeByteStorage {
  private readonly storage = new Storage();

  intakeObjectPrefix(tenantId: string, intakeId: string): string {
    return `registration-intakes/${tenantId}/${intakeId}/`;
  }

  private resolveBucket(): string {
    const bucket =
      process.env.REGISTRATION_INTAKE_BUCKET?.trim() ||
      process.env.WORKSHOP_MEDIA_BUCKET?.trim() ||
      process.env.DOCUMENT_BRANDING_BUCKET?.trim();
    if (!bucket) {
      throw new InternalServerErrorException(
        'REGISTRATION_INTAKE_BUCKET environment variable is not configured',
      );
    }
    return bucket;
  }

  async storePage(params: {
    tenantId: string;
    intakeId: string;
    page: number;
    bytes: Buffer;
    contentType: string;
  }): Promise<void> {
    SideEffectGuard.assertAllowed('GCS_WRITE');
    const bucketName = this.resolveBucket();
    const objectKey = `${this.intakeObjectPrefix(params.tenantId, params.intakeId)}page-${params.page}`;
    const file = this.storage.bucket(bucketName).file(objectKey);
    await file.save(params.bytes, {
      resumable: false,
      validation: 'crc32c',
      metadata: {
        contentType: params.contentType,
        cacheControl: 'private, no-store',
      },
    });
  }

  async deleteIntakePrefix(params: {
    tenantId: string;
    intakeId: string;
  }): Promise<void> {
    SideEffectGuard.assertAllowed('GCS_WRITE');
    const bucketName = this.resolveBucket();
    const prefix = this.intakeObjectPrefix(params.tenantId, params.intakeId);
    const [files] = await this.storage.bucket(bucketName).getFiles({ prefix });
    await Promise.all(
      files.map((file) => file.delete({ ignoreNotFound: true })),
    );
  }

  async deleteTenantPrefix(tenantId: string): Promise<void> {
    SideEffectGuard.assertAllowed('GCS_WRITE');
    const bucketName = this.resolveBucket();
    const prefix = `registration-intakes/${tenantId}/`;
    const [files] = await this.storage.bucket(bucketName).getFiles({ prefix });
    await Promise.all(
      files.map((file) => file.delete({ ignoreNotFound: true })),
    );
  }
}
