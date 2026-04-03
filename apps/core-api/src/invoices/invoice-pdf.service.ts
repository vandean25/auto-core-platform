import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import type { Readable } from 'node:stream';
import * as Sentry from '@sentry/node';
import retry from 'async-retry';
import { PrismaService } from '../prisma/prisma.service';
import { buildInvoiceSnapshot, type InvoiceSnapshot } from './invoice-snapshot';
import { InvoicePdfRenderer } from './invoice-pdf.renderer';
import { InvoicePdfStorage } from './invoice-pdf.storage';
import { CloudTasksService } from '../common';

@Injectable()
export class InvoicePdfService {
  private readonly logger = new Logger(InvoicePdfService.name);

  constructor(
    private prisma: PrismaService,
    private renderer: InvoicePdfRenderer,
    private storage: InvoicePdfStorage,
    private cloudTasks: CloudTasksService,
  ) {}

  async generate(invoiceId: string): Promise<{
    invoiceId: string;
    bucket: string;
    key: string;
    generatedAt: Date;
  }> {
    return Sentry.startSpan(
      { name: 'Generate Invoice PDF', op: 'pdf.generate' },
      async (span) => {
        span.setAttribute('invoiceId', invoiceId);
        const invoice = await this.prisma.invoice.findUnique({
          where: { id: invoiceId },
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

        span.setAttribute('customerId', invoice.customer_id);
        if (invoice.workshop_order_id) {
          span.setAttribute('workshopOrderId', invoice.workshop_order_id);
        }

        if (
          invoice.pdf_storage_key &&
          invoice.pdf_storage_bucket &&
          invoice.pdf_generated_at
        ) {
          Sentry.addBreadcrumb({
            message: 'Invoice PDF cache hit',
            category: 'pdf',
            data: {
              bucket: invoice.pdf_storage_bucket,
              key: invoice.pdf_storage_key,
            },
          });
          return {
            invoiceId: invoice.id,
            bucket: invoice.pdf_storage_bucket,
            key: invoice.pdf_storage_key,
            generatedAt: invoice.pdf_generated_at,
          };
        }

        if (
          invoice.status !== InvoiceStatus.ISSUED &&
          invoice.status !== InvoiceStatus.PAID
        ) {
          throw new BadRequestException(
            'Invoice PDF can only be generated for ISSUED/PAID invoices',
          );
        }

        const snapshot = await this.getOrCreateSnapshot(
          invoiceId,
          invoice.snapshot,
        );
        const key = `invoices/${invoiceId}.pdf`;

        let upload: { bucket: string; key: string };
        try {
          upload = await retry(
            async (bail) => {
              try {
                const pdf = await this.renderer.render(snapshot);
                return await this.storage.uploadPdf({
                  key,
                  body: pdf,
                  contentType: 'application/pdf',
                });
              } catch (error) {
                // Don't retry if the error is a 4xx client error
                const status = (error as any)?.status;
                if (status && status >= 400 && status < 500) {
                  bail(error instanceof Error ? error : new Error(String(error)));
                  return;
                }
                throw error;
              }
            },
            {
              retries: 2, // 3 attempts total (1 initial + 2 retries)
              minTimeout: 1000,
              maxTimeout: 5000,
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
            },
          );

          const generatedAt = new Date();
          await this.prisma.invoice.update({
            where: { id: invoiceId },
            data: {
              pdf_storage_bucket: upload.bucket,
              pdf_storage_key: upload.key,
              pdf_generated_at: generatedAt,
              pdf_generation_error: null,
            },
          });

          return { invoiceId, bucket: upload.bucket, key: upload.key, generatedAt };
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

          await this.safeStoreGenerationError(invoiceId, message);

          // Enqueue for offline retry via Cloud Tasks
          try {
            await this.cloudTasks.enqueuePdfGeneration(invoiceId, 0);
          } catch (enqueueError) {
            const enqueueMessage = enqueueError instanceof Error ? enqueueError.message : String(enqueueError);
            this.logger.error(
              `Failed to enqueue Cloud Task for invoice ${invoiceId}: ${enqueueMessage}`,
              enqueueError instanceof Error ? enqueueError.stack : undefined,
            );
            Sentry.captureException(enqueueError, {
              level: 'fatal',
              tags: { invoiceId, operation: 'enqueue_cloud_task' }
            });
          }

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
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
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

  private async getOrCreateSnapshot(
    invoiceId: string,
    existingSnapshot: unknown,
  ): Promise<InvoiceSnapshot> {
    if (this.isInvoiceSnapshot(existingSnapshot)) {
      return existingSnapshot;
    }

    const fullInvoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        items: { orderBy: { createdAt: 'asc' } },
        customer: true,
        vehicle: true,
      },
    });

    if (!fullInvoice) {
      throw new NotFoundException('Invoice not found');
    }

    const snapshot = buildInvoiceSnapshot(fullInvoice);
    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { snapshot },
    });
    return snapshot;
  }

  private isInvoiceSnapshot(value: unknown): value is InvoiceSnapshot {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const v = value as Partial<InvoiceSnapshot>;

    const isString = (input: unknown): input is string =>
      typeof input === 'string';
    const isNullableString = (input: unknown): input is string | null =>
      input === null || isString(input);
    const isNullableObject = (
      input: unknown,
    ): input is Record<string, unknown> => !!input && typeof input === 'object';

    if (!isString(v.id)) return false;
    if (!isNullableString(v.invoice_number)) return false;
    if (!isString(v.date)) return false;
    if (!isString(v.due_date)) return false;
    if (!isString(v.total_net)) return false;
    if (!isString(v.total_tax)) return false;
    if (!isString(v.total_gross)) return false;
    if (!isNullableString(v.notes)) return false;

    if (!isNullableObject(v.customer)) return false;
    const customer = v.customer as Record<string, unknown>;
    if (customer.type !== 'PRIVATE' && customer.type !== 'COMPANY')
      return false;
    if (!isNullableString(customer.company_name)) return false;
    if (!isString(customer.first_name)) return false;
    if (!isString(customer.last_name)) return false;
    if (!isNullableString(customer.email)) return false;
    if (!isNullableString(customer.phone)) return false;
    if (!isNullableString(customer.vat_id)) return false;
    if (!isNullableString(customer.address_street)) return false;
    if (!isNullableString(customer.address_city)) return false;
    if (!isNullableString(customer.address_zip)) return false;
    if (!isNullableString(customer.address_country)) return false;

    if (v.vehicle !== null) {
      if (!isNullableObject(v.vehicle)) return false;
      const vehicle = v.vehicle as Record<string, unknown>;
      if (!isString(vehicle.make)) return false;
      if (!isString(vehicle.model)) return false;
      if (typeof vehicle.year !== 'number') return false;
      if (!isNullableString(vehicle.engine_code)) return false;
      if (!isNullableString(vehicle.vin)) return false;
      if (!isNullableString(vehicle.plate)) return false;
    }

    if (!Array.isArray(v.items)) return false;
    if (
      !v.items.every((item) => {
        if (!isNullableObject(item)) return false;
        const i = item as Record<string, unknown>;
        if (!isString(i.description)) return false;
        if (!isString(i.quantity)) return false;
        if (!isString(i.unit_price)) return false;
        if (!isString(i.tax_rate)) return false;
        if (!isNullableString(i.line_discount_type)) return false;
        if (!isNullableString(i.line_discount_value)) return false;
        if (!isNullableString(i.line_total)) return false;
        if (!isNullableString(i.revenue_group_name)) return false;
        return true;
      })
    ) {
      return false;
    }

    if (!isString(v.snapshot_created_at)) return false;

    return true;
  }

  private async safeStoreGenerationError(invoiceId: string, message: string) {
    try {
      await this.prisma.invoice.update({
        where: { id: invoiceId },
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
