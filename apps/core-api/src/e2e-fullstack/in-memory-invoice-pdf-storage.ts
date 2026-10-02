import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { DocumentBrandingAssetStorage } from '../document-branding/document-branding-asset-storage.js';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { InvoicePdfRenderer } from '../invoices/invoice-pdf.renderer.js';
import { InvoicePdfService } from '../invoices/invoice-pdf.service.js';
import { PdfStorage } from '../common/pdf/pdf-storage.js';
import type {
  ImmutablePdfArchive,
  PdfArchiveIdentityMetadata,
} from '../common/pdf/pdf-storage.js';

/** Must match `TEST_LOGO_BYTES` in invoice-branding archive test utils (seed fixture logo). */
const TEST_LOGO_BYTES = Buffer.from('AUT-323 frozen logo fixture');
const PDF_MIME_TYPE = 'application/pdf';

type StoredArchive = ImmutablePdfArchive & {
  body: Buffer;
  customMetadata: PdfArchiveIdentityMetadata & { pdf_sha256: string };
};

export type InMemoryInvoicePdfStorageOptions = {
  mockRenderer?: boolean;
};

function hashBytes(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

function matchesIdentity(
  actual: PdfArchiveIdentityMetadata,
  expected: PdfArchiveIdentityMetadata,
) {
  return (
    actual.tenant_id === expected.tenant_id &&
    actual.invoice_id === expected.invoice_id &&
    actual.snapshot_sha256 === expected.snapshot_sha256 &&
    actual.template_version === expected.template_version
  );
}

function assertPdfHash(archive: StoredArchive) {
  const actualHash = hashBytes(archive.body);
  if (
    actualHash !== archive.sha256 ||
    actualHash !== archive.customMetadata.pdf_sha256
  ) {
    throw new InternalServerErrorException(
      'Immutable PDF archive checksum could not be verified',
    );
  }
}

export function installInMemoryInvoicePdfStorage(
  app: INestApplication,
  options: InMemoryInvoicePdfStorageOptions = {},
) {
  const invoicePdfService = app
    .select(InvoicesModule)
    .get(InvoicePdfService);
  const dependencies = invoicePdfService as unknown as {
    renderer: InvoicePdfRenderer;
    storage: PdfStorage;
    brandingStorage: DocumentBrandingAssetStorage | undefined;
  };
  const { renderer, storage, brandingStorage } = dependencies;
  if (!brandingStorage) {
    throw new Error(
      'Invoice PDF service is missing document branding asset storage',
    );
  }

  const archives = new Map<string, StoredArchive>();
  const testInvoicePdfBucket =
    process.env.INVOICE_PDF_BUCKET?.trim() || 'test-invoice-pdf';
  process.env.INVOICE_PDF_BUCKET = testInvoicePdfBucket;
  let generationCounter = 1;

  if (options.mockRenderer) {
    const fixturePdf = Buffer.from('%PDF-1.4 AUT-345 in-memory fixture');
    renderer.render = async () => fixturePdf;
  }

  brandingStorage.readGeneration = async (bucket, key, generation) => {
    void bucket;
    void key;
    void generation;
    return Buffer.from(TEST_LOGO_BYTES);
  };

  storage.publishImmutablePdf = async (input) => {
    const bucket = testInvoicePdfBucket;
    const objectIdentity = `${bucket}:${input.key}`;
    if (archives.has(objectIdentity)) {
      throw Object.assign(new Error('immutable archive already exists'), {
        code: 412,
      });
    }

    const archive: StoredArchive = {
      bucket,
      key: input.key,
      generation: String(generationCounter++),
      sha256: hashBytes(input.body),
      customMetadata: {
        ...input.customMetadata,
        pdf_sha256: hashBytes(input.body),
      },
      body: Buffer.from(input.body),
    };
    archives.set(objectIdentity, archive);
    return archive;
  };

  storage.readImmutablePdfByKey = async (input) => {
    const objectIdentity = `${input.bucket}:${input.key}`;
    const archive = archives.get(objectIdentity);
    if (!archive) {
      throw new NotFoundException('PDF archive object not found');
    }
    if (!matchesIdentity(archive.customMetadata, input.expectedIdentity)) {
      throw new InternalServerErrorException(
        'Immutable PDF archive identity could not be verified',
      );
    }
    assertPdfHash(archive);
    return archive;
  };

  storage.readImmutablePdfGeneration = async (input) => {
    const objectIdentity = `${input.bucket}:${input.key}`;
    const archive = archives.get(objectIdentity);
    if (!archive || archive.generation !== input.generation) {
      throw new NotFoundException('PDF archive generation not found');
    }
    if (archive.sha256 !== input.expectedSha256) {
      throw new InternalServerErrorException(
        'Immutable PDF archive checksum could not be verified',
      );
    }
    assertPdfHash(archive);
    return archive;
  };

  storage.getPdfStream = async (input) => {
    const objectIdentity = `${input.bucket ?? process.env.INVOICE_PDF_BUCKET}:${input.key}`;
    const archive = archives.get(objectIdentity);
    if (!archive) {
      throw new NotFoundException('PDF not found in storage');
    }
    return {
      bucket: archive.bucket,
      key: archive.key,
      stream: Readable.from([archive.body]),
      contentType: PDF_MIME_TYPE,
      contentLength: archive.body.length,
    };
  };

  return { archives, testInvoicePdfBucket };
}
