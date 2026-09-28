import { InternalServerErrorException, Injectable } from '@nestjs/common';
import { Storage } from '@google-cloud/storage';

@Injectable()
export class DocumentBrandingAssetStorage {
  private readonly storage = new Storage();

  async storeImmutable(params: {
    objectKey: string;
    bytes: Buffer;
    contentType: string;
  }) {
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
    await this.storage
      .bucket(bucketName)
      .file(objectKey, { generation })
      .delete({
        ifGenerationMatch: Number(generation),
        ignoreNotFound: true,
      });
  }
}
