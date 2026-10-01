import { NotFoundException, type Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import type { PdfStorage } from '../common/pdf/pdf-storage.js';
import type { CloudTasksService } from '../common/index.js';
import { enqueueOrGeneratePdf } from '../common/pdf/pdf-generation-dispatch.js';
import {
  renderAndUploadPdf,
  type PdfUploadResult,
} from '../common/pdf/pdf-render-upload.js';
import type { InvoicePdfRenderer } from './invoice-pdf.renderer.js';
import { readCachedPdfMetadata } from './invoice-pdf.generation.js';
import type { InvoiceSnapshot } from './invoice-snapshot.js';
import {
  isBrandedSnapshot,
  type InvoicePdfPrismaClient,
} from './invoice-pdf-branding.helpers.js';
import {
  buildArchiveIdentity,
  readArchiveFromMetadata,
  readArchiveMetadata,
  rethrowStorageNotFound,
  toErrorMessage,
  toPdfStreamResult,
  type PdfStreamResult,
} from './invoice-pdf-archive.helpers.js';

export * from './invoice-pdf-branding.helpers.js';
export * from './invoice-pdf-archive.helpers.js';

export type SafeStoreInvoiceGenerationErrorParams = {
  prisma: InvoicePdfPrismaClient;
  logger: { error: (msg: string, stack?: string) => void };
  invoiceId: string;
  tenantId: string;
  message: string;
};

export type PersistInvoiceGeneratedPdfParams = {
  prisma: InvoicePdfPrismaClient;
  invoiceId: string;
  tenantId: string;
  upload: { bucket: string; key: string };
  generatedAt: Date;
};

export type BackfillInvoicePdfMetadataParams = {
  prisma: InvoicePdfPrismaClient;
  logger: { warn: (msg: string) => void };
  invoiceId: string;
  tenantId: string;
  bucket: string;
  key: string;
};

export type UploadInvoicePdfParams = {
  storage: PdfStorage;
  renderer: InvoicePdfRenderer;
  snapshot: InvoiceSnapshot;
  key: string;
  onRetry: (error: unknown, attempt: number) => void;
};

export type FetchFallbackPdfStreamParams = {
  storage: PdfStorage;
  prisma: InvoicePdfPrismaClient;
  logger: { warn: (msg: string) => void };
  invoiceId: string;
  tenantId: string;
  filename: string;
};

export async function clearInvoiceGenerationError(
  prisma: InvoicePdfPrismaClient,
  invoiceId: string,
  tenantId: string,
): Promise<void> {
  await prisma.client.invoice.updateMany({
    where: { id: invoiceId, tenant_id: tenantId },
    data: { pdf_generation_error: null },
  });
}

export async function safeStoreInvoiceGenerationError(
  ...args:
    | [params: SafeStoreInvoiceGenerationErrorParams]
    | [
        prisma: InvoicePdfPrismaClient,
        logger: { error: (msg: string, stack?: string) => void },
        invoiceId: string,
        tenantId: string,
        message: string,
      ]
): Promise<void> {
  const params: SafeStoreInvoiceGenerationErrorParams =
    args.length === 1
      ? args[0]
      : {
          prisma: args[0],
          logger: args[1],
          invoiceId: args[2],
          tenantId: args[3],
          message: args[4],
        };

  try {
    const trimmedError = params.message.slice(0, 2000);
    await params.prisma.client.invoice.updateMany({
      where: { id: params.invoiceId, tenant_id: params.tenantId },
      data: { pdf_generation_error: trimmedError },
    });
  } catch (error) {
    const errMessage = toErrorMessage(error);
    params.logger.error(
      `Failed to store invoice PDF generation error (invoiceId=${params.invoiceId}): ${errMessage}`,
      error instanceof Error ? error.stack : undefined,
    );
  }
}

export async function persistInvoiceGeneratedPdf(
  ...args:
    | [params: PersistInvoiceGeneratedPdfParams]
    | [
        prisma: InvoicePdfPrismaClient,
        invoiceId: string,
        tenantId: string,
        upload: { bucket: string; key: string },
        generatedAt: Date,
      ]
): Promise<void> {
  const params: PersistInvoiceGeneratedPdfParams =
    args.length === 1
      ? args[0]
      : {
          prisma: args[0],
          invoiceId: args[1],
          tenantId: args[2],
          upload: args[3],
          generatedAt: args[4],
        };

  const updated = await params.prisma.client.invoice.updateMany({
    where: { id: params.invoiceId, tenant_id: params.tenantId },
    data: {
      pdf_storage_key: params.upload.key,
      pdf_storage_bucket: params.upload.bucket,
      pdf_generation_error: null,
      pdf_generated_at: params.generatedAt,
    },
  });

  if (updated.count === 0) {
    throw new NotFoundException(
      `Invoice ${params.invoiceId} was not found for PDF metadata persistence`,
    );
  }
}

export async function backfillInvoicePdfMetadata(
  ...args:
    | [params: BackfillInvoicePdfMetadataParams]
    | [
        prisma: InvoicePdfPrismaClient,
        logger: { warn: (msg: string) => void },
        invoiceId: string,
        tenantId: string,
        bucket: string,
        key: string,
      ]
): Promise<void> {
  const params: BackfillInvoicePdfMetadataParams =
    args.length === 1
      ? args[0]
      : {
          prisma: args[0],
          logger: args[1],
          invoiceId: args[2],
          tenantId: args[3],
          bucket: args[4],
          key: args[5],
        };

  try {
    const generatedAt = new Date();
    await persistInvoiceGeneratedPdf({
      prisma: params.prisma,
      invoiceId: params.invoiceId,
      tenantId: params.tenantId,
      upload: { bucket: params.bucket, key: params.key },
      generatedAt,
    });
  } catch (error) {
    const message = toErrorMessage(error);
    params.logger.warn(
      `Failed to backfill invoice PDF metadata (invoiceId=${params.invoiceId}): ${message}`,
    );
  }
}

export async function uploadInvoicePdf(
  ...args:
    | [params: UploadInvoicePdfParams]
    | [
        storage: PdfStorage,
        renderer: InvoicePdfRenderer,
        snapshot: InvoiceSnapshot,
        key: string,
        onRetry: (error: unknown, attempt: number) => void,
      ]
): Promise<PdfUploadResult> {
  const params: UploadInvoicePdfParams =
    args.length === 1
      ? args[0]
      : {
          storage: args[0],
          renderer: args[1],
          snapshot: args[2],
          key: args[3],
          onRetry: args[4],
        };

  return renderAndUploadPdf({
    render: async () => params.renderer.render(params.snapshot),
    upload: async (buffer) =>
      params.storage.uploadPdf({
        key: params.key,
        body: buffer,
        contentType: 'application/pdf',
      }),
    onRetry: params.onRetry,
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
  prisma: InvoicePdfPrismaClient,
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

function extractGeneratedResult(outcome: {
  result?: {
    bucket: string | null;
    key: string | null;
    generatedAt: Date | null;
  };
  bucket?: string | null;
  key?: string | null;
  generatedAt?: Date | null;
}) {
  return 'result' in outcome && outcome.result ? outcome.result : outcome;
}

export function formatRequestGenerationOutcome(
  outcome:
    | { mode: 'enqueued'; taskId?: string }
    | {
        mode: 'generated';
        result?: {
          bucket: string | null;
          key: string | null;
          generatedAt: Date | null;
        };
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
  const result = extractGeneratedResult(outcome);
  const bucket = isBranded ? null : (result.bucket ?? null);
  const key = isBranded ? null : (result.key ?? null);
  const generatedAt = result.generatedAt ?? null;
  return {
    mode: 'generated' as const,
    invoiceId,
    bucket,
    key,
    generatedAt,
  };
}

export async function executeStandardPdfGeneration(params: {
  invoiceId: string;
  tenantId: string;
  snapshot: InvoiceSnapshot;
  storage: PdfStorage;
  renderer: InvoicePdfRenderer;
  prisma: InvoicePdfPrismaClient;
  onRetry: (error: unknown, attempt: number) => void;
}): Promise<{
  invoiceId: string;
  bucket: string;
  key: string;
  generatedAt: Date;
}> {
  const destinationKey = `invoices/${params.invoiceId}.pdf`;
  const uploadResult = await uploadInvoicePdf({
    storage: params.storage,
    renderer: params.renderer,
    snapshot: params.snapshot,
    key: destinationKey,
    onRetry: params.onRetry,
  });
  const timestamp = new Date();
  await persistInvoiceGeneratedPdf({
    prisma: params.prisma,
    invoiceId: params.invoiceId,
    tenantId: params.tenantId,
    upload: uploadResult,
    generatedAt: timestamp,
  });
  return {
    invoiceId: params.invoiceId,
    bucket: uploadResult.bucket,
    key: uploadResult.key,
    generatedAt: timestamp,
  };
}

async function queryInvoiceWithSiteScope(
  prisma: InvoicePdfPrismaClient,
  params: {
    invoiceId: string;
    tenantId: string;
    authorizedSiteIds: string[];
    includeInvoiceNumber?: boolean;
  },
) {
  const invoice = await prisma.client.invoice.findFirst({
    where: {
      id: params.invoiceId,
      tenant_id: params.tenantId,
      site_id: { in: params.authorizedSiteIds },
    },
    select: {
      id: true,
      status: true,
      invoice_number: params.includeInvoiceNumber ? true : false,
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

export async function fetchInvoiceForRequest(
  prisma: InvoicePdfPrismaClient,
  invoiceId: string,
  tenantId: string,
  authorizedSiteIds: string[],
) {
  return queryInvoiceWithSiteScope(prisma, {
    invoiceId,
    tenantId,
    authorizedSiteIds,
    includeInvoiceNumber: false,
  });
}

export async function fetchInvoiceForPdfGet(
  prisma: InvoicePdfPrismaClient,
  invoiceId: string,
  tenantId: string,
  authorizedSiteIds: string[],
) {
  return queryInvoiceWithSiteScope(prisma, {
    invoiceId,
    tenantId,
    authorizedSiteIds,
    includeInvoiceNumber: true,
  });
}

export async function handleInvoicePdfError(
  logger: Logger,
  prisma: InvoicePdfPrismaClient,
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
  await safeStoreInvoiceGenerationError({
    prisma,
    logger,
    invoiceId,
    tenantId,
    message,
  });
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

  if (branded) {
    return null;
  }

  const cachedPdf = readCachedPdfMetadata(invoice);
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

  if (branded) {
    return null;
  }

  const cachedPdf = readCachedPdfMetadata(invoice);
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
): Promise<PdfStreamResult> {
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
  ...args:
    | [params: FetchFallbackPdfStreamParams]
    | [
        storage: PdfStorage,
        prisma: InvoicePdfPrismaClient,
        logger: { warn: (msg: string) => void },
        invoiceId: string,
        tenantId: string,
        filename: string,
      ]
): Promise<PdfStreamResult> {
  const params: FetchFallbackPdfStreamParams =
    args.length === 1
      ? args[0]
      : {
          storage: args[0],
          prisma: args[1],
          logger: args[2],
          invoiceId: args[3],
          tenantId: args[4],
          filename: args[5],
        };

  const fallbackKey = `invoices/${params.invoiceId}.pdf`;
  let pdf: Awaited<ReturnType<PdfStorage['getPdfStream']>>;
  try {
    pdf = await params.storage.getPdfStream({ key: fallbackKey });
  } catch (error) {
    rethrowStorageNotFound(error);
  }

  await backfillInvoicePdfMetadata({
    prisma: params.prisma,
    logger: params.logger,
    invoiceId: params.invoiceId,
    tenantId: params.tenantId,
    bucket: pdf.bucket,
    key: pdf.key,
  });

  return toPdfStreamResult(pdf, params.filename);
}
