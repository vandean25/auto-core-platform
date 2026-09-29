import { createHash } from 'node:crypto';
import { NotFoundException, UnprocessableEntityException, type Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import type {
  ImmutablePdfArchive,
  PdfArchiveIdentityMetadata,
  PdfStorage,
} from '../common/pdf/pdf-storage.js';
import type { CloudTasksService } from '../common/index.js';
import { enqueueOrGeneratePdf } from '../common/pdf/pdf-generation-dispatch.js';
import {
  renderAndUploadPdf,
  type PdfUploadResult,
} from '../common/pdf/pdf-render-upload.js';
import type { InvoicePdfRenderer } from './invoice-pdf.renderer.js';
import { INVOICE_BRANDED_TEMPLATE_VERSION } from './invoice-snapshot-v2.js';
import { hashInvoiceSnapshot } from './invoice-snapshot-hash.js';
import { readCachedPdfMetadata } from './invoice-pdf.generation.js';
import { resolvePdfStorageBucket } from '../common/pdf/pdf-bucket.js';
import type { InvoiceSnapshot } from './invoice-snapshot.js';
import type { Readable } from 'node:stream';

export type InvoicePdfRequestGenerationResponse = {
  mode: 'cached' | 'enqueued' | 'generated';
  invoiceId: string;
  bucket: string | null;
  key: string | null;
  generatedAt: Date | null;
  taskId?: string;
};

export type PdfStreamResult = {
  filename: string;
  contentType: string;
  contentLength: number | null;
  stream: Readable;
};

export type ArchiveMetadata = {
  bucket: string;
  key: string;
  generation: string;
  sha256: string;
};

export type AssetMetadata = {
  bucket: string;
  object_key: string;
  object_generation: string;
  sha256: string;
  detected_mime_type: string;
  pixel_width: number;
  pixel_height: number;
};

export type InvoiceBrandingLogo = {
  asset_id: string;
  bucket: string;
  key: string;
  generation: string;
  sha256: string;
  mime_type: string;
  width: number;
  height: number;
};

export function brandRenderInputUnavailable(
  message = 'Frozen branding or archive evidence is unavailable.',
): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'BRAND_RENDER_INPUT_UNAVAILABLE',
    message,
  });
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function rethrowStorageNotFound(error: unknown): never {
  if (error instanceof NotFoundException) {
    throw new NotFoundException('Invoice PDF is not generated yet');
  }
  throw error;
}

export function isBrandedSnapshot(
  snapshot: unknown,
): snapshot is InvoiceSnapshot {
  return (
    typeof snapshot === 'object' &&
    snapshot !== null &&
    'template_version' in snapshot &&
    (snapshot as { template_version: unknown }).template_version ===
      INVOICE_BRANDED_TEMPLATE_VERSION
  );
}

export function readArchiveMetadata(invoice: {
  pdf_archive_bucket: string | null;
  pdf_archive_key: string | null;
  pdf_archive_generation: string | null;
  pdf_archive_sha256: string | null;
}): ArchiveMetadata | null {
  const values = [
    invoice.pdf_archive_bucket,
    invoice.pdf_archive_key,
    invoice.pdf_archive_generation,
    invoice.pdf_archive_sha256,
  ];
  if (values.every((value) => value === null || value === undefined)) {
    return null;
  }
  if (
    values.some((value) => typeof value !== 'string' || value.length === 0) ||
    !/^[a-f0-9]{64}$/.test(invoice.pdf_archive_sha256 ?? '')
  ) {
    throw brandRenderInputUnavailable(
      'Immutable invoice archive metadata is incomplete.',
    );
  }
  return {
    bucket: invoice.pdf_archive_bucket!,
    key: invoice.pdf_archive_key!,
    generation: invoice.pdf_archive_generation!,
    sha256: invoice.pdf_archive_sha256!,
  };
}

export function buildArchiveIdentity(
  tenantId: string,
  invoiceId: string,
  snapshot: unknown,
): PdfArchiveIdentityMetadata {
  if (!isBrandedSnapshot(snapshot)) {
    throw brandRenderInputUnavailable(
      'Branded archive requires an invoice-brand-v1 snapshot.',
    );
  }
  return {
    tenant_id: tenantId,
    invoice_id: invoiceId,
    snapshot_sha256: hashInvoiceSnapshot(snapshot),
    template_version: INVOICE_BRANDED_TEMPLATE_VERSION,
  };
}

