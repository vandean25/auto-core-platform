import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { DocumentBrandingPdfParser } from './document-branding-pdf-parser.js';
import { DocumentBrandingAssetStorage } from './document-branding-asset-storage.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DecisionUseCaseHooksService } from '../decision/decision-use-case-hooks.service.js';
import { extractLoosePdfText } from '../decision/pdf-loose-text.util.js';
import { RequestContextService } from '../common/services/request-context.service.js';

const MAX_IMAGE_SIDE = 8192;
const MAX_IMAGE_PIXELS = 16_000_000;
const MAX_LOGO_SIDE = 1024;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const VALIDATION_LEASE_MS = 15 * 60 * 1000;

@Injectable()
export class DocumentBrandingUploadWorkerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: DocumentBrandingAssetStorage,
    private readonly pdfParser: DocumentBrandingPdfParser,
    private readonly decisionHooks: DecisionUseCaseHooksService,
    private readonly requestContext: RequestContextService,
  ) {}

  async validate(assetId: string, tenantId: string) {
    const current = await this.prisma.documentBrandAsset.findFirst({
      where: { id: assetId, tenant_id: tenantId },
    });
    if (!current)
      throw new NotFoundException('Document branding asset not found');
    if (current.state !== 'QUARANTINED') return { state: current.state };

    const now = new Date();
    const leaseUntil = new Date(now.getTime() + VALIDATION_LEASE_MS);
    const claimed = await this.prisma.documentBrandAsset.updateMany({
      where: {
        id: assetId,
        tenant_id: tenantId,
        state: 'QUARANTINED',
        validation_attempt_count: { lt: 3 },
        OR: [
          { validation_lease_until: null },
          { validation_lease_until: { lt: now } },
        ],
      },
      data: {
        validation_attempt_count: { increment: 1 },
        validation_lease_until: leaseUntil,
        validation_dispatched_at: null,
      },
    });
    if (claimed.count !== 1) return { state: 'QUARANTINED' as const };

    let published: {
      bucket: string;
      objectKey: string;
      generation: string;
    } | null = null;
    let previewPublished: {
      bucket: string;
      objectKey: string;
      generation: string;
    } | null = null;
    let readyPersisted = false;
    try {
      if (
        !current.quarantine_bucket ||
        !current.quarantine_object_key ||
        !current.quarantine_object_generation
      ) {
        throw invalidAsset('BRAND_ASSET_QUARANTINE_MISSING');
      }
      const original = await this.storage.readGeneration(
        current.quarantine_bucket,
        current.quarantine_object_key,
        current.quarantine_object_generation,
      );
      const validated = await this.validateBytes(
        current.purpose,
        current.detected_mime_type,
        original,
      );
      if (current.detected_mime_type === 'application/pdf') {
        const text = extractLoosePdfText(validated.bytes);
        this.decisionHooks.scheduleDocumentSortForText({
          tenantId,
          traceId: this.requestContext.getTraceId(),
          text,
        });
      }
      const rootKey = `tenants/${tenantId}/legal-entities/${current.legal_entity_id}/document-branding`;
      const extension =
        current.detected_mime_type === 'application/pdf' ? 'pdf' : 'png';
      const objectKey = `${rootKey}/assets/${assetId}.${extension}`;
      const stored = await this.storage.storeImmutable({
        objectKey,
        bytes: validated.bytes,
        contentType: current.detected_mime_type ?? 'application/octet-stream',
      });
      published = { ...stored, objectKey };
      if (validated.pagePreviewPng) {
        const previewObjectKey = `${rootKey}/assets/${assetId}-page1.png`;
        const previewStored = await this.storage.storeImmutable({
          objectKey: previewObjectKey,
          bytes: validated.pagePreviewPng,
          contentType: 'image/png',
        });
        previewPublished = { ...previewStored, objectKey: previewObjectKey };
      }
      const ready = await this.prisma.documentBrandAsset.updateMany({
        where: {
          id: assetId,
          tenant_id: tenantId,
          state: 'QUARANTINED',
          validation_lease_until: leaseUntil,
        },
        data: {
          state: 'READY',
          bucket: stored.bucket,
          object_key: objectKey,
          object_generation: stored.generation,
          preview_bucket: previewPublished?.bucket ?? null,
          preview_object_key: previewPublished?.objectKey ?? null,
          preview_object_generation: previewPublished?.generation ?? null,
          sha256: createHash('sha256').update(validated.bytes).digest('hex'),
          byte_length: validated.bytes.byteLength,
          pixel_width: validated.width,
          pixel_height: validated.height,
          failure_code: null,
          validation_dispatched_at: null,
          expires_at: new Date(
            Date.now() +
              (current.purpose === 'SOURCE' ? 30 : 7) * 24 * 60 * 60 * 1000,
          ),
          validation_lease_until: null,
        },
      });
      if (ready.count !== 1) {
        if (previewPublished) {
          await this.deletePublishedGeneration(previewPublished);
          previewPublished = null;
        }
        await this.deletePublishedGeneration(published);
        published = null;
        return { state: 'QUARANTINED' as const };
      }
      readyPersisted = true;
      await this.storage.deleteGeneration(
        current.quarantine_bucket,
        current.quarantine_object_key,
        current.quarantine_object_generation,
      );
      return { state: 'READY' as const };
    } catch (error) {
      if (previewPublished && !readyPersisted) {
        await this.deletePublishedGeneration(previewPublished);
      }
      if (published && !readyPersisted) {
        await this.deletePublishedGeneration(published);
      }
      if (readyPersisted) throw error;
      if (isValidationError(error)) {
        await this.prisma.documentBrandAsset.updateMany({
          where: {
            id: assetId,
            tenant_id: tenantId,
            validation_lease_until: leaseUntil,
          },
          data: {
            state: 'REJECTED',
            failure_code: readErrorCode(error),
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
            validation_dispatched_at: null,
            validation_lease_until: null,
          },
        });
        return { state: 'REJECTED' as const };
      }
      const exhausted = current.validation_attempt_count + 1 >= 3;
      await this.prisma.documentBrandAsset.updateMany({
        where: {
          id: assetId,
          tenant_id: tenantId,
          validation_lease_until: leaseUntil,
        },
        data: {
          state: exhausted ? 'REJECTED' : 'QUARANTINED',
          failure_code: exhausted ? 'VALIDATION_RETRIES_EXHAUSTED' : null,
          expires_at: exhausted
            ? new Date(Date.now() + 24 * 60 * 60 * 1000)
            : current.expires_at,
          validation_dispatched_at: new Date(),
          validation_lease_until: null,
        },
      });
      throw error;
    }
  }

  private async validateBytes(
    purpose: 'SOURCE' | 'LOGO',
    mimeType: string | null,
    original: Buffer,
  ) {
    if (mimeType === 'application/pdf' && purpose === 'SOURCE') {
      const pdf = await this.pdfParser.validateAndRasterize(original);
      return {
        bytes: original,
        width: pdf.width,
        height: pdf.height,
        pagePreviewPng: pdf.raster,
      };
    }
    if (mimeType !== 'image/png')
      throw invalidAsset('BRAND_FILE_TYPE_UNSUPPORTED');

    try {
      const image = sharp(original, {
        limitInputPixels: MAX_IMAGE_PIXELS,
        failOn: 'warning',
      });
      const metadata = await image.metadata();
      if (
        metadata.format !== 'png' ||
        !metadata.width ||
        !metadata.height ||
        metadata.width > MAX_IMAGE_SIDE ||
        metadata.height > MAX_IMAGE_SIDE ||
        metadata.width * metadata.height > MAX_IMAGE_PIXELS
      )
        throw invalidAsset('BRAND_PNG_DIMENSIONS_INVALID');

      if (purpose === 'SOURCE') {
        await image.clone().raw().toBuffer();
        return {
          bytes: original,
          width: metadata.width,
          height: metadata.height,
        };
      }
      const { data, info } = await image
        .resize({
          width: MAX_LOGO_SIDE,
          height: MAX_LOGO_SIDE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .png({ compressionLevel: 9 })
        .toBuffer({ resolveWithObject: true });
      if (data.byteLength > MAX_LOGO_BYTES)
        throw invalidAsset('BRAND_LOGO_TOO_LARGE');
      return { bytes: data, width: info.width, height: info.height };
    } catch (error) {
      if (isValidationError(error)) throw error;
      if (isImageLimitError(error))
        throw invalidAsset('BRAND_PNG_DIMENSIONS_INVALID');
      throw invalidAsset('BRAND_PNG_INVALID');
    }
  }

  private deletePublishedGeneration(published: {
    bucket: string;
    objectKey: string;
    generation: string;
  }) {
    return this.storage.deleteGeneration(
      published.bucket,
      published.objectKey,
      published.generation,
    );
  }
}

function invalidAsset(code: string) {
  return new UnprocessableEntityException({
    code,
    message: 'Document branding asset failed validation.',
  });
}

function isValidationError(error: unknown): boolean {
  return error instanceof UnprocessableEntityException;
}

function readErrorCode(error: unknown): string {
  if (error instanceof UnprocessableEntityException) {
    const response = error.getResponse();
    if (response && typeof response === 'object' && 'code' in response)
      return String(response.code);
  }
  return 'BRAND_ASSET_INVALID';
}

function isImageLimitError(error: unknown): boolean {
  return error instanceof Error && /pixel limit/i.test(error.message);
}
