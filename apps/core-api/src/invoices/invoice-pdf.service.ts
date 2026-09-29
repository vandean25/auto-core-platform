import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import * as Sentry from '@sentry/node';
import { PrismaService } from '../prisma/prisma.service.js';
import { InvoicePdfRenderer } from './invoice-pdf.renderer.js';
import { CloudTasksService, PdfStorage } from '../common/index.js';
import { enqueueOrGeneratePdf } from '../common/pdf/pdf-generation-dispatch.js';
import { renderAndUploadPdf } from '../common/pdf/pdf-render-upload.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import {
  assertInvoicePdfGenerationAllowed,
  readCachedPdfMetadata,
} from './invoice-pdf.generation.js';
import { resolveInvoiceSnapshot } from './invoice-snapshot.resolver.js';
import { hashInvoiceSnapshot } from './invoice-snapshot-hash.js';
import { resolvePdfStorageBucket } from '../common/pdf/pdf-bucket.js';
import type { InvoiceSnapshot } from './invoice-snapshot.js';
import type {
  ImmutablePdfArchive,
  PdfArchiveIdentityMetadata,
} from '../common/pdf/pdf-storage.js';
import { DocumentBrandingAssetStorage } from '../document-branding/document-branding-asset-storage.js';
import { INVOICE_BRANDED_TEMPLATE_VERSION } from './invoice-snapshot-v2.js';
import { SiteContextService } from '../site/site-context.service.js';

export type InvoicePdfRequestGenerationResponse = {
  mode: 'cached' | 'enqueued' | 'generated';
  invoiceId: string;
  bucket: string | null;
  key: string | null;
  generatedAt: Date | null;
  taskId?: string;
};

@Injectable()
export class InvoicePdfService {
  private readonly logger = new Logger(InvoicePdfService.name);

  constructor(
    private prisma: PrismaService,
    private renderer: InvoicePdfRenderer,
    private storage: PdfStorage,
    private cloudTasks: CloudTasksService,
    private tenantContext: TenantContextService,
    @Optional()
    @Inject(DocumentBrandingAssetStorage)
    private brandingStorage: DocumentBrandingAssetStorage | undefined,
    private siteContext: SiteContextService,
  ) {}

