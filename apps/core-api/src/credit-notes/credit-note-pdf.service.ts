import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Readable } from 'node:stream';
import * as Sentry from '@sentry/node';
import { PrismaService } from '../prisma/prisma.service.js';
import { InvoicePdfRenderer } from '../invoices/invoice-pdf.renderer.js';
import { CloudTasksService, PdfStorage } from '../common/index.js';
import { enqueueOrGeneratePdf } from '../common/pdf/pdf-generation-dispatch.js';
import { renderAndUploadPdf } from '../common/pdf/pdf-render-upload.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { toRenderableCreditNoteSnapshot } from './credit-note-snapshot-render.adapter.js';
import {
  assertCreditNotePdfGenerationAllowed,
  readCachedCreditNotePdfMetadata,
} from './credit-note-pdf.generation.js';

export type CreditNotePdfRequestGenerationResponse = {
  mode: 'cached' | 'enqueued' | 'generated';
  creditNoteId: string;
  bucket: string | null;
  key: string | null;
  generatedAt: Date | null;
  taskId?: string;
};

@Injectable()
export class CreditNotePdfService {
  private readonly logger = new Logger(CreditNotePdfService.name);

  constructor(
    private prisma: PrismaService,
    private renderer: InvoicePdfRenderer,
    private storage: PdfStorage,
    private cloudTasks: CloudTasksService,
    private tenantContext: TenantContextService,
  ) {}

  async requestGeneration(
    creditNoteId: string,
    params: { targetBaseUrl: string },
  ): Promise<CreditNotePdfRequestGenerationResponse> {
    const tenantId = await this.tenantContext.getTenantId();
    const creditNote = await this.prisma.client.creditNote.findFirst({
      where: { id: creditNoteId, tenant_id: tenantId },
      select: {
        id: true,
        status: true,
        credit_number: true,
        pdf_storage_bucket: true,
        pdf_storage_key: true,
        pdf_generated_at: true,
      },
    });

    if (!creditNote) {
      throw new NotFoundException('Credit note not found');
    }

    const cachedPdf = readCachedCreditNotePdfMetadata(creditNote);
    if (cachedPdf) {
      return {
        mode: 'cached',
        creditNoteId: creditNote.id,
        bucket: cachedPdf.bucket,
        key: cachedPdf.key,
        generatedAt: cachedPdf.generatedAt,
      };
    }

    assertCreditNotePdfGenerationAllowed(creditNote.status);

    const outcome = await enqueueOrGeneratePdf({
      kind: 'credit-note',
      resourceId: creditNoteId,
      resourceName: 'credit note',
      tenantId,
      targetBaseUrl: params.targetBaseUrl,
      cloudTasks: this.cloudTasks,
      nodeEnv: process.env.NODE_ENV,
      logger: this.logger,
      clearError: () =>
        this.prisma.client.creditNote
          .updateMany({
            where: { id: creditNoteId, tenant_id: tenantId },
            data: { pdf_generation_error: null },
          })
          .then(() => {}),
      generateInline: () => this.generateNow(creditNoteId),
      storeEnqueueError: (msg) =>
        this.safeStoreGenerationError(creditNoteId, msg, tenantId),
      onEnqueueError: (error) => {
        Sentry.captureException(error, {
          tags: { creditNoteId, operation: 'cloudtasks.enqueuePdfGeneration' },
        });
      },
    });

    if (outcome.mode === 'enqueued') {
      return {
        mode: 'enqueued',
        creditNoteId,
        bucket: null,
        key: null,
        generatedAt: null,
        taskId: outcome.taskId,
      };
    }

    return { mode: 'generated', ...outcome.result };
  }

