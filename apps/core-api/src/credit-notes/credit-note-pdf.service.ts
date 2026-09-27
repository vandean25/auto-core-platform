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
  buildCreditNotePdfStorageCandidates,
  creditNotePdfObjectKey,
  readCachedCreditNotePdfMetadata,
  type CachedPdfMetadata,
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

    const cachedPdf = await this.resolveVerifiedCachedPdfMetadata(
      creditNoteId,
      tenantId,
      creditNote,
    );
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

        const cachedPdf = await this.resolveVerifiedCachedPdfMetadata(
          creditNoteId,
          tenantId,
          creditNote,
        );
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

        const key = creditNotePdfObjectKey(creditNoteId);

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
        pdf_generated_at: true,
      },
    });

    if (!creditNote) {
      throw new NotFoundException('Credit note not found');
    }

    const opened = await this.openCreditNotePdfStream(creditNoteId, creditNote);
    if (!opened) {
      throw new NotFoundException('Credit note PDF is not generated yet');
    }

    const cachedPdf = readCachedCreditNotePdfMetadata(creditNote);
    const needsMetadataBackfill =
      !cachedPdf ||
      cachedPdf.bucket !== opened.bucket ||
      cachedPdf.key !== opened.key;
    if (needsMetadataBackfill) {
      await this.backfillPdfMetadataFromStorage(
        creditNoteId,
        tenantId,
        opened.bucket,
        opened.key,
      );
    }

    const filename = `credit-note-${creditNote.credit_number ?? creditNote.id}.pdf`;
    return {
      filename,
      contentType: opened.contentType ?? 'application/pdf',
      contentLength: opened.contentLength,
      stream: opened.stream,
    };
  }

  private async resolveVerifiedCachedPdfMetadata(
    creditNoteId: string,
    tenantId: string,
    creditNote: {
      pdf_storage_bucket: string | null;
      pdf_storage_key: string | null;
      pdf_generated_at: Date | null;
    },
  ): Promise<CachedPdfMetadata | null> {
    const cachedPdf = readCachedCreditNotePdfMetadata(creditNote);
    if (!cachedPdf) {
      return null;
    }

    const opened = await this.tryOpenPdfStream(creditNoteId, creditNote, {
      bucket: cachedPdf.bucket,
      key: cachedPdf.key,
    });
    if (opened) {
      return cachedPdf;
    }

    await this.clearPdfStorageMetadata(creditNoteId, tenantId);
    return null;
  }

  private async openCreditNotePdfStream(
    creditNoteId: string,
    creditNote: {
      pdf_storage_bucket: string | null;
      pdf_storage_key: string | null;
      pdf_generated_at: Date | null;
    },
  ) {
    const candidates = buildCreditNotePdfStorageCandidates(
      creditNote,
      creditNoteId,
    );

    for (const candidate of candidates) {
      const opened = await this.tryOpenPdfStream(
        creditNoteId,
        creditNote,
        candidate,
      );
      if (opened) {
        return opened;
      }
    }

    return null;
  }

  private async tryOpenPdfStream(
    creditNoteId: string,
    creditNote: {
      pdf_storage_bucket: string | null;
      pdf_storage_key: string | null;
      pdf_generated_at: Date | null;
    },
    candidate: { bucket?: string; key: string },
  ) {
    try {
      return await this.storage.getPdfStream({
        bucket: candidate.bucket,
        key: candidate.key,
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        this.logger.debug(
          `Credit note PDF object missing (creditNoteId=${creditNoteId}, bucket=${candidate.bucket ?? 'default'}, key=${candidate.key}, pdfGeneratedAt=${creditNote.pdf_generated_at?.toISOString() ?? 'null'})`,
        );
        return null;
      }
      throw error;
    }
  }

  private async clearPdfStorageMetadata(
    creditNoteId: string,
    tenantId: string,
  ) {
    try {
      await this.prisma.client.creditNote.updateMany({
        where: { id: creditNoteId, tenant_id: tenantId },
        data: {
          pdf_storage_bucket: null,
          pdf_storage_key: null,
          pdf_generated_at: null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to clear stale credit note PDF metadata (creditNoteId=${creditNoteId}): ${message}`,
      );
    }
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
    const result = await this.prisma.client.creditNote.updateMany({
      where: { id: creditNoteId, tenant_id: tenantId },
      data: {
        pdf_storage_bucket: upload.bucket,
        pdf_storage_key: upload.key,
        pdf_generated_at: generatedAt,
        pdf_generation_error: null,
      },
    });

    if (result.count === 0) {
      throw new NotFoundException(
        `Credit note ${creditNoteId} was not found for PDF metadata persistence`,
      );
    }
  }

  private async backfillPdfMetadataFromStorage(
    creditNoteId: string,
    tenantId: string,
    bucket: string,
    key: string,
  ) {
    try {
      const generatedAt = new Date();
      await this.persistGeneratedPdf(
        creditNoteId,
        tenantId,
        { bucket, key },
        generatedAt,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to backfill credit note PDF metadata (creditNoteId=${creditNoteId}): ${message}`,
      );
    }
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
