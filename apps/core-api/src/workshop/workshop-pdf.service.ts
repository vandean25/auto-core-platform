import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { WorkshopCheckInStatus, type DisplayLanguage } from '@prisma/client';
import type { Readable } from 'node:stream';
import * as Sentry from '@sentry/node';
import { PrismaService } from '../prisma/prisma.service.js';
import { WorkshopPdfRenderer } from './workshop-pdf.renderer.js';
import { CloudTasksService, PdfStorage } from '../common/index.js';
import { enqueueOrGeneratePdf } from '../common/pdf/pdf-generation-dispatch.js';
import {
  renderAndUploadPdf,
  type PdfUploadResult,
} from '../common/pdf/pdf-render-upload.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { MechanicMediaStorage } from '../mechanic/mechanic-media.storage.js';
import { readCachedWorkshopPdfMetadata } from './workshop-pdf.generation.js';
import type { WorkshopOrderForPdf } from './workshop-pdf.types.js';
import { buildWorkshopOrderPdfRenderInput } from './workshop-order-pdf-render-input.js';
import { resolveWorkshopOrderPdfRenderContext } from './workshop-pdf-render-context.js';
import type { PdfRenderMode } from '../common/i18n/pdf-render-mode.js';
import type { WorkshopCheckInEvidenceSnapshot } from './workshop-check-in-evidence-snapshot.js';
import { embedWorkshopCheckInPdfMedia } from './workshop-pdf-check-in.assets.js';
import {
  persistWorkshopCheckInEvidencePdfArchiveRecord,
  uploadWorkshopCheckInEvidencePdfArchiveObject,
} from './workshop-pdf-check-in-archive.js';

export type WorkshopPdfRequestGenerationResponse = {
  mode: 'cached' | 'enqueued' | 'generated';
  workshopOrderId: string;
  bucket: string | null;
  key: string | null;
  generatedAt: Date | null;
  taskId?: string;
};

export type WorkshopPdfGeneratedResult = {
  workshopOrderId: string;
  bucket: string;
  key: string;
  generatedAt: Date;
};

type OrderRowForPdfGeneration = {
  id: string;
  order_number: string;
  status: string;
  odometer: number;
  fuel_level: number;
  reported_issue: string | null;
  notes: string | null;
  pdf_render_input: unknown;
  customer: WorkshopOrderForPdf['customer'];
  vehicle: WorkshopOrderForPdf['vehicle'];
  tasks: WorkshopOrderForPdf['tasks'];
  check_in: {
    id: string;
    status: WorkshopCheckInStatus;
    snapshot_json: unknown;
    content_sha256: string | null;
    pdf_sha256: string | null;
  } | null;
};

@Injectable()
export class WorkshopPdfService {
  private readonly logger = new Logger(WorkshopPdfService.name);

  constructor(
    private prisma: PrismaService,
    private renderer: WorkshopPdfRenderer,
    private storage: PdfStorage,
    private cloudTasks: CloudTasksService,
    private tenantContext: TenantContextService,
    private mediaStorage: MechanicMediaStorage,
  ) {}

