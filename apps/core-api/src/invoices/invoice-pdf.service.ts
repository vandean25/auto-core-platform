import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Readable } from 'node:stream';
import * as Sentry from '@sentry/node';
import { PrismaService } from '../prisma/prisma.service';
import { InvoicePdfRenderer } from './invoice-pdf.renderer';
import { CloudTasksService, PdfStorage } from '../common';
import { enqueueOrGeneratePdf } from '../common/pdf/pdf-generation-dispatch';
import { renderAndUploadPdf } from '../common/pdf/pdf-render-upload';
import { TenantContextService } from '../common/services/tenant-context.service';
import {
  assertInvoicePdfGenerationAllowed,
  readCachedPdfMetadata,
} from './invoice-pdf.generation';
import { resolveInvoiceSnapshot } from './invoice-snapshot.resolver';

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
  ) {}

  async requestGeneration(
    invoiceId: string,
    params: { targetBaseUrl: string },
  ): Promise<InvoicePdfRequestGenerationResponse> {
    const tenantId = await this.tenantContext.getTenantId();
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, tenant_id: tenantId },
      select: {
        id: true,
        status: true,
        pdf_storage_bucket: true,
        pdf_storage_key: true,
        pdf_generated_at: true,
      },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
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

        const cachedPdf = readCachedPdfMetadata(invoice);
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
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, tenant_id: tenantId },
      select: {
        id: true,
        invoice_number: true,
        pdf_storage_bucket: true,
        pdf_storage_key: true,
      },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    if (!invoice.pdf_storage_key) {
      throw new NotFoundException('Invoice PDF is not generated yet');
    }

    const pdf = await this.storage.getPdfStream({
      bucket: invoice.pdf_storage_bucket ?? undefined,
      key: invoice.pdf_storage_key,
    });
    const filename = `invoice-${invoice.invoice_number ?? invoice.id}.pdf`;
    return {
      filename,
      contentType: pdf.contentType ?? 'application/pdf',
      contentLength: pdf.contentLength,
      stream: pdf.stream,
    };
  }

  private async loadInvoiceForGeneration(invoiceId: string, tenantId: string) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, tenant_id: tenantId },
      select: {
        id: true,
        invoice_number: true,
        status: true,
        snapshot: true,
        pdf_storage_bucket: true,
        pdf_storage_key: true,
        pdf_generated_at: true,
        customer_id: true,
        workshop_order_id: true,
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
    await this.prisma.client.invoice.updateMany({
      where: { id: invoiceId, tenant_id: tenantId },
      data: {
        pdf_storage_bucket: upload.bucket,
        pdf_storage_key: upload.key,
        pdf_generated_at: generatedAt,
        pdf_generation_error: null,
      },
    });
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
