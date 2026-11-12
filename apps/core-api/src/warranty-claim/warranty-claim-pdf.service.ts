import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { WarrantyClaimType } from '@prisma/client';
import * as Sentry from '@sentry/node';
import { CloudTasksService, PdfStorage } from '../common/index.js';
import { enqueueOrGeneratePdf } from '../common/pdf/pdf-generation-dispatch.js';
import { resolvePdfStorageBucket } from '../common/pdf/pdf-bucket.js';
import { renderAndUploadPdf } from '../common/pdf/pdf-render-upload.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { DocumentBrandingAssetStorage } from '../document-branding/document-branding-asset-storage.js';
import { brandRenderInputUnavailable } from '../invoices/invoice-pdf-branding.helpers.js';
import { resolveBrandingSnapshot } from '../invoices/invoice-snapshot-v2.helpers.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { toWarrantyClaimResponse } from './warranty-claim.mapper.js';
import type { WarrantyClaimPdfContent } from './warranty-claim-pdf.layout.js';
import {
  clearWarrantyClaimPdfArchiveData,
  isWarrantyClaimPdfArchiveStale,
  readCachedWarrantyClaimPdfMetadata,
  warrantyClaimPdfObjectKey,
  type CachedWarrantyClaimPdfMetadata,
} from './warranty-claim-pdf.generation.js';
import { WarrantyClaimPdfRenderer } from './warranty-claim-pdf.renderer.js';
import { assertWarrantyClaimAccess } from './warranty-claim.rules.js';

type ResolvedBranding = Awaited<ReturnType<typeof resolveBrandingSnapshot>>;

const LOGO_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
]);

const TYPE_FILE_SLUGS: Record<WarrantyClaimType, string> = {
  GARANTIE: 'garantie',
  KULANZ: 'kulanz',
  GEWAEHRLEISTUNG: 'gewaehrleistung',
};

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'order'
  );
}

export type WarrantyClaimPdfRequestResponse =
  | {
      mode: 'cached' | 'generated';
      claimId: string;
      bucket: string;
      key: string;
      generatedAt: Date;
    }
  | { mode: 'enqueued'; claimId: string; taskId: string };

export type WarrantyClaimPdfGenerated = {
  claimId: string;
  bucket: string;
  key: string;
  generatedAt: Date;
};

@Injectable()
export class WarrantyClaimPdfService {
  private readonly logger = new Logger(WarrantyClaimPdfService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly renderer: WarrantyClaimPdfRenderer,
    private readonly brandingStorage: DocumentBrandingAssetStorage,
    private readonly storage: PdfStorage,
    private readonly cloudTasks: CloudTasksService,
  ) {}

  async requestGeneration(
    orderId: string,
    claimId: string,
    params: { targetBaseUrl: string },
  ): Promise<WarrantyClaimPdfRequestResponse> {
    await this.assertClaimScope(orderId, claimId);

    const { tenantId, claim } = await this.loadClaimPdfRow(orderId, claimId);
    const cached = await this.resolveVerifiedCachedPdf(
      claimId,
      tenantId,
      claim,
    );
    if (cached) {
      return {
        mode: 'cached',
        claimId,
        bucket: cached.bucket,
        key: cached.key,
        generatedAt: cached.generatedAt,
      };
    }

    const workerRelativePath = `workshop/orders/${orderId}/warranty-claims/${claimId}/pdf/worker`;
    const outcome = await enqueueOrGeneratePdf({
      kind: 'warranty-claim',
      resourceId: claimId,
      resourceName: 'warranty claim',
      tenantId,
      targetBaseUrl: params.targetBaseUrl,
      workerRelativePath,
      cloudTasks: this.cloudTasks,
      nodeEnv: process.env.NODE_ENV,
      logger: this.logger,
      clearError: () => this.clearGenerationError(orderId, claimId, tenantId),
      generateInline: () => this.generateNow(orderId, claimId),
      storeEnqueueError: (message) =>
        this.safeStoreGenerationError(orderId, claimId, message, tenantId),
      onEnqueueError: (error) => {
        Sentry.captureException(error, {
          tags: {
            claimId,
            workshopOrderId: orderId,
            operation: 'cloudtasks.enqueuePdfGeneration',
          },
        });
      },
    });

    if (outcome.mode === 'enqueued') {
      return { mode: 'enqueued', claimId, taskId: outcome.taskId };
    }

    return { mode: 'generated', ...outcome.result };
  }

