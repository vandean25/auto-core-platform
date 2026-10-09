import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/node';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CloudTasksService } from '../../common/services/cloud-tasks.service.js';
import { TenantContextService } from '../../common/services/tenant-context.service.js';
import { SiteContextService } from '../../site/site-context.service.js';
import {
  PdfStorage,
  type ImmutablePdfObject,
} from '../../common/pdf/pdf-storage.js';
import { resolvePdfStorageBucket } from '../../common/pdf/pdf-bucket.js';
import { enqueueOrGeneratePdf } from '../../common/pdf/pdf-generation-dispatch.js';
import { DocumentBrandingAssetStorage } from '../../document-branding/document-branding-asset-storage.js';
import { resolveBrandingSnapshot } from '../../invoices/invoice-snapshot-v2.helpers.js';
import { buildSellerSnapshot } from '../../invoices/invoice-snapshot-v2.js';
import { getErrorCode } from '../../invoices/invoice-pdf-archive.helpers.js';
import { brandRenderInputUnavailable } from '../../invoices/invoice-pdf-branding.helpers.js';
import {
  assertKaufvertragSaleEligible,
  resolveKaufvertragGewaehrleistung,
} from './kaufvertrag-facts.js';
import { KaufvertragPdfRenderer } from './kaufvertrag-pdf.renderer.js';
import {
  buildKaufvertragArchiveIdentity,
  buildKaufvertragArchiveKey,
  buildKaufvertragSnapshot,
  hashKaufvertragSnapshot,
  toKaufvertragSnapshotBranding,
  type KaufvertragSnapshot,
  type KaufvertragSnapshotBranding,
  type KaufvertragSnapshotBuyer,
} from './kaufvertrag-snapshot.js';

const KAUFVERTRAG_PDF_CONTENT_TYPE = 'application/pdf';

const SALE_INCLUDE = {
  vehicle: true,
  customer: true,
  site: { include: { legal_entity: true } },
} satisfies Prisma.VehicleSaleInclude;

type LoadedSale = Prisma.VehicleSaleGetPayload<{
  include: typeof SALE_INCLUDE;
}>;

export type KaufvertragPdfRequestGenerationResponse = {
  mode: 'cached' | 'enqueued' | 'generated';
  saleId: string;
  bucket: string | null;
  key: string | null;
  generatedAt: Date | null;
  taskId?: string;
};

export type KaufvertragPdfStream = {
  filename: string;
  contentType: string;
  contentLength: number;
  stream: Readable;
};

type PreparedKaufvertrag = {
  snapshot: KaufvertragSnapshot;
  snapshotSha256: string;
};

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function matchesIdentity(
  metadata: Record<string, string>,
  identity: Record<string, string>,
): boolean {
  return Object.entries(identity).every(
    ([key, value]) => metadata[key] === value,
  );
}

function buyerSnapshot(
  customer: LoadedSale['customer'],
): KaufvertragSnapshotBuyer {
  return {
    type: customer.type,
    company_name: customer.company_name ?? null,
    first_name: customer.first_name,
    last_name: customer.last_name,
    vat_id: customer.vat_id ?? null,
    address_street: customer.address_street ?? null,
    address_zip: customer.address_zip ?? null,
    address_city: customer.address_city ?? null,
    address_country: customer.address_country ?? null,
  };
}

/**
 * Generates the Kaufvertrag PDF for a vehicle sale and archives it immutably.
 *
 * The archive key depends on the snapshot hash, so identical facts reuse one
 * object and changed facts create a new one. Earlier objects stay in storage
 * unchanged and are no longer referenced by the sale row.
 */
@Injectable()
export class VehicleSaleKaufvertragPdfService {
  private readonly logger = new Logger(VehicleSaleKaufvertragPdfService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly renderer: KaufvertragPdfRenderer,
    private readonly storage: PdfStorage,
    private readonly cloudTasks: CloudTasksService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    @Optional()
    @Inject(DocumentBrandingAssetStorage)
    private readonly brandingStorage: DocumentBrandingAssetStorage | undefined,
  ) {}

