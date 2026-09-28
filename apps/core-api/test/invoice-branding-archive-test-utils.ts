import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import request from 'supertest';
import { DocumentBrandingAssetStorage } from '../src/document-branding/document-branding-asset-storage.js';
import { InvoicesModule } from '../src/invoices/invoices.module.js';
import { InvoicePdfRenderer } from '../src/invoices/invoice-pdf.renderer.js';
import { InvoicePdfService } from '../src/invoices/invoice-pdf.service.js';
import { hashInvoiceSnapshot } from '../src/invoices/invoice-snapshot-hash.js';
import { PdfStorage } from '../src/common/pdf/pdf-storage.js';
import type {
  ImmutablePdfArchive,
  PdfArchiveIdentityMetadata,
} from '../src/common/pdf/pdf-storage.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

const TEST_PDF_BYTES = Buffer.from('AUT-323 immutable archive fixture');
const TEST_LOGO_BYTES = Buffer.from('AUT-323 frozen logo fixture');
const PDF_MIME_TYPE = 'application/pdf';
const logoReadCallsByApp = new WeakMap<
  INestApplication,
  Array<{ bucket: string; key: string; generation: string }>
>();
const archiveTestStateByApp = new WeakMap<INestApplication, ArchiveTestState>();

type StoredArchive = ImmutablePdfArchive & {
  body: Buffer;
  customMetadata: PdfArchiveIdentityMetadata & { pdf_sha256: string };
};

type ArchiveTestState = {
  archives: Map<string, StoredArchive>;
  publishedKeys: string[];
  readKeys: string[];
  failNextMetadataWrite(): void;
  synchronizeNextTwoRenders(): void;
};

export function installFakeInvoiceArchiveStorage(app: INestApplication) {
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
  const publishedKeys: string[] = [];
  const readKeys: string[] = [];
  const testInvoicePdfBucket =
    process.env.INVOICE_PDF_BUCKET?.trim() || 'test-invoice-pdf';
  process.env.INVOICE_PDF_BUCKET = testInvoicePdfBucket;
  const logoReadCalls: Array<{
    bucket: string;
    key: string;
    generation: string;
  }> = [];
  let generationCounter = 1;
  let shouldFailMetadataWrite = false;
  let renderBarrier: {
    waiters: number;
    promise: Promise<void>;
    release(): void;
  } | null = null;

  const invoiceDelegate = (
    invoicePdfService as unknown as {
      prisma: {
        client: {
          invoice: {
            updateMany(args: unknown): Promise<unknown>;
          };
        };
      };
    }
  ).prisma.client.invoice;
  const originalUpdateMany = invoiceDelegate.updateMany.bind(invoiceDelegate);
  jest
    .spyOn(invoiceDelegate, 'updateMany')
    .mockImplementation(async (args: unknown) => {
      const data = (args as { data?: Record<string, unknown> }).data;
      if (shouldFailMetadataWrite && data && 'pdf_archive_key' in data) {
        shouldFailMetadataWrite = false;
        throw new Error('Simulated invoice archive metadata write failure');
      }
      return originalUpdateMany(args);
    });

  jest.spyOn(renderer, 'render').mockImplementation(async () => {
    const currentBarrier = renderBarrier;
    if (currentBarrier) {
      currentBarrier.waiters += 1;
      if (currentBarrier.waiters === 2) {
        renderBarrier = null;
        currentBarrier.release();
      }
      await currentBarrier.promise;
    }
    return TEST_PDF_BYTES;
  });
  jest
    .spyOn(brandingStorage, 'readGeneration')
    .mockImplementation(async (bucket, key, generation) => {
      logoReadCalls.push({ bucket, key, generation });
      return TEST_LOGO_BYTES;
    });
  jest
    .spyOn(storage, 'publishImmutablePdf')
    .mockImplementation(async (input) => {
      const bucket = testInvoicePdfBucket;
      const objectIdentity = `${bucket}:${input.key}`;
      publishedKeys.push(objectIdentity);
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
    });
  jest
    .spyOn(storage, 'readImmutablePdfByKey')
    .mockImplementation(async (input) => {
      const objectIdentity = `${input.bucket}:${input.key}`;
      readKeys.push(objectIdentity);
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
    });
  jest
    .spyOn(storage, 'readImmutablePdfGeneration')
    .mockImplementation(async (input) => {
      const objectIdentity = `${input.bucket}:${input.key}`;
      readKeys.push(objectIdentity);
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
    });
  jest.spyOn(storage, 'getPdfStream').mockImplementation(async (input) => {
    const objectIdentity = `${input.bucket ?? process.env.INVOICE_PDF_BUCKET}:${input.key}`;
    readKeys.push(objectIdentity);
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
  });

  logoReadCallsByApp.set(app, logoReadCalls);

  const state: ArchiveTestState = {
    archives,
    publishedKeys,
    readKeys,
    failNextMetadataWrite: () => {
      shouldFailMetadataWrite = true;
    },
    synchronizeNextTwoRenders: () => {
      let release!: () => void;
      const promise = new Promise<void>((resolve) => {
        release = resolve;
      });
      renderBarrier = { waiters: 0, promise, release };
    },
  };
  archiveTestStateByApp.set(app, state);

  return {
    archives,
    publishedKeys,
    readKeys,
    logoReadCalls,
    pdfBytes: Buffer.from(TEST_PDF_BYTES),
    logoBytes: Buffer.from(TEST_LOGO_BYTES),
  };
}

