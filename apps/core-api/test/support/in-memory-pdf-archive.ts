import { createHash } from 'node:crypto';
import { InternalServerErrorException } from '@nestjs/common';

export type StoredPdfObject = {
  bucket: string;
  key: string;
  generation: string;
  body: Buffer;
  sha256: string;
  customMetadata: Record<string, string>;
};

/**
 * Create-only object store for e2e runs. It mirrors the GCS contract the
 * services rely on: a published key is never overwritten (412), and reads
 * verify generation, checksum, and identity. The renderer stays real.
 */
export function createInMemoryPdfArchive(bucket = 'e2e-pdf-archive') {
  const objectsByKey = new Map<string, StoredPdfObject[]>();
  let nextGeneration = 1000;

  return {
    objectsByKey,
    async publishImmutableObject(params: {
      key: string;
      body: Buffer;
      customMetadata: Record<string, string>;
    }) {
      if (objectsByKey.has(params.key)) {
        throw Object.assign(new Error('precondition failed'), { code: 412 });
      }
      const sha256 = createHash('sha256').update(params.body).digest('hex');
      const stored: StoredPdfObject = {
        bucket,
        key: params.key,
        generation: String(nextGeneration++),
        body: params.body,
        sha256,
        customMetadata: { ...params.customMetadata, pdf_sha256: sha256 },
      };
      objectsByKey.set(params.key, [stored]);
      return {
        bucket: stored.bucket,
        key: stored.key,
        generation: stored.generation,
        sha256,
        customMetadata: stored.customMetadata,
      };
    },
    async readImmutableObjectByKey(params: {
      key: string;
      validateMetadata: (metadata: Record<string, string>) => boolean;
    }) {
      const stored = objectsByKey.get(params.key)?.[0];
      if (!stored || !params.validateMetadata(stored.customMetadata)) {
        throw new InternalServerErrorException(
          'Immutable PDF archive identity could not be verified',
        );
      }
      return { ...stored };
    },
    async readImmutableObjectGeneration(params: {
      key: string;
      generation: string;
      expectedSha256: string;
      validateMetadata: (metadata: Record<string, string>) => boolean;
    }) {
      const stored = objectsByKey
        .get(params.key)
        ?.find((object) => object.generation === params.generation);
      if (
        !stored ||
        stored.sha256 !== params.expectedSha256 ||
        !params.validateMetadata(stored.customMetadata)
      ) {
        throw new InternalServerErrorException(
          'Immutable PDF archive checksum metadata could not be verified',
        );
      }
      return { ...stored };
    },
  };
}
