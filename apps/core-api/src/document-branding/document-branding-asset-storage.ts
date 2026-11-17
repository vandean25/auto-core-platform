import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InternalServerErrorException, Injectable } from '@nestjs/common';
import { Storage } from '@google-cloud/storage';
import { SideEffectGuard } from '../dry-run/side-effect-guard.js';

export const BUNDLED_DEMO_BRANDING_BUCKET = 'bundled-demo-branding';
export const BUNDLED_DEMO_LOGO_OBJECT_KEY = 'demo-workshop-logo.png';
export const BUNDLED_DEMO_LOGO_GENERATION = '1';

export function bundledDemoLogoPath(): string {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    'assets',
    BUNDLED_DEMO_LOGO_OBJECT_KEY,
  );
}

@Injectable()
export class DocumentBrandingAssetStorage {
  private readonly storage = new Storage();

  async storeImmutable(params: {
    objectKey: string;
    bytes: Buffer;
    contentType: string;
  }) {
    SideEffectGuard.assertAllowed('GCS_WRITE');
    const bucketName = process.env.DOCUMENT_BRANDING_BUCKET?.trim();
    if (!bucketName) {
      throw new InternalServerErrorException(
        'DOCUMENT_BRANDING_BUCKET environment variable is not configured',
      );
    }
    const file = this.storage.bucket(bucketName).file(params.objectKey);
    await file.save(params.bytes, {
      resumable: false,
      validation: 'crc32c',
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        contentType: params.contentType,
        cacheControl: 'private, no-store',
      },
    });
    const [metadata] = await file.getMetadata();
    if (!metadata.generation) {
      throw new InternalServerErrorException(
        'Storage did not return an immutable asset generation',
      );
    }
    return { bucket: bucketName, generation: String(metadata.generation) };
  }

  async readGeneration(
    bucketName: string,
    objectKey: string,
    generation: string,
  ) {
    if (
      bucketName === BUNDLED_DEMO_BRANDING_BUCKET &&
      objectKey === BUNDLED_DEMO_LOGO_OBJECT_KEY &&
      generation === BUNDLED_DEMO_LOGO_GENERATION
    ) {
      return readFile(bundledDemoLogoPath());
    }
    const [bytes] = await this.storage
      .bucket(bucketName)
      .file(objectKey, { generation })
      .download();
    return bytes;
  }

  async deleteGeneration(
    bucketName: string,
    objectKey: string,
    generation: string,
  ) {
    if (bucketName === BUNDLED_DEMO_BRANDING_BUCKET) {
      return;
    }
    await this.storage
      .bucket(bucketName)
      .file(objectKey, { generation })
      .delete({
        ifGenerationMatch: Number(generation),
        ignoreNotFound: true,
      });
  }
}