  async requestGeneration(
    saleId: string,
    params: { targetBaseUrl: string },
  ): Promise<KaufvertragPdfRequestGenerationResponse> {
    const tenantId = await this.tenantContext.getTenantId();
    const authorizedSiteIds = await this.siteContext.listAuthorizedSiteIds();
    const sale = await this.findSaleInScope(
      saleId,
      tenantId,
      authorizedSiteIds,
    );

    const prepared = await this.prepareSnapshot(sale, tenantId);
    const cached = this.resolveCachedArchive(sale, prepared.snapshotSha256);
    if (cached) {
      return { mode: 'cached', saleId, ...cached };
    }

    const outcome = await this.dispatchGeneration(
      saleId,
      tenantId,
      params.targetBaseUrl,
    );
    if (outcome.mode === 'enqueued') {
      return {
        mode: 'enqueued',
        saleId,
        bucket: null,
        key: null,
        generatedAt: null,
        taskId: outcome.taskId,
      };
    }
    return {
      mode: 'generated',
      saleId,
      bucket: outcome.result.bucket,
      key: outcome.result.key,
      generatedAt: outcome.result.generatedAt,
    };
  }

  /** Worker entry point. Tenant-scoped, because the signed task payload is the authority. */
  async generateNow(saleId: string): Promise<{
    saleId: string;
    bucket: string;
    key: string;
    generatedAt: Date;
  }> {
    return Sentry.startSpan(
      { name: 'Generate Kaufvertrag PDF', op: 'pdf.generate' },
      async (span) => {
        span.setAttribute('vehicleSaleId', saleId);
        const tenantId = await this.tenantContext.getTenantId();
        const sale = await this.findSaleForTenant(saleId, tenantId);

        try {
          const prepared = await this.prepareSnapshot(sale, tenantId);
          const cached = this.resolveCachedArchive(
            sale,
            prepared.snapshotSha256,
          );
          if (cached) {
            return { saleId, ...cached };
          }

          const archive = await this.renderAndArchive(
            saleId,
            tenantId,
            prepared,
          );
          const generatedAt = new Date();
          await this.persistArchive(
            saleId,
            tenantId,
            prepared,
            archive,
            generatedAt,
          );
          return {
            saleId,
            bucket: archive.bucket,
            key: archive.key,
            generatedAt,
          };
        } catch (error) {
          await this.safeStoreGenerationError(
            saleId,
            tenantId,
            toErrorMessage(error),
          );
          throw error;
        }
      },
    );
  }

  async getPdf(saleId: string): Promise<KaufvertragPdfStream> {
    const tenantId = await this.tenantContext.getTenantId();
    const authorizedSiteIds = await this.siteContext.listAuthorizedSiteIds();
    const sale = await this.findSaleInScope(
      saleId,
      tenantId,
      authorizedSiteIds,
    );

    const bucket = sale.kaufvertrag_archive_bucket;
    const key = sale.kaufvertrag_archive_key;
    const generation = sale.kaufvertrag_archive_generation;
    const sha256 = sale.kaufvertrag_archive_sha256;
    const snapshotSha256 = sale.kaufvertrag_snapshot_sha256;
    if (!bucket || !key || !generation || !sha256 || !snapshotSha256) {
      throw new NotFoundException('Kaufvertrag PDF is not generated yet');
    }

    // Changed facts leave the previous archive pointer in place until the next
    // generation writes a new one. Serve only the archive that matches the
    // current facts, so a download never disagrees with the tracker.
    const current = await this.prepareSnapshot(sale, tenantId);
    if (current.snapshotSha256 !== snapshotSha256) {
      throw new NotFoundException('Kaufvertrag PDF is not generated yet');
    }

    const identity = buildKaufvertragArchiveIdentity({
      tenantId,
      saleId: sale.id,
      snapshotSha256,
    });
    const expectedKey = buildKaufvertragArchiveKey({
      tenantId,
      saleId: sale.id,
      snapshotSha256,
    });
    if (key !== expectedKey) {
      throw brandRenderInputUnavailable(
        'Kaufvertrag archive reference is inconsistent.',
      );
    }

    const archive = await this.storage.readImmutableObjectGeneration({
      bucket,
      key,
      generation,
      expectedSha256: sha256,
      validateMetadata: (metadata) => matchesIdentity(metadata, identity),
    });

    return {
      filename: `kaufvertrag-${sale.sale_number.replace(/[^A-Za-z0-9]+/g, '_')}.pdf`,
      contentType: KAUFVERTRAG_PDF_CONTENT_TYPE,
      contentLength: archive.body.length,
      stream: Readable.from(archive.body),
    };
  }

