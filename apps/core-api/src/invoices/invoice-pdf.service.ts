import * as Sentry from '@sentry/node';
import { SiteContextService } from '../site/site-context.service.js';
import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { DocumentBrandingAssetStorage } from '../document-branding/document-branding-asset-storage.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { INVOICE_BRANDED_TEMPLATE_VERSION } from './invoice-snapshot-v2.js';
import { CloudTasksService, PdfStorage } from '../common/index.js';
import { resolveInvoiceSnapshot } from './invoice-snapshot.resolver.js';
import { InvoicePdfRenderer } from './invoice-pdf.renderer.js';
import {
  assertInvoicePdfGenerationAllowed,
  readCachedPdfMetadata,
} from './invoice-pdf.generation.js';
import type { InvoiceSnapshot } from './invoice-snapshot.js';
import * as helpers from './invoice-pdf.helpers.js';

export type InvoicePdfRequestGenerationResponse =
  helpers.InvoicePdfRequestGenerationResponse;

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
  ) {
    this.logger.debug('InvoicePdfService initialized');
  }

  async requestGeneration(
    invoiceId: string,
    params: { targetBaseUrl: string },
  ): Promise<InvoicePdfRequestGenerationResponse> {
    const { tenantId, authorizedSiteIds } = await this.getScope();
    const invoice = await helpers.fetchInvoiceForRequest(
      this.prisma,
      invoiceId,
      tenantId,
      authorizedSiteIds,
    );

    const cached = await this.resolveCachedRequest(invoice, tenantId);
    if (cached) {
      return cached;
    }

    assertInvoicePdfGenerationAllowed(invoice.status);

    const outcome = await this.dispatchPdfGeneration(
      invoiceId,
      tenantId,
      params.targetBaseUrl,
    );
    return helpers.formatRequestGenerationOutcome(
      outcome,
      invoiceId,
      helpers.isBrandedSnapshot(invoice.snapshot),
    );
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

        const cached = await this.resolveCachedGenerateNow(invoice, tenantId);
        if (cached) {
          return cached;
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

        return await this.renderAndUploadStandardPdf({
          invoiceId,
          tenantId,
          snapshot,
          customerId: invoice.customer_id,
          workshopOrderId: invoice.workshop_order_id,
        });
      },
    );
  }

  async getPdf(invoiceId: string): Promise<helpers.PdfStreamResult> {
    const { tenantId, authorizedSiteIds } = await this.getScope();
    const invoice = await helpers.fetchInvoiceForPdfGet(
      this.prisma,
      invoiceId,
      tenantId,
      authorizedSiteIds,
    );

    const filename = `invoice-${invoice.invoice_number ?? invoice.id}.pdf`;

    if (helpers.isBrandedSnapshot(invoice.snapshot)) {
      return await helpers.fetchBrandedPdfStream(
        this.storage,
        invoice,
        tenantId,
        filename,
      );
    }

    const cachedPdf = readCachedPdfMetadata(invoice);
    if (cachedPdf) {
      return helpers.streamStoredPdf(this.storage, cachedPdf, filename);
    }

    return await helpers.fetchFallbackPdfStream(
      this.storage,
      this.prisma,
      this.logger,
      invoiceId,
      tenantId,
      filename,
    );
  }

  private async resolveCachedRequest(
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
  ): Promise<InvoicePdfRequestGenerationResponse | null> {
    return helpers.resolveInvoiceCachedRequest(this.storage, invoice, tenantId);
  }

  private async clearPdfGenerationError(
    invoiceId: string,
    tenantId: string,
  ): Promise<void> {
    await helpers.clearInvoiceGenerationError(this.prisma, invoiceId, tenantId);
  }

  private async dispatchPdfGeneration(
    invoiceId: string,
    tenantId: string,
    targetBaseUrl: string,
  ) {
    return helpers.dispatchInvoiceGeneration({
      invoiceId,
      tenantId,
      targetBaseUrl,
      cloudTasks: this.cloudTasks,
      logger: this.logger,
      clearError: () => this.clearPdfGenerationError(invoiceId, tenantId),
      generateInline: () => this.generateNow(invoiceId),
      storeEnqueueError: (msg) =>
        this.safeStoreGenerationError(invoiceId, msg, tenantId),
      onEnqueueError: (error) => {
        Sentry.captureException(error, {
          tags: { invoiceId, operation: 'cloudtasks.enqueuePdfGeneration' },
        });
      },
    });
  }

  private async resolveCachedGenerateNow(
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
  ): Promise<{
    invoiceId: string;
    bucket: string;
    key: string;
    generatedAt: Date;
  } | null> {
    return helpers.resolveInvoiceCachedGenerateNow(
      this.storage,
      invoice,
      tenantId,
      (cached) => this.recordCacheHit(cached),
    );
  }

  private async renderAndUploadStandardPdf(params: {
    invoiceId: string;
    tenantId: string;
    snapshot: InvoiceSnapshot;
    customerId: string;
    workshopOrderId: string | null;
  }): Promise<{
    invoiceId: string;
    bucket: string;
    key: string;
    generatedAt: Date;
  }> {
    const { invoiceId, tenantId, snapshot, customerId, workshopOrderId } =
      params;
    try {
      return await helpers.executeStandardPdfGeneration({
        invoiceId,
        tenantId,
        snapshot,
        storage: this.storage,
        renderer: this.renderer,
        prisma: this.prisma,
        onRetry: (error, attempt) =>
          this.logPdfRetry(invoiceId, attempt, error),
      });
    } catch (error) {
      await this.handleStandardPdfError({
        invoiceId,
        tenantId,
        customerId,
        workshopOrderId,
        error,
      });
      throw error;
    }
  }

  private logPdfRetry(
    invoiceId: string,
    attempt: number,
    error: unknown,
  ): void {
    const message = helpers.toErrorMessage(error);
    this.logger.warn(
      `Invoice PDF generation attempt ${attempt} failed: ${message}`,
    );
    Sentry.addBreadcrumb({
      message: `Invoice PDF generation retry ${attempt}`,
      category: 'pdf.retry',
      level: 'warning',
      data: { invoiceId, attempt, error: message },
    });
  }

  private async handleStandardPdfError(params: {
    invoiceId: string;
    tenantId: string;
    customerId: string;
    workshopOrderId: string | null;
    error: unknown;
  }): Promise<void> {
    await helpers.handleInvoicePdfError(this.logger, this.prisma, params);
  }

  private async generateBrandedArchive(input: {
    invoice: Awaited<ReturnType<InvoicePdfService['loadInvoiceForGeneration']>>;
    renderSnapshot: InvoiceSnapshot;
    frozenSnapshot: unknown;
    tenantId: string;
  }) {
    const { invoice, renderSnapshot, frozenSnapshot, tenantId } = input;
    const identity = helpers.buildArchiveIdentity(
      tenantId,
      invoice.id,
      frozenSnapshot,
    );
    const key = helpers.buildArchiveKey(identity);
    const logoPng = await helpers.loadFrozenLogo(
      this.prisma,
      this.brandingStorage,
      invoice,
      renderSnapshot,
    );
    const pdf = await this.renderer.render(renderSnapshot, { logoPng });

    const archive = await helpers.adoptOrPublishImmutablePdf(
      this.storage,
      key,
      pdf,
      identity,
    );
    const generatedAt = new Date();
    await helpers.persistBrandedArchiveMetadata(
      this.prisma,
      invoice.id,
      tenantId,
      archive,
      generatedAt,
    );

    return {
      invoiceId: invoice.id,
      bucket: archive.bucket,
      key: archive.key,
      generatedAt,
    };
  }

  private async loadInvoiceForGeneration(invoiceId: string, tenantId: string) {
    return helpers.fetchInvoiceForGeneration(this.prisma, invoiceId, tenantId);
  }

  private recordCacheHit(cachedPdf: { bucket: string; key: string }) {
    this.logger.debug(`Invoice PDF cache hit for ${cachedPdf.key}`);
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
    await helpers.persistInvoiceGeneratedPdf(
      this.prisma,
      invoiceId,
      tenantId,
      upload,
      generatedAt,
    );
  }

  private async backfillPdfMetadataFromStorage(
    invoiceId: string,
    tenantId: string,
    bucket: string,
    key: string,
  ) {
    await helpers.backfillInvoicePdfMetadata(
      this.prisma,
      this.logger,
      invoiceId,
      tenantId,
      bucket,
      key,
    );
  }

  private async safeStoreGenerationError(
    invoiceId: string,
    message: string,
    tenantId: string,
  ) {
    await helpers.safeStoreInvoiceGenerationError(
      this.prisma,
      this.logger,
      invoiceId,
      tenantId,
      message,
    );
  }

  private async getScope() {
    return {
      tenantId: await this.tenantContext.getTenantId(),
      authorizedSiteIds: await this.siteContext.listAuthorizedSiteIds(),
    };
  }
}
