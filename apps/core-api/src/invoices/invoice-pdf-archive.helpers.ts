import type { Readable } from 'node:stream';
import { NotFoundException } from '@nestjs/common';
import type {
  ImmutablePdfArchive,
  PdfArchiveIdentityMetadata,
  PdfStorage,
} from '../common/pdf/pdf-storage.js';
import { resolvePdfStorageBucket } from '../common/pdf/pdf-bucket.js';
import { INVOICE_BRANDED_TEMPLATE_VERSION } from './invoice-snapshot-v2.js';
import { hashInvoiceSnapshot } from './invoice-snapshot-hash.js';
import {
  brandRenderInputUnavailable,
  isBrandedSnapshot,
  type InvoicePdfPrismaClient,
} from './invoice-pdf-branding.helpers.js';

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

export type PersistBrandedArchiveMetadataParams = {
  prisma: InvoicePdfPrismaClient;
  invoiceId: string;
  tenantId: string;
  archive: ImmutablePdfArchive;
  generatedAt: Date;
};

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function rethrowStorageNotFound(error: unknown): never {
  if (error instanceof NotFoundException) {
    throw new NotFoundException('Invoice PDF is not generated yet');
  }
  throw error;
}

export function toPdfStreamResult(
  pdf: {
    bucket?: string | null;
    key?: string | null;
    contentType?: string | null;
    contentLength: number | null;
    stream: Readable;
  },
  filename: string,
): PdfStreamResult {
  return {
    filename,
    contentType: pdf.contentType ?? 'application/pdf',
    contentLength: pdf.contentLength,
    stream: pdf.stream,
  };
}

function isBlankString(value: unknown): boolean {
  return typeof value !== 'string' || value.length === 0;
}

function isValidSha256(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
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
  if (values.every((val) => val === null || val === undefined)) {
    return null;
  }
  if (
    values.some(isBlankString) ||
    !isValidSha256(invoice.pdf_archive_sha256)
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
  const checks: [unknown, unknown][] = [
    [actual.tenant_id, expected.tenant_id],
    [actual.invoice_id, expected.invoice_id],
    [actual.snapshot_sha256, expected.snapshot_sha256],
    [actual.template_version, expected.template_version],
  ];
  return checks.every(([a, b]) => a === b);
}

export function getErrorCode(error: unknown): number | undefined {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code === 'number') return code;
  if (typeof code === 'string') {
    const parsed = Number(code);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
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
): Promise<PdfStreamResult> {
  const result = await storage.getPdfStream({
    bucket: location.bucket ?? undefined,
    key: location.key,
  });
  return toPdfStreamResult(result, filename);
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

function matchesExistingArchive(
  existing: {
    pdf_archive_bucket: string | null;
    pdf_archive_key: string | null;
    pdf_archive_generation: string | null;
    pdf_archive_sha256: string | null;
  } | null,
  archive: ImmutablePdfArchive,
): boolean {
  if (!existing) return false;
  const checks: [string | null, string][] = [
    [existing.pdf_archive_bucket, archive.bucket],
    [existing.pdf_archive_key, archive.key],
    [existing.pdf_archive_generation, archive.generation],
    [existing.pdf_archive_sha256, archive.sha256],
  ];
  return checks.every(([actual, expected]) => actual === expected);
}

export async function persistBrandedArchiveMetadata(
  ...args:
    | [params: PersistBrandedArchiveMetadataParams]
    | [
        prisma: InvoicePdfPrismaClient,
        invoiceId: string,
        tenantId: string,
        archive: ImmutablePdfArchive,
        generatedAt: Date,
      ]
): Promise<void> {
  const params: PersistBrandedArchiveMetadataParams =
    args.length === 1
      ? args[0]
      : {
          prisma: args[0],
          invoiceId: args[1],
          tenantId: args[2],
          archive: args[3],
          generatedAt: args[4],
        };

  const persisted = await params.prisma.client.invoice.updateMany({
    where: {
      id: params.invoiceId,
      tenant_id: params.tenantId,
      pdf_archive_bucket: null,
      pdf_archive_key: null,
      pdf_archive_generation: null,
      pdf_archive_sha256: null,
    },
    data: {
      pdf_archive_bucket: params.archive.bucket,
      pdf_archive_key: params.archive.key,
      pdf_archive_generation: params.archive.generation,
      pdf_archive_sha256: params.archive.sha256,
      pdf_generated_at: params.generatedAt,
      pdf_generation_error: null,
    },
  });

  if (persisted.count === 1) return;

  const existing = await params.prisma.client.invoice.findFirst({
    where: { id: params.invoiceId, tenant_id: params.tenantId },
    select: {
      pdf_archive_bucket: true,
      pdf_archive_key: true,
      pdf_archive_generation: true,
      pdf_archive_sha256: true,
    },
  });

  if (!matchesExistingArchive(existing, params.archive)) {
    throw brandRenderInputUnavailable(
      'Immutable invoice archive metadata could not be persisted.',
    );
  }
}