  async generateNow(
    orderId: string,
    claimId: string,
  ): Promise<WarrantyClaimPdfGenerated> {
    return Sentry.startSpan(
      { name: 'Generate warranty claim PDF', op: 'pdf.generate' },
      async (span) => {
        span.setAttribute('claimId', claimId);
        span.setAttribute('workshopOrderId', orderId);

        const { tenantId, claim } = await this.loadClaimPdfRow(
          orderId,
          claimId,
        );
        const cached = await this.resolveVerifiedCachedPdf(
          claimId,
          tenantId,
          claim,
        );
        if (cached) {
          return {
            claimId,
            bucket: cached.bucket,
            key: cached.key,
            generatedAt: cached.generatedAt,
          };
        }

        const content = await this.buildPdfContent(orderId, claimId);
        const key = warrantyClaimPdfObjectKey(claimId);

        try {
          const upload = await renderAndUploadPdf({
            render: () => this.renderer.render(content),
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
                `Warranty claim PDF generation attempt ${attempt} failed (claimId=${claimId}): ${message}`,
              );
            },
          });

          const generatedAt = new Date();
          await this.persistGeneratedPdf(
            orderId,
            claimId,
            tenantId,
            upload,
            generatedAt,
          );

          return {
            claimId,
            bucket: upload.bucket,
            key: upload.key,
            generatedAt,
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Warranty claim PDF generation failed (claimId=${claimId}): ${message}`,
            error instanceof Error ? error.stack : undefined,
          );
          Sentry.captureException(error, {
            tags: {
              claimId,
              workshopOrderId: orderId,
              operation: 'pdf.generate',
            },
          });
          await this.safeStoreGenerationError(
            orderId,
            claimId,
            message,
            tenantId,
          );
          throw error;
        }
      },
    );
  }

  async getPdf(
    orderId: string,
    claimId: string,
  ): Promise<{
    filename: string;
    contentType: string;
    contentLength: number | null;
    stream: Readable;
  }> {
    await this.assertClaimScope(orderId, claimId);
    const { claim } = await this.loadClaimPdfRow(orderId, claimId);

    const cached = this.readFreshCachedMetadata(claim);
    if (!cached?.key) {
      throw new NotFoundException('Warranty claim PDF is not generated yet');
    }

    const opened = await this.storage.getPdfStream({
      bucket: cached.bucket,
      key: cached.key,
    });

    const filename = this.buildFilename(
      claim.type,
      claim.order_number,
      claimId,
    );
    return {
      filename,
      contentType: opened.contentType ?? 'application/pdf',
      contentLength: opened.contentLength,
      stream: opened.stream,
    };
  }

  private async assertClaimScope(
    orderId: string,
    claimId: string,
  ): Promise<void> {
    assertWarrantyClaimAccess(this.tenantContext);
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);

    const order = await this.prisma.workshopOrder.findFirst({
      where: { id: orderId, tenant_id: tenantId, site_id: siteId },
      select: { id: true },
    });
    if (!order) {
      throw new NotFoundException(`Workshop order ${orderId} not found`);
    }

    const claim = await this.prisma.warrantyClaim.findFirst({
      where: {
        id: claimId,
        tenant_id: tenantId,
        workshop_order_id: orderId,
      },
      select: { id: true },
    });
    if (!claim) {
      throw new NotFoundException(`Warranty claim ${claimId} not found`);
    }
  }

  private async loadClaimPdfRow(orderId: string, claimId: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const claim = await this.prisma.warrantyClaim.findFirst({
      where: {
        id: claimId,
        tenant_id: tenantId,
        workshop_order_id: orderId,
      },
      select: {
        id: true,
        type: true,
        pdf_storage_bucket: true,
        pdf_storage_key: true,
        pdf_generated_at: true,
        pdf_generation_error: true,
        updatedAt: true,
        workshop_order: { select: { order_number: true } },
      },
    });
    if (!claim) {
      throw new NotFoundException(`Warranty claim ${claimId} not found`);
    }
    return {
      tenantId,
      claim: {
        ...claim,
        order_number: claim.workshop_order.order_number,
      },
    };
  }

  private async buildPdfContent(
    orderId: string,
    claimId: string,
  ): Promise<WarrantyClaimPdfContent> {
    const tenantId = await this.tenantContext.getTenantId();

    const order = await this.prisma.workshopOrder.findFirst({
      where: { id: orderId, tenant_id: tenantId },
      select: {
        order_number: true,
        odometer: true,
        vehicle: {
          select: { make: true, model: true, vin: true, plate: true },
        },
        site: {
          select: {
            legal_entity: {
              select: {
                id: true,
                name: true,
                address_street: true,
                address_zip: true,
                address_city: true,
                vat_id: true,
              },
            },
          },
        },
      },
    });
    if (!order) {
      throw new NotFoundException(`Workshop order ${orderId} not found`);
    }
    const legalEntity = order.site?.legal_entity;
    if (!legalEntity) {
      throw new UnprocessableEntityException({
        code: 'SELLER_IDENTITY_INCOMPLETE',
        message:
          'The workshop order has no legal entity for the document header.',
      });
    }

    const claimRow = await this.prisma.warrantyClaim.findFirst({
      where: { id: claimId, tenant_id: tenantId, workshop_order_id: orderId },
      include: {
        lines: {
          where: { tenant_id: tenantId },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
    });
    if (!claimRow) {
      throw new NotFoundException(`Warranty claim ${claimId} not found`);
    }

    const branding = await this.prisma.$transaction((tx) =>
      resolveBrandingSnapshot(tx, tenantId, legalEntity.id, new Date(), {
        lockLogo: false,
      }),
    );
    const claim = toWarrantyClaimResponse(claimRow);
    return {
      claim,
      order: {
        orderNumber: order.order_number,
        odometer: order.odometer,
        vehicle: {
          make: order.vehicle.make,
          model: order.vehicle.model,
          vin: order.vehicle.vin,
          plate: order.vehicle.plate ?? null,
        },
      },
      seller: {
        name: legalEntity.name,
        addressLines: [
          legalEntity.address_street,
          [legalEntity.address_zip, legalEntity.address_city]
            .filter(Boolean)
            .join(' '),
        ].filter((line): line is string => Boolean(line)),
        vatId: legalEntity.vat_id ?? null,
      },
      tokens: {
        primaryColor: branding.tokens.primary_color,
        secondaryColor: branding.tokens.secondary_color,
      },
      logoDataUrl: await this.loadLogoDataUrl(branding),
      generatedAt: new Date(),
    };
  }

  private buildFilename(
    type: WarrantyClaimType,
    orderNumber: string,
    claimId: string,
  ): string {
    return `${TYPE_FILE_SLUGS[type]}-${slugify(orderNumber)}-${claimId.slice(0, 8)}.pdf`;
  }

  private async loadLogoDataUrl(
    branding: ResolvedBranding,
  ): Promise<string | null> {
    const logo = branding.logo;
    if (!logo) return null;
    if (!LOGO_MIME_TYPES.has(logo.mime_type)) {
      throw brandRenderInputUnavailable();
    }
    const bytes = await this.brandingStorage.readGeneration(
      logo.bucket,
      logo.key,
      logo.generation,
    );
    if (createHash('sha256').update(bytes).digest('hex') !== logo.sha256) {
      throw brandRenderInputUnavailable();
    }
    return `data:${logo.mime_type};base64,${bytes.toString('base64')}`;
  }

  private readFreshCachedMetadata(claim: {
    updatedAt: Date;
    pdf_storage_bucket: string | null;
    pdf_storage_key: string | null;
    pdf_generated_at: Date | null;
    pdf_generation_error?: string | null;
  }): CachedWarrantyClaimPdfMetadata | null {
    const cached = readCachedWarrantyClaimPdfMetadata(claim);
    if (!cached) {
      return null;
    }
    if (
      isWarrantyClaimPdfArchiveStale({
        claimUpdatedAt: claim.updatedAt,
        pdfGeneratedAt: claim.pdf_generated_at,
      })
    ) {
      return null;
    }
    return cached;
  }

  private async resolveVerifiedCachedPdf(
    claimId: string,
    tenantId: string,
    claim: {
      updatedAt: Date;
      pdf_storage_bucket: string | null;
      pdf_storage_key: string | null;
      pdf_generated_at: Date | null;
      pdf_generation_error?: string | null;
    },
  ): Promise<CachedWarrantyClaimPdfMetadata | null> {
    const cached = this.readFreshCachedMetadata(claim);
    if (!cached) {
      return null;
    }

    try {
      const opened = await this.storage.getPdfStream({
        bucket: cached.bucket,
        key: cached.key,
      });
      opened.stream.destroy();
      return cached;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Cached warranty claim PDF missing in storage (claimId=${claimId}): ${message}`,
      );
      await this.prisma.warrantyClaim.updateMany({
        where: { id: claimId, tenant_id: tenantId },
        data: clearWarrantyClaimPdfArchiveData(),
      });
      return null;
    }
  }