export function buildArchiveKey(identity: PdfArchiveIdentityMetadata): string {
  return `invoice-archives/${identity.tenant_id}/${identity.invoice_id}/${identity.snapshot_sha256}/${identity.template_version}.pdf`;
}

export function sameArchiveIdentity(
  actual: PdfArchiveIdentityMetadata,
  expected: PdfArchiveIdentityMetadata,
): boolean {
  return (
    actual.tenant_id === expected.tenant_id &&
    actual.invoice_id === expected.invoice_id &&
    actual.snapshot_sha256 === expected.snapshot_sha256 &&
    actual.template_version === expected.template_version
  );
}

export function getErrorCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const { code } = error as { code: unknown };
  if (typeof code === 'number') return code;
  if (typeof code === 'string') {
    const parsed = Number(code);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function verifyFrozenAssetMetadata(
  asset: AssetMetadata | null | undefined,
  logo: InvoiceBrandingLogo,
): boolean {
  if (!asset) return false;
  return (
    asset.bucket === logo.bucket &&
    asset.object_key === logo.key &&
    asset.object_generation === logo.generation &&
    asset.sha256 === logo.sha256 &&
    asset.detected_mime_type === logo.mime_type &&
    asset.pixel_width === logo.width &&
    asset.pixel_height === logo.height
  );
}

export function verifyFrozenLogoHash(
  bytes: Buffer,
  expectedSha256: string,
): boolean {
  return createHash('sha256').update(bytes).digest('hex') === expectedSha256;
}

export async function readArchiveFromMetadata(
  storage: PdfStorage,
  metadata: ArchiveMetadata,
  expectedIdentity: PdfArchiveIdentityMetadata,
): Promise<ImmutablePdfArchive & { body: Buffer }> {
  const expectedKey = buildArchiveKey(expectedIdentity);
  if (metadata.key !== expectedKey) {
    throw brandRenderInputUnavailable();
  }
  const archive = await storage.readImmutablePdfGeneration({
    bucket: metadata.bucket,
    key: metadata.key,
    generation: metadata.generation,
    expectedSha256: metadata.sha256,
  });
  if (!sameArchiveIdentity(archive.customMetadata, expectedIdentity)) {
    throw brandRenderInputUnavailable();
  }
  return archive;
}

export async function streamStoredPdf(
  storage: PdfStorage,
  location: { bucket?: string | null; key: string },
  filename: string,
): Promise<{
  filename: string;
  contentType: string;
  contentLength: number | null;
  stream: import('node:stream').Readable;
}> {
  const result = await storage.getPdfStream({
    bucket: location.bucket ?? undefined,
    key: location.key,
  });
  return {
    filename,
    contentType: result.contentType ?? 'application/pdf',
    contentLength: result.contentLength,
    stream: result.stream,
  };
}

export async function clearInvoiceGenerationError(
  prisma: { client: { invoice: { updateMany: (args: unknown) => Promise<unknown> } } },
  invoiceId: string,
  tenantId: string,
): Promise<void> {
  await prisma.client.invoice.updateMany({
    where: { id: invoiceId, tenant_id: tenantId },
    data: { pdf_generation_error: null },
  });
}

export async function safeStoreInvoiceGenerationError(
  prisma: { client: { invoice: { updateMany: (args: unknown) => Promise<unknown> } } },
  logger: { error: (msg: string, stack?: string) => void },
  invoiceId: string,
  tenantId: string,
  message: string,
): Promise<void> {
  try {
    const trimmedError = message.slice(0, 2000);
    await prisma.client.invoice.updateMany({
      where: { id: invoiceId, tenant_id: tenantId },
      data: { pdf_generation_error: trimmedError },
    });
  } catch (error) {
    const errMessage = toErrorMessage(error);
    logger.error(
      `Failed to store invoice PDF generation error (invoiceId=${invoiceId}): ${errMessage}`,
      error instanceof Error ? error.stack : undefined,
    );
  }
}

export async function persistInvoiceGeneratedPdf(
  prisma: { client: { invoice: { updateMany: (args: unknown) => Promise<{ count: number }> } } },
  invoiceId: string,
  tenantId: string,
  upload: { bucket: string; key: string },
  generatedAt: Date,
): Promise<void> {
  const updated = await prisma.client.invoice.updateMany({
    where: { id: invoiceId, tenant_id: tenantId },
    data: {
      pdf_storage_key: upload.key,
      pdf_storage_bucket: upload.bucket,
      pdf_generation_error: null,
      pdf_generated_at: generatedAt,
    },
  });

  if (updated.count === 0) {
    throw new NotFoundException(
      `Invoice ${invoiceId} was not found for PDF metadata persistence`,
    );
  }
}

export async function backfillInvoicePdfMetadata(
  prisma: { client: { invoice: { updateMany: (args: unknown) => Promise<{ count: number }> } } },
  logger: { warn: (msg: string) => void },
  invoiceId: string,
  tenantId: string,
  bucket: string,
  key: string,
): Promise<void> {
  try {
    const generatedAt = new Date();
    await persistInvoiceGeneratedPdf(
      prisma,
      invoiceId,
      tenantId,
      { bucket, key },
      generatedAt,
    );
  } catch (error) {
    const message = toErrorMessage(error);
    logger.warn(
      `Failed to backfill invoice PDF metadata (invoiceId=${invoiceId}): ${message}`,
    );
  }
}

export async function uploadInvoicePdf(
  storage: PdfStorage,
  renderer: InvoicePdfRenderer,
  snapshot: InvoiceSnapshot,
  key: string,
  onRetry: (error: unknown, attempt: number) => void,
): Promise<PdfUploadResult> {
  return renderAndUploadPdf({
    render: async () => renderer.render(snapshot),
    upload: async (buffer) =>
      storage.uploadPdf({
        key,
        body: buffer,
        contentType: 'application/pdf',
      }),
    onRetry,
  });
}

export async function dispatchInvoiceGeneration<TGeneratedResult>(params: {
  invoiceId: string;
  tenantId: string;
  targetBaseUrl: string;
  cloudTasks: CloudTasksService;
  logger: Logger;
  clearError: () => Promise<void>;
  generateInline: () => Promise<TGeneratedResult>;
  storeEnqueueError: (msg: string) => Promise<void>;
  onEnqueueError: (error: unknown) => void;
}) {
  return enqueueOrGeneratePdf({
    kind: 'invoice',
    resourceId: params.invoiceId,
    resourceName: 'invoice',
    tenantId: params.tenantId,
    targetBaseUrl: params.targetBaseUrl,
    cloudTasks: params.cloudTasks,
    nodeEnv: process.env.NODE_ENV,
    logger: params.logger,
    clearError: params.clearError,
    generateInline: params.generateInline,
    storeEnqueueError: params.storeEnqueueError,
    onEnqueueError: params.onEnqueueError,
  });
}

export async function fetchInvoiceForGeneration(
  prisma: {
    client: {
      invoice: {
        findFirst: (args: unknown) => Promise<any>;
      };
    };
  },
  invoiceId: string,
  tenantId: string,
) {
  const invoice = await prisma.client.invoice.findFirst({
    where: { id: invoiceId, tenant_id: tenantId },
    select: {
      id: true,
      tenant_id: true,
      invoice_number: true,
      status: true,
      snapshot: true,
      pdf_storage_bucket: true,
      pdf_storage_key: true,
      pdf_generated_at: true,
      pdf_archive_bucket: true,
      pdf_archive_key: true,
      pdf_archive_generation: true,
      pdf_archive_sha256: true,
      customer_id: true,
      workshop_order_id: true,
      legal_entity_id: true,
    },
  });

  if (!invoice) {
    throw new NotFoundException('Invoice not found');
  }

  return invoice;
}

export function formatRequestGenerationOutcome(
  outcome:
    | { mode: 'enqueued'; taskId?: string }
    | {
        mode: 'generated';
        result?: { bucket: string | null; key: string | null; generatedAt: Date | null };
        bucket?: string | null;
        key?: string | null;
        generatedAt?: Date | null;
      },
  invoiceId: string,
  isBranded = false,
) {
  if (outcome.mode === 'enqueued') {
    return {
      mode: 'enqueued' as const,
      invoiceId,
      bucket: null,
      key: null,
      generatedAt: null,
      taskId: outcome.taskId,
    };
  }
  const result = 'result' in outcome && outcome.result ? outcome.result : outcome;
  if (isBranded) {
    return {
      mode: 'generated' as const,
      invoiceId,
      bucket: null,
      key: null,
      generatedAt: result.generatedAt ?? null,
    };
  }
  return {
    mode: 'generated' as const,
    invoiceId,
    bucket: result.bucket ?? null,
    key: result.key ?? null,
    generatedAt: result.generatedAt ?? null,
  };
}

export async function executeStandardPdfGeneration(params: {
  invoiceId: string;
  tenantId: string;
  snapshot: InvoiceSnapshot;
  storage: PdfStorage;
  renderer: InvoicePdfRenderer;
  prisma: { client: { invoice: { updateMany: (args: unknown) => Promise<{ count: number }> } } };
  onRetry: (error: unknown, attempt: number) => void;
}): Promise<{
  invoiceId: string;
  bucket: string;
  key: string;
  generatedAt: Date;
}> {
  const destinationKey = `invoices/${params.invoiceId}.pdf`;
  const uploadResult = await uploadInvoicePdf(
    params.storage,
    params.renderer,
    params.snapshot,
    destinationKey,
    params.onRetry,
  );
  const timestamp = new Date();
  await persistInvoiceGeneratedPdf(
    params.prisma,
    params.invoiceId,
    params.tenantId,
    uploadResult,
    timestamp,
  );
  return {
    invoiceId: params.invoiceId,
    bucket: uploadResult.bucket,
    key: uploadResult.key,
    generatedAt: timestamp,
  };
}

export function toPdfStreamResult(
  pdf: {
    bucket?: string | null;
    key?: string | null;
    contentType?: string | null;
    contentLength: number | null;
    stream: import('node:stream').Readable;
  },
  filename: string,
) {
  return {
    filename,
    contentType: pdf.contentType ?? 'application/pdf',
    contentLength: pdf.contentLength,
    stream: pdf.stream,
  };
}

export async function fetchInvoiceForRequest(
  prisma: {
    client: {
      invoice: {
        findFirst: (args: unknown) => Promise<any>;
      };
    };
  },
  invoiceId: string,
  tenantId: string,
  authorizedSiteIds: string[],
) {
  const invoice = await prisma.client.invoice.findFirst({
    where: {
      id: invoiceId,
      tenant_id: tenantId,
      site_id: { in: authorizedSiteIds },
    },
    select: {
      id: true,
      status: true,
      pdf_storage_bucket: true,
      pdf_storage_key: true,
      pdf_generated_at: true,
      snapshot: true,
      pdf_archive_bucket: true,
      pdf_archive_key: true,
      pdf_archive_generation: true,
      pdf_archive_sha256: true,
    },
  });

  if (!invoice) {
    throw new NotFoundException('Invoice not found');
  }

  return invoice;
}

export async function fetchInvoiceForPdfGet(
  prisma: {
    client: {
      invoice: {
        findFirst: (args: unknown) => Promise<any>;
      };
    };
  },
  invoiceId: string,
  tenantId: string,
  authorizedSiteIds: string[],
) {
  const invoice = await prisma.client.invoice.findFirst({
    where: {
      id: invoiceId,
      tenant_id: tenantId,
      site_id: { in: authorizedSiteIds },
    },
    select: {
      id: true,
      invoice_number: true,
      pdf_storage_bucket: true,
      pdf_storage_key: true,
      pdf_generated_at: true,
      snapshot: true,
      pdf_archive_bucket: true,
      pdf_archive_key: true,
      pdf_archive_generation: true,
      pdf_archive_sha256: true,
    },
  });

  if (!invoice) {
    throw new NotFoundException('Invoice not found');
  }

  return invoice;
}

export async function handleInvoicePdfError(
  logger: Logger,
  prisma: { client: { invoice: { updateMany: (args: unknown) => Promise<unknown> } } },
  params: {
    invoiceId: string;
    tenantId: string;
    customerId: string;
    workshopOrderId: string | null;
    error: unknown;
  },
): Promise<void> {
  const { invoiceId, tenantId, customerId, workshopOrderId, error } = params;
  const message = toErrorMessage(error);
  const stack = error instanceof Error ? error.stack : undefined;
  logger.error(
    `Invoice PDF generation exhausted all retries (invoiceId=${invoiceId}): ${message}`,
    stack,
  );
  Sentry.captureException(error, {
    tags: {
      invoiceId,
      customerId,
      ...(workshopOrderId ? { workshopOrderId } : {}),
    },
  });
  await safeStoreInvoiceGenerationError(prisma, logger, invoiceId, tenantId, message);
}

export async function resolveInvoiceCachedRequest(
  storage: PdfStorage,
  invoice: {
    id: string;
    pdf_storage_bucket: string | null;
    pdf_storage_key: string | null;
    pdf_generated_at: Date | null;
    snapshot: unknown;
    pdf_archive_bucket: string | null;
    pdf_archive_key: string | null;
    pdf_archive_generation: string | null;
    pdf_archive_sha256: string | null;
  },
  tenantId: string,
): Promise<{
  mode: 'cached';
  invoiceId: string;
  bucket: string | null;
  key: string | null;
  generatedAt: Date | null;
} | null> {
  const branded = isBrandedSnapshot(invoice.snapshot);
  const brandedArchive = readArchiveMetadata(invoice);
  if (branded && brandedArchive) {
    await readArchiveFromMetadata(
      storage,
      brandedArchive,
      buildArchiveIdentity(tenantId, invoice.id, invoice.snapshot),
    );
    return {
      mode: 'cached',
      invoiceId: invoice.id,
      bucket: null,
      key: null,
      generatedAt: invoice.pdf_generated_at,
    };
  }

  const cachedPdf = branded ? null : readCachedPdfMetadata(invoice);
  if (cachedPdf) {
    return {
      mode: 'cached',
      invoiceId: invoice.id,
      bucket: cachedPdf.bucket,
      key: cachedPdf.key,
      generatedAt: cachedPdf.generatedAt,
    };
  }

  return null;
}

export async function resolveInvoiceCachedGenerateNow(
  storage: PdfStorage,
  invoice: {
    id: string;
    snapshot: unknown;
    pdf_archive_bucket: string | null;
    pdf_archive_key: string | null;
    pdf_archive_generation: string | null;
    pdf_archive_sha256: string | null;
    pdf_storage_bucket: string | null;
    pdf_storage_key: string | null;
    pdf_generated_at: Date | null;
  },
  tenantId: string,
  onCacheHit?: (cached: { bucket: string; key: string }) => void,
): Promise<{
  invoiceId: string;
  bucket: string;
  key: string;
  generatedAt: Date;
} | null> {
  const branded = isBrandedSnapshot(invoice.snapshot);
  const archiveMetadata = readArchiveMetadata(invoice);
  if (branded && archiveMetadata) {
    const archive = await readArchiveFromMetadata(
      storage,
      archiveMetadata,
      buildArchiveIdentity(tenantId, invoice.id, invoice.snapshot),
    );
    return {
      invoiceId: invoice.id,
      bucket: archive.bucket,
      key: archive.key,
      generatedAt: invoice.pdf_generated_at ?? new Date(),
    };
  }

  const cachedPdf = branded ? null : readCachedPdfMetadata(invoice);
  if (cachedPdf) {
    onCacheHit?.(cachedPdf);
    return {
      invoiceId: invoice.id,
      bucket: cachedPdf.bucket,
      key: cachedPdf.key,
      generatedAt: cachedPdf.generatedAt,
    };
  }

  return null;
}

export async function fetchBrandedPdfStream(
  storage: PdfStorage,
  invoice: {
    id: string;
    snapshot: unknown;
    pdf_archive_bucket: string | null;
    pdf_archive_key: string | null;
    pdf_archive_generation: string | null;
    pdf_archive_sha256: string | null;
  },
  tenantId: string,
  filename: string,
) {
  const archiveMetadata = readArchiveMetadata(invoice);
  if (!archiveMetadata) {
    throw new NotFoundException('Invoice PDF archive is not generated yet');
  }
  const archive = await readArchiveFromMetadata(
    storage,
    archiveMetadata,
    buildArchiveIdentity(tenantId, invoice.id, invoice.snapshot),
  );
  return {
    filename,
    contentType: 'application/pdf',
    contentLength: archive.body.length,
    stream: (await import('node:stream')).Readable.from([archive.body]),
  };
}

export async function fetchFallbackPdfStream(
  storage: PdfStorage,
  prisma: { client: { invoice: { updateMany: (args: unknown) => Promise<{ count: number }> } } },
  logger: { warn: (msg: string) => void },
  invoiceId: string,
  tenantId: string,
  filename: string,
) {
  const fallbackKey = `invoices/${invoiceId}.pdf`;
  let pdf: Awaited<ReturnType<PdfStorage['getPdfStream']>>;
  try {
    pdf = await storage.getPdfStream({ key: fallbackKey });
  } catch (error) {
    rethrowStorageNotFound(error);
  }

  await backfillInvoicePdfMetadata(
    prisma,
    logger,
    invoiceId,
    tenantId,
    pdf.bucket,
    pdf.key,
  );

  return toPdfStreamResult(pdf, filename);
}

export async function adoptOrPublishImmutablePdf(
  storage: PdfStorage,
  key: string,
  pdf: Buffer,
  identity: PdfArchiveIdentityMetadata,
): Promise<ImmutablePdfArchive> {
  try {
    return await storage.publishImmutablePdf({
      key,
      body: pdf,
      contentType: 'application/pdf',
      customMetadata: identity,
    });
  } catch (error) {
    if (getErrorCode(error) === 412) {
      return await storage.readImmutablePdfByKey({
        bucket: resolvePdfStorageBucket(),
        key,
        expectedIdentity: identity,
      });
    }
    throw error;
  }
}

export async function persistBrandedArchiveMetadata(
  prisma: {
    client: {
      invoice: {
        updateMany: (args: unknown) => Promise<{ count: number }>;
        findFirst: (args: unknown) => Promise<any>;
      };
    };
  },
  invoiceId: string,
  tenantId: string,
  archive: ImmutablePdfArchive,
  generatedAt: Date,
): Promise<void> {
  const persisted = await prisma.client.invoice.updateMany({
    where: {
      id: invoiceId,
      tenant_id: tenantId,
      pdf_archive_bucket: null,
      pdf_archive_key: null,
      pdf_archive_generation: null,
      pdf_archive_sha256: null,
    },
    data: {
      pdf_archive_bucket: archive.bucket,
      pdf_archive_key: archive.key,
      pdf_archive_generation: archive.generation,
      pdf_archive_sha256: archive.sha256,
      pdf_generated_at: generatedAt,
      pdf_generation_error: null,
    },
  });

  if (persisted.count === 1) return;

  const existing = await prisma.client.invoice.findFirst({
    where: { id: invoiceId, tenant_id: tenantId },
    select: {
      pdf_archive_bucket: true,
      pdf_archive_key: true,
      pdf_archive_generation: true,
      pdf_archive_sha256: true,
    },
  });

  const isMatch =
    existing?.pdf_archive_bucket === archive.bucket &&
    existing?.pdf_archive_key === archive.key &&
    existing?.pdf_archive_generation === archive.generation &&
    existing?.pdf_archive_sha256 === archive.sha256;

  if (!isMatch) {
    throw brandRenderInputUnavailable(
      'Immutable invoice archive metadata could not be persisted.',
    );
  }
}

export async function loadFrozenLogo(
  prisma: {
    client: {
      invoiceBrandAssetReference: {
        findFirst: (args: unknown) => Promise<any>;
      };
    };
  },
  brandingStorage: { readGeneration: (bucket: string, key: string, gen: string) => Promise<Buffer> } | undefined,
  invoice: {
    id: string;
    tenant_id: string;
    legal_entity_id: string | null;
  },
  snapshot: InvoiceSnapshot,
): Promise<Buffer | undefined> {
  const logo = snapshot.branding?.logo;
  if (!logo) return undefined;
  if (!invoice.legal_entity_id || !brandingStorage) {
    throw brandRenderInputUnavailable();
  }

  const reference =
    await prisma.client.invoiceBrandAssetReference.findFirst({
      where: {
        tenant_id: invoice.tenant_id,
        legal_entity_id: invoice.legal_entity_id,
        invoice_id: invoice.id,
        asset_id: logo.asset_id,
      },
      select: {
        asset: {
          select: {
            bucket: true,
            object_key: true,
            object_generation: true,
            sha256: true,
            detected_mime_type: true,
            pixel_width: true,
            pixel_height: true,
          },
        },
      },
    });

  if (!verifyFrozenAssetMetadata(reference?.asset, logo)) {
    throw brandRenderInputUnavailable();
  }

  const bytes = await brandingStorage.readGeneration(
    logo.bucket,
    logo.key,
    logo.generation,
  );
  if (!verifyFrozenLogoHash(bytes, logo.sha256)) {
    throw brandRenderInputUnavailable();
  }
  return bytes;
}