  private async findSaleInScope(
    saleId: string,
    tenantId: string,
    authorizedSiteIds: string[],
  ): Promise<LoadedSale> {
    const sale = await this.prisma.client.vehicleSale.findFirst({
      where: {
        id: saleId,
        tenant_id: tenantId,
        site_id: { in: authorizedSiteIds },
        vehicle: {
          is: { tenant_id: tenantId, site_id: { in: authorizedSiteIds } },
        },
        customer: { is: { tenant_id: tenantId } },
      },
      include: SALE_INCLUDE,
    });
    if (!sale) {
      throw new NotFoundException(`Vehicle sale ${saleId} not found`);
    }
    return sale;
  }

  private async findSaleForTenant(
    saleId: string,
    tenantId: string,
  ): Promise<LoadedSale> {
    const sale = await this.prisma.client.vehicleSale.findFirst({
      where: { id: saleId, tenant_id: tenantId },
      include: SALE_INCLUDE,
    });
    if (!sale) {
      throw new NotFoundException(`Vehicle sale ${saleId} not found`);
    }
    return sale;
  }

  /** Runs every guard and builds the frozen snapshot. Nothing is written here. */
  private async prepareSnapshot(
    sale: LoadedSale,
    tenantId: string,
  ): Promise<PreparedKaufvertrag> {
    const { vin, seller } = assertKaufvertragSaleEligible({
      status: sale.status,
      vin: sale.vehicle.vin,
      seller: sale.site?.legal_entity ?? null,
    });
    const warranty = resolveKaufvertragGewaehrleistung({
      contractConcludedAt: sale.contract_concluded_at,
      handedOverAt: sale.handed_over_at,
      buyerIsConsumer: sale.buyer_is_consumer ?? false,
      shortenedNegotiated: sale.gewaehrleistung_shortened_negotiated ?? false,
      firstRegistrationDate: sale.vehicle.first_registration_date,
      stored: {
        baseEndsOn: sale.gewaehrleistung_ends_on,
        presumptionEndsOn: sale.presumption_ends_on,
        ruleVersion: sale.gewaehrleistung_rule_version,
      },
    });
    const branding: KaufvertragSnapshotBranding = toKaufvertragSnapshotBranding(
      await this.prisma.$transaction((tx) =>
        resolveBrandingSnapshot(tx, tenantId, seller.id, new Date()),
      ),
    );

    const snapshot = buildKaufvertragSnapshot({
      sale: {
        id: sale.id,
        sale_number: sale.sale_number,
        sale_price_eur: sale.sale_price.toFixed(2),
        contract_concluded_at: warranty.contractConcludedAt,
        handed_over_at: warranty.handedOverAt,
      },
      seller: buildSellerSnapshot(seller),
      buyer: buyerSnapshot(sale.customer),
      vehicle: {
        make: sale.vehicle.make,
        model: sale.vehicle.model,
        vin,
        hsn: sale.vehicle.hsn,
        tsn: sale.vehicle.tsn,
        color: sale.vehicle.color,
        mileage: sale.vehicle.mileage,
        first_registration_date: sale.vehicle.first_registration_date,
      },
      warranty,
      garantie:
        sale.garantie_months !== null
          ? {
              months: sale.garantie_months,
              terms: sale.garantie_terms?.trim() || null,
            }
          : null,
      branding,
    });

    return {
      snapshot,
      snapshotSha256: hashKaufvertragSnapshot(snapshot),
    };
  }

  private resolveCachedArchive(
    sale: LoadedSale,
    snapshotSha256: string,
  ): { bucket: string; key: string; generatedAt: Date } | null {
    if (
      sale.kaufvertrag_snapshot_sha256 !== snapshotSha256 ||
      !sale.kaufvertrag_archive_bucket ||
      !sale.kaufvertrag_archive_key ||
      !sale.kaufvertrag_archive_generation ||
      !sale.kaufvertrag_archive_sha256 ||
      !sale.kaufvertrag_generated_at
    ) {
      return null;
    }
    return {
      bucket: sale.kaufvertrag_archive_bucket,
      key: sale.kaufvertrag_archive_key,
      generatedAt: sale.kaufvertrag_generated_at,
    };
  }