  async requestGeneration(
    workshopOrderId: string,
    params: { targetBaseUrl: string },
  ): Promise<WorkshopPdfRequestGenerationResponse> {
    const tenantId = await this.tenantContext.getTenantId();
    const order = await this.prisma.client.workshopOrder.findFirst({
      where: { id: workshopOrderId, tenant_id: tenantId },
      select: {
        id: true,
        tenant_id: true,
        pdf_storage_bucket: true,
        pdf_storage_key: true,
        pdf_generated_at: true,
        pdf_render_input: true,
        updatedAt: true,
        check_in: {
          select: {
            status: true,
            content_sha256: true,
            completed_at: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Workshop order not found');
    }

    const cacheContext = this.buildPdfCacheContext(order.check_in);
    const cached = readCachedWorkshopPdfMetadata(order, cacheContext);
    if (cached) {
      return {
        mode: 'cached',
        workshopOrderId: order.id,
        bucket: cached.bucket,
        key: cached.key,
        generatedAt: cached.generatedAt,
      };
    }

    const outcome = await enqueueOrGeneratePdf({
      kind: 'workshop-order',
      resourceId: workshopOrderId,
      resourceName: 'workshop order',
      tenantId: order.tenant_id,
      targetBaseUrl: params.targetBaseUrl,
      cloudTasks: this.cloudTasks,
      nodeEnv: process.env.NODE_ENV,
      logger: this.logger,
      clearError: () => this.clearGenerationError(workshopOrderId, tenantId),
      generateInline: () => this.generateNow(workshopOrderId, tenantId),
      storeEnqueueError: (msg) =>
        this.safeStoreGenerationError(workshopOrderId, msg, tenantId),
    });

    if (outcome.mode === 'enqueued') {
      return {
        mode: 'enqueued',
        workshopOrderId,
        bucket: null,
        key: null,
        generatedAt: null,
        taskId: outcome.taskId,
      };
    }

    return { mode: 'generated', ...outcome.result };
  }

  async generateNow(
    workshopOrderId: string,
    tenantId?: string,
  ): Promise<WorkshopPdfGeneratedResult> {
    return Sentry.startSpan(
      { name: 'Generate Workshop PDF', op: 'pdf.generate' },
      async (span) => {
        const resolvedTenantId =
          tenantId ?? (await this.tenantContext.getTenantId());
        span.setAttribute('workshopOrderId', workshopOrderId);

        const loaded = await this.loadOrderForGeneration(
          workshopOrderId,
          resolvedTenantId,
        );

        return this.executeGeneration(
          loaded.order,
          resolvedTenantId,
          loaded.existingRenderInput,
        );
      },
    );
  }

  async getPdf(workshopOrderId: string): Promise<{
    filename: string;
    contentType: string;
    contentLength: number | null;
    stream: Readable;
  }> {
    const tenantId = await this.tenantContext.getTenantId();
    const order = await this.prisma.client.workshopOrder.findFirst({
      where: { id: workshopOrderId, tenant_id: tenantId },
      select: {
        id: true,
        order_number: true,
        pdf_storage_bucket: true,
        pdf_storage_key: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Workshop order not found');
    }

    if (!order.pdf_storage_key) {
      throw new NotFoundException('Workshop PDF is not generated yet');
    }

    const pdf = await this.storage.getPdfStream({
      bucket: order.pdf_storage_bucket ?? undefined,
      key: order.pdf_storage_key,
    });
    const filename = `job-card-${order.order_number ?? order.id}.pdf`;
    return {
      filename,
      contentType: pdf.contentType ?? 'application/pdf',
      contentLength: pdf.contentLength,
      stream: pdf.stream,
    };
  }

  private buildPdfCacheContext(
    checkIn:
      | {
          status: WorkshopCheckInStatus;
          content_sha256: string | null;
          completed_at: Date | null;
        }
      | null
      | undefined,
  ) {
    if (!checkIn || checkIn.status !== WorkshopCheckInStatus.COMPLETED) {
      return {
        checkInContentSha256: null,
        checkInCompletedAt: null,
      };
    }
    return {
      checkInContentSha256: checkIn.content_sha256,
      checkInCompletedAt: checkIn.completed_at,
    };
  }

  private async loadOrderForGeneration(
    workshopOrderId: string,
    tenantId: string,
  ): Promise<{
    order: WorkshopOrderForPdf;
    existingRenderInput: unknown;
  }> {
    const order = await this.prisma.client.workshopOrder.findFirst({
      where: { id: workshopOrderId, tenant_id: tenantId },
      select: {
        id: true,
        order_number: true,
        status: true,
        odometer: true,
        fuel_level: true,
        reported_issue: true,
        notes: true,
        pdf_render_input: true,
        customer: true,
        vehicle: true,
        tasks: {
          include: {
            line_items: true,
          },
        },
        check_in: {
          select: {
            id: true,
            status: true,
            snapshot_json: true,
            content_sha256: true,
            pdf_sha256: true,
          },
        },
      } as const,
    });

    if (!order) {
      throw new NotFoundException('Workshop order not found');
    }

    return {
      order: await this.prepareOrderForPdfRender(order, tenantId),
      existingRenderInput: order.pdf_render_input,
    };
  }

  private async prepareOrderForPdfRender(
    order: OrderRowForPdfGeneration,
    tenantId: string,
  ): Promise<WorkshopOrderForPdf> {
    const base: WorkshopOrderForPdf = {
      id: order.id,
      order_number: order.order_number,
      status: order.status,
      odometer: order.odometer,
      fuel_level: order.fuel_level,
      reported_issue: order.reported_issue,
      notes: order.notes,
      customer: order.customer,
      vehicle: order.vehicle,
      tasks: order.tasks,
      check_in: null,
    };

    const checkIn = order.check_in;
    if (
      !checkIn ||
      checkIn.status !== WorkshopCheckInStatus.COMPLETED ||
      !checkIn.snapshot_json ||
      !checkIn.content_sha256
    ) {
      return base;
    }

    const snapshot = checkIn.snapshot_json as WorkshopCheckInEvidenceSnapshot;
    const embedded = await embedWorkshopCheckInPdfMedia(
      {
        mediaStorage: this.mediaStorage,
        prisma: this.prisma.client,
        tenantId,
        checkInId: checkIn.id,
      },
      snapshot,
    );

    return {
      ...base,
      check_in: {
        id: checkIn.id,
        content_sha256: checkIn.content_sha256,
        pdf_sha256: checkIn.pdf_sha256,
        snapshot,
        embedded,
      },
    };
  }

  private async executeGeneration(
    order: WorkshopOrderForPdf,
    tenantId: string,
    existingRenderInput: unknown,
  ): Promise<WorkshopPdfGeneratedResult> {
    const key = `workshop-orders/${order.id}.pdf`;

    try {
      const { documentLocale, mode: renderMode } =
        await resolveWorkshopOrderPdfRenderContext(
          this.prisma.client,
          tenantId,
          order,
          existingRenderInput,
        );
      let renderedPdf: Buffer | null = null;
      const upload = await this.uploadRenderedPdf(
        order,
        key,
        documentLocale,
        renderMode,
        (pdf) => {
          renderedPdf = pdf;
        },
      );
      if (!renderedPdf) {
        throw new Error('Workshop PDF render did not produce bytes');
      }
      const finalPdfBytes = renderedPdf;

      const generatedAt = new Date();
      const renderInput = buildWorkshopOrderPdfRenderInput({
        workshopOrderId: order.id,
        orderNumber: order.order_number,
        frozenAt: generatedAt,
        documentLocale,
        checkInContentSha256: order.check_in?.content_sha256 ?? null,
      });

      const needsCheckInArchive = order.check_in && !order.check_in.pdf_sha256;
      if (needsCheckInArchive) {
        const archive = await uploadWorkshopCheckInEvidencePdfArchiveObject({
          storage: this.storage,
          tenantId,
          checkInId: order.check_in!.id,
          workshopOrderId: order.id,
          contentSha256: order.check_in!.content_sha256,
          pdfBytes: finalPdfBytes,
          bucket: upload.bucket,
        });
        await this.prisma.$transaction(async (tx) => {
          await persistWorkshopCheckInEvidencePdfArchiveRecord(tx, {
            tenantId,
            checkInId: order.check_in!.id,
            storageBucket: upload.bucket,
            storageKey: archive.key,
            pdfSha256: archive.sha256,
            generatedAt,
          });
        });
      }

      await this.persistGeneratedPdf(
        order.id,
        tenantId,
        upload,
        generatedAt,
        renderInput,
      );

      return {
        workshopOrderId: order.id,
        bucket: upload.bucket,
        key: upload.key,
        generatedAt,
      };
    } catch (error) {
      await this.handleGenerationError(order.id, tenantId, error);
      throw error;
    }
  }

  private async uploadRenderedPdf(
    order: WorkshopOrderForPdf,
    key: string,
    documentLocale: DisplayLanguage,
    renderMode: PdfRenderMode,
    onRendered?: (pdf: Buffer) => void,
  ): Promise<PdfUploadResult> {
    return renderAndUploadPdf({
      render: () => this.renderer.render(order, { documentLocale, renderMode }),
      upload: (pdf) => {
        onRendered?.(pdf);
        return this.storage.uploadPdf({
          key,
          body: pdf,
          contentType: 'application/pdf',
        });
      },
      onRetry: (error, attempt) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Workshop PDF generation attempt ${attempt} failed: ${message}`,
        );
      },
    });
  }

  private async persistGeneratedPdf(
    workshopOrderId: string,
    tenantId: string,
    upload: Pick<PdfUploadResult, 'bucket' | 'key'>,
    generatedAt: Date,
    renderInput: ReturnType<typeof buildWorkshopOrderPdfRenderInput>,
  ): Promise<void> {
    await this.prisma.client.workshopOrder.updateMany({
      where: { id: workshopOrderId, tenant_id: tenantId },
      data: {
        pdf_storage_bucket: upload.bucket,
        pdf_storage_key: upload.key,
        pdf_generated_at: generatedAt,
        pdf_generation_error: null,
        pdf_render_input: renderInput,
      },
    });
  }

  private async handleGenerationError(
    workshopOrderId: string,
    tenantId: string,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(
      `Workshop PDF generation exhausted all retries: ${message}`,
      error instanceof Error ? error.stack : undefined,
    );
    await this.safeStoreGenerationError(workshopOrderId, message, tenantId);
  }

  private async clearGenerationError(
    workshopOrderId: string,
    tenantId: string,
  ): Promise<void> {
    await this.prisma.client.workshopOrder.updateMany({
      where: { id: workshopOrderId, tenant_id: tenantId },
      data: { pdf_generation_error: null },
    });
  }

  private async safeStoreGenerationError(
    workshopOrderId: string,
    message: string,
    tenantId: string,
  ): Promise<void> {
    try {
      this.logger.error(
        `Workshop PDF generation error for ${workshopOrderId}: ${message}`,
      );
      const safeMessage =
        'PDF generation failed. Please try again or contact support.';
      await this.prisma.client.workshopOrder.updateMany({
        where: { id: workshopOrderId, tenant_id: tenantId },
        data: {
          pdf_generation_error: safeMessage,
        },
      });
    } catch {
      this.logger.error(
        `Failed to store workshop PDF error for ${workshopOrderId}`,
      );
    }
  }
}