  async generateNow(creditNoteId: string): Promise<{
    creditNoteId: string;
    bucket: string;
    key: string;
    generatedAt: Date;
  }> {
    return Sentry.startSpan(
      { name: 'Generate Credit Note PDF', op: 'pdf.generate' },
      async (span) => {
        span.setAttribute('creditNoteId', creditNoteId);
        const tenantId = await this.tenantContext.getTenantId();
        const creditNote = await this.loadCreditNoteForGeneration(
          creditNoteId,
          tenantId,
        );

        const cachedPdf = readCachedCreditNotePdfMetadata(creditNote);
        if (cachedPdf) {
          return {
            creditNoteId: creditNote.id,
            bucket: cachedPdf.bucket,
            key: cachedPdf.key,
            generatedAt: cachedPdf.generatedAt,
          };
        }

        assertCreditNotePdfGenerationAllowed(creditNote.status);

        const snapshot = toRenderableCreditNoteSnapshot(
          creditNote.snapshot,
          creditNote.credit_number,
          creditNote.id,
        );
        if (!snapshot) {
          throw new NotFoundException(
            'Credit note snapshot is not available for rendering.',
          );
        }

        const key = `credit-notes/${creditNoteId}.pdf`;

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
                `Credit note PDF generation attempt ${attempt} failed: ${message}`,
              );
            },
          });

          const generatedAt = new Date();
          await this.persistGeneratedPdf(
            creditNoteId,
            tenantId,
            upload,
            generatedAt,
          );

          return {
            creditNoteId,
            bucket: upload.bucket,
            key: upload.key,
            generatedAt,
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Credit note PDF generation exhausted all retries (creditNoteId=${creditNoteId}): ${message}`,
            error instanceof Error ? error.stack : undefined,
          );

          Sentry.captureException(error, {
            tags: { creditNoteId, operation: 'pdf.generate' },
          });

          await this.safeStoreGenerationError(creditNoteId, message, tenantId);
          throw error;
        }
      },
    );
  }

  async getPdf(creditNoteId: string): Promise<{
    filename: string;
    contentType: string;
    contentLength: number | null;
    stream: Readable;
  }> {
    const tenantId = await this.tenantContext.getTenantId();
    const creditNote = await this.prisma.client.creditNote.findFirst({
      where: { id: creditNoteId, tenant_id: tenantId },
      select: {
        id: true,
        credit_number: true,
        pdf_storage_bucket: true,
        pdf_storage_key: true,
      },
    });

    if (!creditNote) {
      throw new NotFoundException('Credit note not found');
    }

    if (!creditNote.pdf_storage_key) {
      throw new NotFoundException('Credit note PDF is not generated yet');
    }

    const pdf = await this.storage.getPdfStream({
      bucket: creditNote.pdf_storage_bucket ?? undefined,
      key: creditNote.pdf_storage_key,
    });
    const filename = `credit-note-${creditNote.credit_number ?? creditNote.id}.pdf`;
    return {
      filename,
      contentType: pdf.contentType ?? 'application/pdf',
      stream: pdf.stream,
      contentLength: pdf.contentLength,
    };
  }

  private async loadCreditNoteForGeneration(
    creditNoteId: string,
    tenantId: string,
  ) {
    const creditNote = await this.prisma.client.creditNote.findFirst({
      where: { id: creditNoteId, tenant_id: tenantId },
      select: {
        id: true,
        status: true,
        credit_number: true,
        snapshot: true,
        pdf_storage_bucket: true,
        pdf_storage_key: true,
        pdf_generated_at: true,
      },
    });

    if (!creditNote) {
      throw new NotFoundException('Credit note not found');
    }

    return creditNote;
  }

  private async persistGeneratedPdf(
    creditNoteId: string,
    tenantId: string,
    upload: { bucket: string; key: string },
    generatedAt: Date,
  ) {
    await this.prisma.client.creditNote.updateMany({
      where: { id: creditNoteId, tenant_id: tenantId },
      data: {
        pdf_storage_bucket: upload.bucket,
        pdf_storage_key: upload.key,
        pdf_generated_at: generatedAt,
        pdf_generation_error: null,
      },
    });
  }

  private async safeStoreGenerationError(
    creditNoteId: string,
    message: string,
    tenantId: string,
  ) {
    try {
      await this.prisma.client.creditNote.updateMany({
        where: { id: creditNoteId, tenant_id: tenantId },
        data: {
          pdf_generation_error: message.slice(0, 2000),
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to store credit note PDF generation error (creditNoteId=${creditNoteId}): ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
