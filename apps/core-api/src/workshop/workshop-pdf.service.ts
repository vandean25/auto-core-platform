import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Readable } from 'node:stream';
import * as Sentry from '@sentry/node';
import retry from 'async-retry';
import { PrismaService } from '../prisma/prisma.service';
import { WorkshopPdfRenderer } from './workshop-pdf.renderer';
import { CloudTasksService, PdfStorage } from '../common';
import { resolvePdfGenerationDispatch } from '../common/pdf/pdf-generation-dispatch';
import { TenantContextService } from '../common/services/tenant-context.service';

export type WorkshopPdfRequestGenerationResponse = {
  mode: 'cached' | 'enqueued' | 'generated';
  workshopOrderId: string;
  bucket: string | null;
  key: string | null;
  generatedAt: Date | null;
  taskId?: string;
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

    // Cache invalidation logic: if updated since generated, we regenerate it.
    // If we want it to be always living, we might just re-generate every time, but
    // since we use caching, we invalidate it if the order was updated AFTER generation
    // (with a small buffer in case generation timestamp was slightly before update).
    const isCacheValid =
      order.pdf_storage_key &&
      order.pdf_storage_bucket &&
      order.pdf_generated_at &&
      order.pdf_generated_at > new Date(order.updatedAt.getTime() - 2000);

    if (isCacheValid) {
      return {
        mode: 'cached',
        workshopOrderId: order.id,
        bucket: order.pdf_storage_bucket,
        key: order.pdf_storage_key,
        generatedAt: order.pdf_generated_at,
      };
    }

    const dispatch = resolvePdfGenerationDispatch({
      cloudTasksEnabled: this.cloudTasks.isEnabled(),
      targetBaseUrl: params.targetBaseUrl,
      nodeEnv: process.env.NODE_ENV,
    });

    if (dispatch === 'inline') {
      const generated = await this.generateNow(workshopOrderId, tenantId);
      return { mode: 'generated', ...generated };
    }

    try {
      await this.prisma.client.workshopOrder.updateMany({
        where: { id: workshopOrderId, tenant_id: tenantId },
        data: { pdf_generation_error: null },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to clear workshop order PDF generation error before enqueue: ${message}`,
      );
    }

    try {
      const { taskId } = await this.cloudTasks.enqueuePdfGeneration({
        kind: 'workshop-order',
        resourceId: workshopOrderId,
        tenantId: order.tenant_id,
        targetBaseUrl: params.targetBaseUrl,
      });
      return {
        mode: 'enqueued',
        workshopOrderId,
        bucket: null,
        key: null,
        generatedAt: null,
        taskId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to enqueue workshop order PDF task: ${message}`,
      );

      if (process.env.NODE_ENV !== 'production') {
        this.logger.warn(
          `Falling back to inline generation for workshop order ${workshopOrderId}`,
        );
        const generated = await this.generateNow(workshopOrderId, tenantId);
        return { mode: 'generated', ...generated };
      }

      await this.safeStoreGenerationError(
        workshopOrderId,
        'Failed to enqueue background PDF generation task. Please try again.',
        tenantId,
      );

      throw new InternalServerErrorException(
        'Failed to enqueue workshop order PDF generation task',
      );
    }
  }

  async generateNow(
    workshopOrderId: string,
    tenantId?: string,
  ): Promise<{
    workshopOrderId: string;
    bucket: string;
    key: string;
    generatedAt: Date;
  }> {
    return Sentry.startSpan(
      { name: 'Generate Workshop PDF', op: 'pdf.generate' },
      async (span) => {
        const resolvedTenantId =
          tenantId ?? (await this.tenantContext.getTenantId());
        span.setAttribute('workshopOrderId', workshopOrderId);
        const order = await this.prisma.client.workshopOrder.findFirst({
          where: { id: workshopOrderId, tenant_id: resolvedTenantId },
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

        const key = `workshop-orders/${workshopOrderId}.pdf`;

        let upload: { bucket: string; key: string; etag: string | null };
        try {
          upload = await retry(
            async (bail) => {
              try {
                const pdf = await this.renderer.render(order);
                return await this.storage.uploadPdf({
                  key,
                  body: pdf,
                  contentType: 'application/pdf',
                });
              } catch (error) {
                const maybeStatus = (
                  error as { status?: unknown } | null | undefined
                )?.status;
                const status =
                  typeof maybeStatus === 'number' ? maybeStatus : undefined;
                if (status && status >= 400 && status < 500) {
                  bail(
                    error instanceof Error ? error : new Error(String(error)),
                  );
                }
                throw error;
              }
            },
            {
              retries: 2,
              minTimeout: 1000,
              maxTimeout: 5000,
              onRetry: (error, attempt) => {
                const message =
                  error instanceof Error ? error.message : String(error);
                this.logger.warn(
                  `Workshop PDF generation attempt ${attempt} failed: ${message}`,
                );
              },
            },
          );

          const generatedAt = new Date();
          await this.prisma.client.workshopOrder.updateMany({
            where: { id: workshopOrderId, tenant_id: resolvedTenantId },
            data: {
              pdf_storage_bucket: upload.bucket,
              pdf_storage_key: upload.key,
              pdf_generated_at: generatedAt,
              pdf_generation_error: null,
            },
          });

          return {
            workshopOrderId,
            bucket: upload.bucket,
            key: upload.key,
            generatedAt,
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Workshop PDF generation exhausted all retries: ${message}`,
          );
          await this.safeStoreGenerationError(
            workshopOrderId,
            message,
            resolvedTenantId,
          );
          throw error;
        }
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

  private async safeStoreGenerationError(
    workshopOrderId: string,
    message: string,
    tenantId: string,
  ) {
    try {
      // Log full error for debugging; store only a user-safe summary in DB
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
