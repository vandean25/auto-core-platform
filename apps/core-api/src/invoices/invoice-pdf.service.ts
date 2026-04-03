import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import type { Readable } from 'node:stream';
import { PrismaService } from '../prisma/prisma.service';
import { buildInvoiceSnapshot, type InvoiceSnapshot } from './invoice-snapshot';
import { InvoicePdfRenderer } from './invoice-pdf.renderer';
import { InvoicePdfStorage } from './invoice-pdf.storage';

@Injectable()
export class InvoicePdfService {
  private readonly logger = new Logger(InvoicePdfService.name);

  constructor(
    private prisma: PrismaService,
    private renderer: InvoicePdfRenderer,
    private storage: InvoicePdfStorage,
  ) {}

  async generate(invoiceId: string): Promise<{
    invoiceId: string;
    bucket: string;
    key: string;
    generatedAt: Date;
  }> {
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
      },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    if (
      invoice.pdf_storage_key &&
      invoice.pdf_storage_bucket &&
      invoice.pdf_generated_at
    ) {
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

    try {
      const pdf = await this.renderer.render(snapshot);
      const upload = await this.storage.uploadPdf({
        key,
        body: pdf,
        contentType: 'application/pdf',
      });

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
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Invoice PDF generation failed (invoiceId=${invoiceId}): ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.safeStoreGenerationError(invoiceId, message);
      throw error;
    }
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

    const isString = (input: unknown): input is string => typeof input === 'string';
    const isNullableString = (input: unknown): input is string | null =>
      input === null || isString(input);
    const isNullableObject = (input: unknown): input is Record<string, unknown> =>
      !!input && typeof input === 'object';

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
    if (customer.type !== 'PRIVATE' && customer.type !== 'COMPANY') return false;
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