export function seedLegacyInvoicePdf(
  app: INestApplication,
  bucket: string,
  key: string,
  body: Buffer,
): void {
  const state = archiveTestStateByApp.get(app);
  if (!state) {
    throw new Error('Invoice archive test storage was not installed');
  }
  const sha256 = hashBytes(body);
  const archive: StoredArchive = {
    bucket,
    key,
    generation: 'legacy-generation',
    sha256,
    customMetadata: {
      tenant_id: 'legacy-tenant',
      invoice_id: 'legacy-invoice',
      snapshot_sha256: '0'.repeat(64),
      template_version: 'legacy-pdf-v1',
      pdf_sha256: sha256,
    },
    body: Buffer.from(body),
  };
  state.archives.set(`${bucket}:${key}`, archive);
}

export async function confirmDocumentBrandTheme(options: {
  app: INestApplication;
  authToken: string;
  legalEntityId: string;
  logoAssetId: string | null;
  headerText: string;
}) {
  const baseUrl = `/api/legal-entities/${options.legalEntityId}/document-branding`;
  const current = await request(options.app.getHttpServer())
    .get(baseUrl)
    .set('Authorization', `Bearer ${options.authToken}`)
    .expect(200);
  const theme = {
    schemaVersion: 1,
    presetId: 'standard-v1',
    logoAssetId: options.logoAssetId,
    primaryColor: '#334155',
    secondaryColor: '#E5E7EB',
    fontId: 'acp-sans-v1',
    headerBand: 'primary',
    footerBand: 'secondary',
    headerText: options.headerText,
    footerText: 'Frozen footer',
  };
  const draft = await request(options.app.getHttpServer())
    .put(`${baseUrl}/draft`)
    .set('Authorization', `Bearer ${options.authToken}`)
    .send({ expectedRevision: current.body.revision, theme })
    .expect(200);
  return request(options.app.getHttpServer())
    .post(`${baseUrl}/confirm`)
    .set('Authorization', `Bearer ${options.authToken}`)
    .set('Idempotency-Key', `aut323-confirm-${randomUUID()}`)
    .send({ expectedRevision: draft.body.revision })
    .expect(200);
}

export async function resetDocumentBrandTheme(options: {
  app: INestApplication;
  authToken: string;
  legalEntityId: string;
}) {
  const baseUrl = `/api/legal-entities/${options.legalEntityId}/document-branding`;
  const current = await request(options.app.getHttpServer())
    .get(baseUrl)
    .set('Authorization', `Bearer ${options.authToken}`)
    .expect(200);
  return request(options.app.getHttpServer())
    .post(`${baseUrl}/reset`)
    .set('Authorization', `Bearer ${options.authToken}`)
    .set('Idempotency-Key', `aut323-reset-${randomUUID()}`)
    .send({ expectedRevision: current.body.revision })
    .expect(200);
}

