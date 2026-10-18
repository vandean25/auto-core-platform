import { createHash } from 'node:crypto';
import type { DocumentBrandAsset } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { DecisionLiveApplyService } from '../decision/decision-live-apply.service.js';
import type { DecisionUseCaseHooksService } from '../decision/decision-use-case-hooks.service.js';
import type { RequestContextService } from '../common/services/request-context.service.js';
import type { DocumentBrandingAssetStorage } from './document-branding-asset-storage.js';
import type { DocumentBrandingPdfParser } from './document-branding-pdf-parser.js';
import { extractLoosePdfText } from '../decision/pdf-loose-text.util.js';
import {
  invalidBrandAsset,
  isBrandAssetValidationError,
  readBrandAssetValidationCode,
  validateBrandAssetBytes,
} from './document-branding-upload-validation.js';

const VALIDATION_LEASE_MS = 15 * 60 * 1000;

type PublishedGeneration = {
  bucket: string;
  objectKey: string;
  generation: string;
};

export async function runUploadWorkerValidation(params: {
  assetId: string;
  tenantId: string;
  current: DocumentBrandAsset;
  prisma: PrismaService;
  storage: DocumentBrandingAssetStorage;
  pdfParser: DocumentBrandingPdfParser;
  decisionHooks: DecisionUseCaseHooksService;
  requestContext: RequestContextService;
  decisionLive: DecisionLiveApplyService;
}): Promise<{ state: 'QUARANTINED' | 'READY' | 'REJECTED' }> {
  const {
    assetId,
    tenantId,
    current,
    prisma,
    storage,
    pdfParser,
    decisionHooks,
    requestContext,
    decisionLive,
  } = params;

  const now = new Date();
  const leaseUntil = new Date(now.getTime() + VALIDATION_LEASE_MS);
  const claimed = await prisma.documentBrandAsset.updateMany({
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
  if (claimed.count !== 1) return { state: 'QUARANTINED' };

  let published: PublishedGeneration | null = null;
  let previewPublished: PublishedGeneration | null = null;
  let readyPersisted = false;
  let documentSortText: string | null = null;
  try {
    if (
      !current.quarantine_bucket ||
      !current.quarantine_object_key ||
      !current.quarantine_object_generation
    ) {
      throw invalidBrandAsset('BRAND_ASSET_QUARANTINE_MISSING');
    }
    const original = await storage.readGeneration(
      current.quarantine_bucket,
      current.quarantine_object_key,
      current.quarantine_object_generation,
    );
    const validated = await validateBrandAssetBytes(
      pdfParser,
      current.purpose,
      current.detected_mime_type,
      original,
    );
    if (current.detected_mime_type === 'application/pdf') {
      const text = extractLoosePdfText(validated.bytes);
      if (await decisionLive.isLiveForTenant(tenantId)) {
        documentSortText = text;
      }
      if (
        documentSortText === null ||
        decisionHooks.classifyDocumentTextForOutcome(text) !== 'Sonstiges'
      ) {
        decisionHooks.scheduleDocumentSortForText({
          tenantId,
          traceId: requestContext.getTraceId(),
          text,
        });
      }
    }
    const rootKey = `tenants/${tenantId}/legal-entities/${current.legal_entity_id}/document-branding`;
    const extension =
      current.detected_mime_type === 'application/pdf' ? 'pdf' : 'png';
    const objectKey = `${rootKey}/assets/${assetId}.${extension}`;
    const stored = await storage.storeImmutable({
      objectKey,
      bytes: validated.bytes,
      contentType: current.detected_mime_type ?? 'application/octet-stream',
    });
    published = { ...stored, objectKey };
    if (validated.pagePreviewPng) {
      const previewObjectKey = `${rootKey}/assets/${assetId}-page1.png`;
      const previewStored = await storage.storeImmutable({
        objectKey: previewObjectKey,
        bytes: validated.pagePreviewPng,
        contentType: 'image/png',
      });
      previewPublished = { ...previewStored, objectKey: previewObjectKey };
    }
    const ready = await prisma.documentBrandAsset.updateMany({
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
        await deletePublishedGeneration(storage, previewPublished);
        previewPublished = null;
      }
      await deletePublishedGeneration(storage, published);
      published = null;
      return { state: 'QUARANTINED' };
    }
    readyPersisted = true;
    await storage.deleteGeneration(
      current.quarantine_bucket,
      current.quarantine_object_key,
      current.quarantine_object_generation,
    );
    if (documentSortText !== null) {
      await decisionLive.applyDocumentSortForAsset({
        tenantId,
        assetId,
        traceId: requestContext.getTraceId(),
        text: documentSortText,
      });
    }
    return { state: 'READY' };
  } catch (error) {
    if (previewPublished && !readyPersisted) {
      await deletePublishedGeneration(storage, previewPublished);
    }
    if (published && !readyPersisted) {
      await deletePublishedGeneration(storage, published);
    }
    if (readyPersisted) throw error;
    if (isBrandAssetValidationError(error)) {
      await prisma.documentBrandAsset.updateMany({
        where: {
          id: assetId,
          tenant_id: tenantId,
          validation_lease_until: leaseUntil,
        },
        data: {
          state: 'REJECTED',
          failure_code: readBrandAssetValidationCode(error),
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
          validation_dispatched_at: null,
          validation_lease_until: null,
        },
      });
      return { state: 'REJECTED' };
    }
    const exhausted = current.validation_attempt_count + 1 >= 3;
    await prisma.documentBrandAsset.updateMany({
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

async function deletePublishedGeneration(
  storage: DocumentBrandingAssetStorage,
  published: PublishedGeneration,
) {
  return storage.deleteGeneration(
    published.bucket,
    published.objectKey,
    published.generation,
  );
}