  private async persistGeneratedPdf(
    orderId: string,
    claimId: string,
    tenantId: string,
    upload: { bucket: string; key: string },
    generatedAt: Date,
  ) {
    const bucket = upload.bucket || resolvePdfStorageBucket();
    const result = await this.prisma.warrantyClaim.updateMany({
      where: {
        id: claimId,
        tenant_id: tenantId,
        workshop_order_id: orderId,
      },
      data: {
        pdf_storage_bucket: bucket,
        pdf_storage_key: upload.key,
        pdf_generated_at: generatedAt,
        pdf_generation_error: null,
      },
    });
    if (result.count === 0) {
      throw new NotFoundException(
        `Warranty claim ${claimId} was not found for PDF metadata persistence`,
      );
    }
  }

  private async clearGenerationError(
    orderId: string,
    claimId: string,
    tenantId: string,
  ) {
    await this.prisma.warrantyClaim.updateMany({
      where: {
        id: claimId,
        tenant_id: tenantId,
        workshop_order_id: orderId,
      },
      data: { pdf_generation_error: null },
    });
  }

  private async safeStoreGenerationError(
    orderId: string,
    claimId: string,
    message: string,
    tenantId: string,
  ) {
    try {
      await this.prisma.warrantyClaim.updateMany({
        where: {
          id: claimId,
          tenant_id: tenantId,
          workshop_order_id: orderId,
        },
        data: {
          pdf_generation_error: message.slice(0, 2000),
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to store warranty claim PDF generation error (claimId=${claimId}): ${errorMessage}`,
      );
    }
  }
}