  private async dispatchGeneration(
    saleId: string,
    tenantId: string,
    targetBaseUrl: string,
  ) {
    return enqueueOrGeneratePdf({
      kind: 'vehicle-sale-kaufvertrag',
      resourceId: saleId,
      resourceName: 'Kaufvertrag',
      tenantId,
      targetBaseUrl,
      cloudTasks: this.cloudTasks,
      nodeEnv: process.env.NODE_ENV,
      logger: this.logger,
      clearError: () => this.clearGenerationError(saleId, tenantId),
      generateInline: () => this.generateNow(saleId),
      storeEnqueueError: (message) =>
        this.safeStoreGenerationError(saleId, tenantId, message),
      onEnqueueError: (error) => {
        Sentry.captureException(error, {
          tags: {
            vehicleSaleId: saleId,
            operation: 'cloudtasks.enqueuePdfGeneration',
          },
        });
      },
    });
  }

  private async renderAndArchive(
    saleId: string,
    tenantId: string,
    prepared: PreparedKaufvertrag,
  ): Promise<ImmutablePdfObject> {
    const identity = buildKaufvertragArchiveIdentity({
      tenantId,
      saleId,
      snapshotSha256: prepared.snapshotSha256,
    });
    const key = buildKaufvertragArchiveKey({
      tenantId,
      saleId,
      snapshotSha256: prepared.snapshotSha256,
    });
    const logoPng = await this.loadLogo(prepared.snapshot.branding);
    const pdf = await this.renderer.render(prepared.snapshot, { logoPng });

    try {
      return await this.storage.publishImmutableObject({
        key,
        body: pdf,
        contentType: KAUFVERTRAG_PDF_CONTENT_TYPE,
        customMetadata: identity,
      });
    } catch (error) {
      // Create-only publication lost to an earlier attempt (for example a
      // Cloud Tasks retry). Adopt that object only if its identity matches.
      if (getErrorCode(error) !== 412) {
        throw error;
      }
      return this.storage.readImmutableObjectByKey({
        bucket: resolvePdfStorageBucket(),
        key,
        validateMetadata: (metadata) => matchesIdentity(metadata, identity),
      });
    }
  }

  private async loadLogo(
    branding: KaufvertragSnapshotBranding,
  ): Promise<Buffer | undefined> {
    const logo = branding.logo;
    if (!logo) return undefined;
    if (!this.brandingStorage) {
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
    return bytes;
  }

  private async persistArchive(
    saleId: string,
    tenantId: string,
    prepared: PreparedKaufvertrag,
    archive: ImmutablePdfObject,
    generatedAt: Date,
  ): Promise<void> {
    const updated = await this.prisma.client.vehicleSale.updateMany({
      where: { id: saleId, tenant_id: tenantId },
      data: {
        kaufvertrag_snapshot: prepared.snapshot,
        kaufvertrag_snapshot_sha256: prepared.snapshotSha256,
        kaufvertrag_archive_bucket: archive.bucket,
        kaufvertrag_archive_key: archive.key,
        kaufvertrag_archive_generation: archive.generation,
        kaufvertrag_archive_sha256: archive.sha256,
        kaufvertrag_generated_at: generatedAt,
        kaufvertrag_generation_error: null,
      },
    });
    if (updated.count !== 1) {
      throw new NotFoundException(`Vehicle sale ${saleId} not found`);
    }
  }

  private async clearGenerationError(
    saleId: string,
    tenantId: string,
  ): Promise<void> {
    await this.prisma.client.vehicleSale.updateMany({
      where: { id: saleId, tenant_id: tenantId },
      data: { kaufvertrag_generation_error: null },
    });
  }

  private async safeStoreGenerationError(
    saleId: string,
    tenantId: string,
    message: string,
  ): Promise<void> {
    try {
      await this.prisma.client.vehicleSale.updateMany({
        where: { id: saleId, tenant_id: tenantId },
        data: { kaufvertrag_generation_error: message },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to store Kaufvertrag PDF generation error for ${saleId}: ${toErrorMessage(error)}`,
      );
    }
  }
}