  async requestGeneration(
    invoiceId: string,
    params: { targetBaseUrl: string },
  ): Promise<InvoicePdfRequestGenerationResponse> {
    const tenantId = await this.tenantContext.getTenantId();
    const authorizedSiteIds = await this.siteContext.listAuthorizedSiteIds();
    const invoice = await this.prisma.client.invoice.findFirst({
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

    const branded = isBrandedSnapshot(invoice.snapshot);
    const brandedArchive = readArchiveMetadata(invoice);
    if (branded && brandedArchive) {
      await this.readArchiveFromMetadata(
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

    assertInvoicePdfGenerationAllowed(invoice.status);

    const outcome = await enqueueOrGeneratePdf({
      kind: 'invoice',
      resourceId: invoiceId,
      resourceName: 'invoice',
      tenantId,
      targetBaseUrl: params.targetBaseUrl,
      cloudTasks: this.cloudTasks,
      nodeEnv: process.env.NODE_ENV,
      logger: this.logger,
      clearError: () =>
        this.prisma.client.invoice
          .updateMany({
            where: { id: invoiceId, tenant_id: tenantId },
            data: { pdf_generation_error: null },
          })
          .then(() => {}),
      generateInline: () => this.generateNow(invoiceId),
      storeEnqueueError: (msg) =>
        this.safeStoreGenerationError(invoiceId, msg, tenantId),
      onEnqueueError: (error) => {
        Sentry.captureException(error, {
          tags: { invoiceId, operation: 'cloudtasks.enqueuePdfGeneration' },
        });
      },
    });

    if (outcome.mode === 'enqueued') {
      return {
        mode: 'enqueued',
        invoiceId,
        bucket: null,
        key: null,
        generatedAt: null,
        taskId: outcome.taskId,
      };
    }

    if (branded) {
      return {
        mode: 'generated',
        invoiceId,
        bucket: null,
        key: null,
        generatedAt: outcome.result.generatedAt,
      };
    }
    return { mode: 'generated', ...outcome.result };
  }

  async generateNow(invoiceId: string): Promise<{
    invoiceId: string;
    bucket: string;
    key: string;
    generatedAt: Date;
  }> {
    return Sentry.startSpan(
      { name: 'Generate Invoice PDF', op: 'pdf.generate' },
      async (span) => {
        span.setAttribute('invoiceId', invoiceId);
        const tenantId = await this.tenantContext.getTenantId();
        const invoice = await this.loadInvoiceForGeneration(
          invoiceId,
          tenantId,
        );

        span.setAttribute('customerId', invoice.customer_id);
        if (invoice.workshop_order_id) {
          span.setAttribute('workshopOrderId', invoice.workshop_order_id);
        }

        const branded = isBrandedSnapshot(invoice.snapshot);
        const archiveMetadata = readArchiveMetadata(invoice);
        if (branded && archiveMetadata) {
          const archive = await this.readArchiveFromMetadata(
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
          this.recordCacheHit(cachedPdf);
          return {
            invoiceId: invoice.id,
            bucket: cachedPdf.bucket,
            key: cachedPdf.key,
            generatedAt: cachedPdf.generatedAt,
          };
        }

        assertInvoicePdfGenerationAllowed(invoice.status);

        const snapshot = await resolveInvoiceSnapshot(
          this.prisma,
          invoiceId,
          invoice.snapshot,
          tenantId,
        );
        if (snapshot.template_version === INVOICE_BRANDED_TEMPLATE_VERSION) {
          return await this.generateBrandedArchive({
            invoice,
            renderSnapshot: snapshot,
            frozenSnapshot: invoice.snapshot,
            tenantId,
          });
        }
        const key = `invoices/${invoiceId}.pdf`;

        try {
          const upload = await renderAndUploadPdf({
            render: () => this.renderer.render(snapshot),
            upload: (pdf) =>
              this.storage.uploadPdf({
                key,
                body: pdf,
                contentType: 'application/pdf',
              }),
            onRetry: (error, attempt) => {
              const message =
                error instanceof Error ? error.message : String(error);
              this.logger.warn(
                `Invoice PDF generation attempt ${attempt} failed: ${message}`,
              );

              Sentry.addBreadcrumb({
                message: `Invoice PDF generation retry ${attempt}`,
                category: 'pdf.retry',
                level: 'warning',
                data: { invoiceId, attempt, error: message },
              });
            },
          });

          const generatedAt = new Date();
          await this.persistGeneratedPdf(
            invoiceId,
            tenantId,
            upload,
            generatedAt,
          );

          return {
            invoiceId,
            bucket: upload.bucket,
            key: upload.key,
            generatedAt,
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Invoice PDF generation exhausted all retries (invoiceId=${invoiceId}): ${message}`,
            error instanceof Error ? error.stack : undefined,
          );

          Sentry.captureException(error, {
            tags: {
              invoiceId,
              customerId: invoice.customer_id,
              workshopOrderId: invoice.workshop_order_id ?? undefined,
            },
          });

          await this.safeStoreGenerationError(invoiceId, message, tenantId);
          throw error;
        }
      },
    );
  }

  async getPdf(invoiceId: string): Promise<{
    filename: string;
    contentType: string;
    contentLength: number | null;
    stream: Readable;
  }> {
    const tenantId = await this.tenantContext.getTenantId();
    const authorizedSiteIds = await this.siteContext.listAuthorizedSiteIds();
    const invoice = await this.prisma.client.invoice.findFirst({
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

    if (isBrandedSnapshot(invoice.snapshot)) {
      const archiveMetadata = readArchiveMetadata(invoice);
      if (!archiveMetadata) {
        throw new NotFoundException('Invoice PDF archive is not generated yet');
      }
      const archive = await this.readArchiveFromMetadata(
        archiveMetadata,
        buildArchiveIdentity(tenantId, invoice.id, invoice.snapshot),
      );
      return {
        filename: `invoice-${invoice.invoice_number ?? invoice.id}.pdf`,
        contentType: 'application/pdf',
        contentLength: archive.body.length,
        stream: Readable.from([archive.body]),
      };
    }

    const cachedPdf = readCachedPdfMetadata(invoice);
    if (cachedPdf) {
      const pdf = await this.storage.getPdfStream({
        bucket: cachedPdf.bucket,
        key: cachedPdf.key,
      });
      const filename = `invoice-${invoice.invoice_number ?? invoice.id}.pdf`;
      return {
        filename,
        contentType: pdf.contentType ?? 'application/pdf',
        contentLength: pdf.contentLength,
        stream: pdf.stream,
      };
    }

    const fallbackKey = `invoices/${invoiceId}.pdf`;
    try {
      const pdf = await this.storage.getPdfStream({ key: fallbackKey });
      await this.backfillPdfMetadataFromStorage(
        invoiceId,
        tenantId,
        pdf.bucket,
        pdf.key,
      );
      const filename = `invoice-${invoice.invoice_number ?? invoice.id}.pdf`;
      return {
        filename,
        contentType: pdf.contentType ?? 'application/pdf',
        contentLength: pdf.contentLength,
        stream: pdf.stream,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new NotFoundException('Invoice PDF is not generated yet');
      }
      throw error;
    }
  }

  private async generateBrandedArchive(input: {
    invoice: Awaited<ReturnType<InvoicePdfService['loadInvoiceForGeneration']>>;
    renderSnapshot: InvoiceSnapshot;
    frozenSnapshot: unknown;
    tenantId: string;
  }) {
    const { invoice, renderSnapshot, frozenSnapshot, tenantId } = input;
    const identity = buildArchiveIdentity(tenantId, invoice.id, frozenSnapshot);
    const key = buildArchiveKey(identity);
    const logoPng = await this.loadFrozenLogo(invoice, renderSnapshot);
    const pdf = await this.renderer.render(renderSnapshot, { logoPng });

    let archive: ImmutablePdfArchive;
    try {
      archive = await this.storage.publishImmutablePdf({
        key,
        body: pdf,
        contentType: 'application/pdf',
        customMetadata: identity,
      });
    } catch (error) {
      if (getErrorCode(error) !== 412) throw error;
      archive = await this.storage.readImmutablePdfByKey({
        bucket: resolvePdfStorageBucket(),
        key,
        expectedIdentity: identity,
      });
    }

    const generatedAt = new Date();
    const persisted = await this.prisma.client.invoice.updateMany({
      where: {
        id: invoice.id,
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
    if (persisted.count !== 1) {
      const existing = await this.prisma.client.invoice.findFirst({
        where: { id: invoice.id, tenant_id: tenantId },
        select: {
          pdf_archive_bucket: true,
          pdf_archive_key: true,
          pdf_archive_generation: true,
          pdf_archive_sha256: true,
        },
      });
      if (
        existing?.pdf_archive_bucket !== archive.bucket ||
        existing.pdf_archive_key !== archive.key ||
        existing.pdf_archive_generation !== archive.generation ||
        existing.pdf_archive_sha256 !== archive.sha256
      ) {
        throw new UnprocessableEntityException({
          code: 'BRAND_RENDER_INPUT_UNAVAILABLE',
          message: 'Immutable invoice archive metadata could not be persisted.',
        });
      }
    }

    return {
      invoiceId: invoice.id,
      bucket: archive.bucket,
      key: archive.key,
      generatedAt,
    };
  }

  private async loadFrozenLogo(
    invoice: Awaited<ReturnType<InvoicePdfService['loadInvoiceForGeneration']>>,
    snapshot: InvoiceSnapshot,
  ): Promise<Buffer | undefined> {
    const logo = snapshot.branding?.logo;
    if (!logo) return undefined;
    if (!invoice.legal_entity_id || !this.brandingStorage) {
      throw this.brandRenderInputUnavailable();
    }

    const reference =
      await this.prisma.client.invoiceBrandAssetReference.findFirst({
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
    const asset = reference?.asset;
    if (
      !asset ||
      asset.bucket !== logo.bucket ||
      asset.object_key !== logo.key ||
      asset.object_generation !== logo.generation ||
      asset.sha256 !== logo.sha256 ||
      asset.detected_mime_type !== logo.mime_type ||
      asset.pixel_width !== logo.width ||
      asset.pixel_height !== logo.height
    ) {
      throw this.brandRenderInputUnavailable();
    }

    const bytes = await this.brandingStorage.readGeneration(
      logo.bucket,
      logo.key,
      logo.generation,
    );
    if (createHash('sha256').update(bytes).digest('hex') !== logo.sha256) {
      throw this.brandRenderInputUnavailable();
    }
    return bytes;
  }

  private async readArchiveFromMetadata(
    metadata: ArchiveMetadata,
    expectedIdentity: PdfArchiveIdentityMetadata,
  ): Promise<ImmutablePdfArchive & { body: Buffer }> {
    const expectedKey = buildArchiveKey(expectedIdentity);
    if (metadata.key !== expectedKey) {
      throw this.brandRenderInputUnavailable();
    }
    const archive = await this.storage.readImmutablePdfGeneration({
      bucket: metadata.bucket,
      key: metadata.key,
      generation: metadata.generation,
      expectedSha256: metadata.sha256,
    });
    if (!sameArchiveIdentity(archive.customMetadata, expectedIdentity)) {
      throw this.brandRenderInputUnavailable();
    }
    return archive;
  }

  private brandRenderInputUnavailable(): UnprocessableEntityException {
    return new UnprocessableEntityException({
      code: 'BRAND_RENDER_INPUT_UNAVAILABLE',
      message: 'Frozen branding or archive evidence is unavailable.',
    });
  }

  private async loadInvoiceForGeneration(invoiceId: string, tenantId: string) {
    const invoice = await this.prisma.client.invoice.findFirst({
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

  private recordCacheHit(cachedPdf: { bucket: string; key: string }) {
    Sentry.addBreadcrumb({
      message: 'Invoice PDF cache hit',
      category: 'pdf',
      data: {
        bucket: cachedPdf.bucket,
        key: cachedPdf.key,
      },
    });
  }

  private async persistGeneratedPdf(
    invoiceId: string,
    tenantId: string,
    upload: { bucket: string; key: string },
    generatedAt: Date,
  ) {
    const result = await this.prisma.client.invoice.updateMany({
      where: { id: invoiceId, tenant_id: tenantId },
      data: {
        pdf_storage_bucket: upload.bucket,
        pdf_storage_key: upload.key,
        pdf_generated_at: generatedAt,
        pdf_generation_error: null,
      },
    });

    if (result.count === 0) {
      throw new NotFoundException(
        `Invoice ${invoiceId} was not found for PDF metadata persistence`,
      );
    }
  }

  private async backfillPdfMetadataFromStorage(
    invoiceId: string,
    tenantId: string,
    bucket: string,
    key: string,
  ) {
    try {
      const generatedAt = new Date();
      await this.persistGeneratedPdf(
        invoiceId,
        tenantId,
        { bucket, key },
        generatedAt,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to backfill invoice PDF metadata (invoiceId=${invoiceId}): ${message}`,
      );
    }
  }

  private async safeStoreGenerationError(
    invoiceId: string,
    message: string,
    tenantId: string,
  ) {
    try {
      await this.prisma.client.invoice.updateMany({
        where: { id: invoiceId, tenant_id: tenantId },
        data: {
          pdf_generation_error: message.slice(0, 2000),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to store invoice PDF generation error (invoiceId=${invoiceId}): ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}

type ArchiveMetadata = {
  bucket: string;
  key: string;
  generation: string;
  sha256: string;
};

function isBrandedSnapshot(snapshot: unknown): snapshot is InvoiceSnapshot {
  return (
    typeof snapshot === 'object' &&
    snapshot !== null &&
    'template_version' in snapshot &&
    snapshot.template_version === INVOICE_BRANDED_TEMPLATE_VERSION
  );
}

function readArchiveMetadata(invoice: {
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
    throw new UnprocessableEntityException({
      code: 'BRAND_RENDER_INPUT_UNAVAILABLE',
      message: 'Immutable invoice archive metadata is incomplete.',
    });
  }
  return {
    bucket: invoice.pdf_archive_bucket!,
    key: invoice.pdf_archive_key!,
    generation: invoice.pdf_archive_generation!,
    sha256: invoice.pdf_archive_sha256!,
  };
}

function buildArchiveIdentity(
  tenantId: string,
  invoiceId: string,
  snapshot: unknown,
): PdfArchiveIdentityMetadata {
  if (!isBrandedSnapshot(snapshot)) {
    throw new UnprocessableEntityException({
      code: 'BRAND_RENDER_INPUT_UNAVAILABLE',
      message: 'Branded archive requires an invoice-brand-v1 snapshot.',
    });
  }
  return {
    tenant_id: tenantId,
    invoice_id: invoiceId,
    snapshot_sha256: hashInvoiceSnapshot(snapshot),
    template_version: INVOICE_BRANDED_TEMPLATE_VERSION,
  };
}

function buildArchiveKey(identity: PdfArchiveIdentityMetadata): string {
  return `invoice-archives/${identity.tenant_id}/${identity.invoice_id}/${identity.snapshot_sha256}/${identity.template_version}.pdf`;
}

function sameArchiveIdentity(
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

function getErrorCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const { code } = error;
  if (typeof code === 'number') return code;
  if (typeof code === 'string') return Number(code);
  return undefined;
}
