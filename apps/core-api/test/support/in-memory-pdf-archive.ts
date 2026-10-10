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
export type SignedReadRecord = {
  bucket: string;
  key: string;
  filename: string;
  ttlSeconds: number;
  url: string;
  expiresAt: Date;
};

export function createInMemoryPdfArchive(bucket = 'e2e-pdf-archive') {
  const objectsByKey = new Map<string, StoredPdfObject[]>();
  const signedReads: SignedReadRecord[] = [];
  let nextGeneration = 1000;

  return {
    objectsByKey,
    /** Every read link issued, in call order. The URL is a fake; the TTL is clamped like the real store. */
    signedReads,
    async createSignedReadUrl(params: {
      bucket?: string | null;
      key: string;
      filename: string;
      ttlSeconds?: number;
    }): Promise<{ url: string; expiresAt: Date }> {
      const bucketName = params.bucket ?? bucket;
      const ttlSeconds = Math.min(
        Math.max(Math.floor(params.ttlSeconds ?? 900), 1),
        900,
      );
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      const url = `https://storage.example.test/${bucketName}/${encodeURIComponent(params.key)}?X-Goog-Expires=${ttlSeconds}&X-Goog-Signature=in-memory-test-signature`;
      signedReads.push({
        bucket: bucketName,
        key: params.key,
        filename: params.filename,
        ttlSeconds,
        url,
        expiresAt,
      });
      return { url, expiresAt };
    },
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