export async function createReadyDocumentBrandLogo(
  prisma: PrismaService,
  tenantId: string,
  legalEntityId: string,
  suffix: string,
) {
  return prisma.documentBrandAsset.create({
    data: {
      tenant_id: tenantId,
      legal_entity_id: legalEntityId,
      purpose: 'LOGO',
      state: 'READY',
      bucket: 'aut323-test-brand-assets',
      object_key: `logos/${tenantId}/${legalEntityId}/${suffix}.png`,
      object_generation: '17',
      sha256: hashBytes(TEST_LOGO_BYTES),
      byte_length: TEST_LOGO_BYTES.length,
      detected_mime_type: 'image/png',
      pixel_width: 120,
      pixel_height: 40,
    },
  });
}

export async function exerciseFrozenInvoiceArchiveLifecycle(options: {
  app: INestApplication;
  prisma: PrismaService;
  authToken: string;
  invoiceId: string;
  legalEntityId: string;
  logoAssetId: string | null;
}) {
  const invoiceBeforeProfileChanges =
    await options.prisma.invoice.findFirstOrThrow({
      where: { id: options.invoiceId },
      select: { snapshot: true },
    });
  const frozenSnapshot = invoiceBeforeProfileChanges.snapshot;
  const branding = (
    frozenSnapshot as {
      branding: {
        logo: { asset_id: string } | null;
        resolved_at: string;
      };
      snapshot_created_at: string;
    }
  ).branding;
  expect(branding.logo?.asset_id ?? null).toBe(options.logoAssetId);
  expect(branding.resolved_at).toBe(
    (frozenSnapshot as { snapshot_created_at: string }).snapshot_created_at,
  );

  const reference = await options.prisma.invoiceBrandAssetReference.findFirst({
    where: {
      invoice_id: options.invoiceId,
      ...(options.logoAssetId ? { asset_id: options.logoAssetId } : {}),
    },
  });
  expect(Boolean(reference)).toBe(Boolean(options.logoAssetId));

  await confirmDocumentBrandTheme({
    app: options.app,
    authToken: options.authToken,
    legalEntityId: options.legalEntityId,
    logoAssetId: null,
    headerText: 'Changed after invoice commitment',
  });
  await resetDocumentBrandTheme({
    app: options.app,
    authToken: options.authToken,
    legalEntityId: options.legalEntityId,
  });

  const archiveTestState = archiveTestStateByApp.get(options.app);
  if (!archiveTestState) {
    throw new Error('Invoice archive test storage was not installed');
  }

  const invoiceAfterProfileChanges =
    await options.prisma.invoice.findFirstOrThrow({
      where: { id: options.invoiceId },
      select: { tenant_id: true, legal_entity_id: true, snapshot: true },
    });
  expect(invoiceAfterProfileChanges.legal_entity_id).toBe(
    options.legalEntityId,
  );
  const frozenLogo = (
    invoiceAfterProfileChanges.snapshot as {
      branding: {
        logo: {
          asset_id: string;
          bucket: string;
          key: string;
          generation: string;
          sha256: string;
          mime_type: string;
          width: number;
          height: number;
        } | null;
      };
    }
  ).branding.logo;
  expect(frozenLogo?.asset_id ?? null).toBe(options.logoAssetId);
  const retainedReference =
    await options.prisma.invoiceBrandAssetReference.findFirst({
      where: {
        tenant_id: invoiceAfterProfileChanges.tenant_id,
        legal_entity_id: invoiceAfterProfileChanges.legal_entity_id,
        invoice_id: options.invoiceId,
        ...(options.logoAssetId ? { asset_id: options.logoAssetId } : {}),
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
  if (frozenLogo) {
    expect(retainedReference?.asset).toEqual({
      bucket: frozenLogo.bucket,
      object_key: frozenLogo.key,
      object_generation: frozenLogo.generation,
      sha256: frozenLogo.sha256,
      detected_mime_type: frozenLogo.mime_type,
      pixel_width: frozenLogo.width,
      pixel_height: frozenLogo.height,
    });
  } else {
    expect(retainedReference).toBeNull();
  }

  const api = request(options.app.getHttpServer());
  const generate = () =>
    api
      .post(`/api/invoices/${options.invoiceId}/pdf`)
      .set('Authorization', `Bearer ${options.authToken}`);
  archiveTestState.failNextMetadataWrite();
  const interruptedGeneration = await generate();
  if (interruptedGeneration.status < 500) {
    throw new Error(
      `Expected archive metadata persistence to fail after publication; received ${interruptedGeneration.status}: ${JSON.stringify(interruptedGeneration.body)}`,
    );
  }

  const invoiceAfterInterruptedGeneration =
    await options.prisma.invoice.findFirstOrThrow({
      where: { id: options.invoiceId },
      select: {
        pdf_archive_bucket: true,
        pdf_archive_key: true,
        pdf_archive_generation: true,
        pdf_archive_sha256: true,
      },
    });
  expect(invoiceAfterInterruptedGeneration).toEqual({
    pdf_archive_bucket: null,
    pdf_archive_key: null,
    pdf_archive_generation: null,
    pdf_archive_sha256: null,
  });

  const objectCountBeforeRetry = archiveTestState.archives.size;
  archiveTestState.synchronizeNextTwoRenders();
  const generationRetries = await Promise.all([generate(), generate()]);
  for (const response of generationRetries) {
    if (response.status !== 201) {
      throw new Error(
        `Invoice PDF retry failed (${response.status}): ${JSON.stringify(response.body)}; logo reads: ${JSON.stringify(logoReadCallsByApp.get(options.app) ?? [])}`,
      );
    }
  }
  expect(archiveTestState.archives.size).toBe(objectCountBeforeRetry);

  const persistedInvoice = await options.prisma.invoice.findFirstOrThrow({
    where: { id: options.invoiceId },
    select: {
      tenant_id: true,
      snapshot: true,
      pdf_archive_bucket: true,
      pdf_archive_key: true,
      pdf_archive_generation: true,
      pdf_archive_sha256: true,
    },
  });
  expect(persistedInvoice.snapshot).toEqual(frozenSnapshot);
  expect(persistedInvoice.pdf_archive_bucket).toBeTruthy();
  const snapshotHash = hashInvoiceSnapshot(persistedInvoice.snapshot);
  expect(persistedInvoice.pdf_archive_key).toBe(
    `invoice-archives/${persistedInvoice.tenant_id}/${options.invoiceId}/${snapshotHash}/invoice-brand-v1.pdf`,
  );
  expect(persistedInvoice.pdf_archive_generation).toBeTruthy();
  expect(persistedInvoice.pdf_archive_sha256).toMatch(/^[a-f0-9]{64}$/);
  const archive = [...archiveTestState.archives.values()].find(
    (candidate) => candidate.key === persistedInvoice.pdf_archive_key,
  );
  expect(archive).toBeTruthy();
  expect(archive?.customMetadata.snapshot_sha256).toBe(snapshotHash);
  expect(archive?.sha256).toBe(persistedInvoice.pdf_archive_sha256);

  const download = () =>
    api
      .get(`/api/invoices/${options.invoiceId}/pdf`)
      .set('Authorization', `Bearer ${options.authToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
  const [first, second] = await Promise.all([download(), download()]);
  for (const response of [first, second]) {
    if (response.status !== 200) {
      throw new Error(
        `Invoice PDF download failed (${response.status}): ${response.body.toString('utf8')}`,
      );
    }
    expect(response.headers['content-type']).toMatch(/application\/pdf/);
  }
  expect(first.body).toEqual(TEST_PDF_BYTES);
  expect(second.body).toEqual(TEST_PDF_BYTES);
}

export async function withInvoiceBrandingWriterDisabled<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const previousValue = process.env.INVOICE_BRANDING_WRITER_ENABLED;
  process.env.INVOICE_BRANDING_WRITER_ENABLED = 'false';
  try {
    return await operation();
  } finally {
    if (previousValue === undefined) {
      delete process.env.INVOICE_BRANDING_WRITER_ENABLED;
    } else {
      process.env.INVOICE_BRANDING_WRITER_ENABLED = previousValue;
    }
  }
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

function hashBytes(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}
