import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Readable } from 'node:stream';
import * as Sentry from '@sentry/node';
import { PrismaService } from '../prisma/prisma.service';
import { WorkshopPdfRenderer } from './workshop-pdf.renderer';
import { CloudTasksService, PdfStorage } from '../common';
import { enqueueOrGeneratePdf } from '../common/pdf/pdf-generation-dispatch';
import {
  renderAndUploadPdf,
  type PdfUploadResult,
} from '../common/pdf/pdf-render-upload';
import { TenantContextService } from '../common/services/tenant-context.service';
import { readCachedWorkshopPdfMetadata } from './workshop-pdf.generation';
import type { WorkshopOrderForPdf } from './workshop-pdf.types';

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

@Injectable()
export class WorkshopPdfService {
  private readonly logger = new Logger(WorkshopPdfService.name);

  constructor(
    private prisma: PrismaService,
    private renderer: WorkshopPdfRenderer,
    private storage: PdfStorage,
    private cloudTasks: CloudTasksService,
    private tenantContext: TenantContextService,
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
        updatedAt: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Workshop order not found');
    }

    const cached = readCachedWorkshopPdfMetadata(order);
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

        const order = await this.loadOrderForGeneration(
          workshopOrderId,
          resolvedTenantId,
        );

        return this.executeGeneration(order, resolvedTenantId);
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

  private async loadOrderForGeneration(
    workshopOrderId: string,
    tenantId: string,
  ): Promise<WorkshopOrderForPdf> {
    const order = await this.prisma.client.workshopOrder.findFirst({
      where: { id: workshopOrderId, tenant_id: tenantId },
      include: {
        customer: true,
        vehicle: true,
        tasks: {
          include: {
            line_items: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Workshop order not found');
    }

    return order;
  }

  private async executeGeneration(
    order: WorkshopOrderForPdf,
    tenantId: string,
  ): Promise<WorkshopPdfGeneratedResult> {
    const key = `workshop-orders/${order.id}.pdf`;

    try {
      const upload = await this.uploadRenderedPdf(order, key);
      const generatedAt = new Date();
      await this.persistGeneratedPdf(order.id, tenantId, upload, generatedAt);

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
  ): Promise<PdfUploadResult> {
    return renderAndUploadPdf({
      render: () => this.renderer.render(order),
      upload: (pdf) =>
        this.storage.uploadPdf({
          key,
          body: pdf,
          contentType: 'application/pdf',
        }),
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
  ): Promise<void> {
    await this.prisma.client.workshopOrder.updateMany({
      where: { id: workshopOrderId, tenant_id: tenantId },
      data: {
        pdf_storage_bucket: upload.bucket,
        pdf_storage_key: upload.key,
        pdf_generated_at: generatedAt,
        pdf_generation_error: null,
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
