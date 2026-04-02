import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
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
    const invoiceNumber = snapshot.invoice_number ?? snapshot.id;
    const key = `invoices/${invoiceNumber}.pdf`;

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
        `Invoice PDF generation failed (invoiceId=${invoiceId})`,
        error,
      );
      await this.safeStoreGenerationError(invoiceId, message);
      throw error;
    }
  }

  async getPdf(invoiceId: string): Promise<{
    filename: string;
    contentType: string;
    contentLength: number | null;
    stream: NodeJS.ReadableStream;
  }> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        invoice_number: true,
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
    if (existingSnapshot && typeof existingSnapshot === 'object') {
      return existingSnapshot as InvoiceSnapshot;
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

  private async safeStoreGenerationError(invoiceId: string, message: string) {
    try {
      await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          pdf_generation_error: message.slice(0, 2000),
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to store invoice PDF generation error (invoiceId=${invoiceId})`,
        error,
      );
    }
  }
}
