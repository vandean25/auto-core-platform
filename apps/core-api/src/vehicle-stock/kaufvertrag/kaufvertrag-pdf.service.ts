import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { Readable } from 'node:stream';
import { CloudTasksService } from '../../common/services/cloud-tasks.service.js';
import { TenantContextService } from '../../common/services/tenant-context.service.js';
import { SiteContextService } from '../../site/site-context.service.js';
import { EffectiveCapabilitiesService } from '../../common/country-pack/effective-capabilities.guard.js';
import { resolveCountryPack } from '../../common/country-pack/country-pack.registry.js';
import { enqueueOrGeneratePdf } from '../../common/pdf/pdf-generation-dispatch.js';
import {
  KAUFVERTRAG_PDF_CONTENT_TYPE,
  KaufvertragPdfArchiveService,
  toErrorMessage,
} from './kaufvertrag-pdf.archive.service.js';
import {
  KaufvertragPdfSnapshotService,
  resolveCachedArchive,
} from './kaufvertrag-pdf.snapshot.service.js';

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

/**
 * Generates the Kaufvertrag PDF for a vehicle sale and archives it immutably.
 *
 * The archive key depends on the snapshot hash, so identical facts reuse one
 * object and changed facts create a new one. Earlier objects stay in storage
 * unchanged and are no longer referenced by the sale row.
 *
 * This service decides when to generate, enqueue or serve a cached archive. The snapshot
 * service builds the facts and the archive service renders and stores them.
 */
@Injectable()
export class VehicleSaleKaufvertragPdfService {
  private readonly logger = new Logger(VehicleSaleKaufvertragPdfService.name);

  constructor(
    private readonly snapshots: KaufvertragPdfSnapshotService,
    private readonly archives: KaufvertragPdfArchiveService,
    private readonly cloudTasks: CloudTasksService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly effectiveCapabilities: EffectiveCapabilitiesService,
  ) {}

  async requestGeneration(
    saleId: string,
    params: { targetBaseUrl: string },
  ): Promise<KaufvertragPdfRequestGenerationResponse> {
    const tenantId = await this.tenantContext.getTenantId();
    const authorizedSiteIds = await this.siteContext.listAuthorizedSiteIds();
    const sale = await this.snapshots.findSaleInScope(
      saleId,
      tenantId,
      authorizedSiteIds,
    );

    const prepared = await this.snapshots.prepareSnapshot(sale, tenantId, {
      lockLogo: false,
    });
    const cached = resolveCachedArchive(sale, prepared.snapshotSha256);
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
        await this.assertKaufvertragCapability(saleId);
        const tenantId = await this.tenantContext.getTenantId();
        const sale = await this.snapshots.findSaleForTenant(saleId, tenantId);

        try {
          const prepared = await this.snapshots.prepareSnapshot(
            sale,
            tenantId,
            { lockLogo: true },
          );
          const cached = resolveCachedArchive(sale, prepared.snapshotSha256);
          if (cached) {
            return { saleId, ...cached };
          }

          const archive = await this.archives.renderAndArchive(
            saleId,
            tenantId,
            prepared,
          );
          const generatedAt = new Date();
          await this.archives.persistArchive(
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
          await this.archives.safeStoreGenerationError(
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
    const sale = await this.snapshots.findSaleInScope(
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
    const current = await this.snapshots.prepareSnapshot(sale, tenantId, {
      lockLogo: false,
    });
    if (current.snapshotSha256 !== snapshotSha256) {
      throw new NotFoundException('Kaufvertrag PDF is not generated yet');
    }

    const archive = await this.archives.readArchive({
      tenantId,
      saleId: sale.id,
      snapshotSha256,
      pointer: { bucket, key, generation, sha256 },
    });

    return {
      filename: `kaufvertrag-${sale.sale_number.replace(/[^A-Za-z0-9]+/g, '_')}.pdf`,
      contentType: KAUFVERTRAG_PDF_CONTENT_TYPE,
      contentLength: archive.body.length,
      stream: Readable.from(archive.body),
    };
  }

  private async assertKaufvertragCapability(saleId: string): Promise<void> {
    const sessionCaps = await this.effectiveCapabilities.resolve();
    if (sessionCaps !== null) {
      if (sessionCaps.kaufvertragAt === true) {
        return;
      }
      throw this.kaufvertragCapabilityForbidden();
    }

    const tenantId = await this.tenantContext.getTenantId();
    const countryIso = await this.snapshots.findSaleLegalEntityCountryIso(
      saleId,
      tenantId,
    );
    if (resolveCountryPack(countryIso).capabilities.kaufvertragAt === true) {
      return;
    }
    throw this.kaufvertragCapabilityForbidden();
  }

  private kaufvertragCapabilityForbidden(): ForbiddenException {
    return new ForbiddenException({
      code: 'CAPABILITY_UNAVAILABLE',
      message: 'This feature is unavailable for the active legal entity.',
    });
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
      clearError: () => this.archives.clearGenerationError(saleId, tenantId),
      generateInline: () => this.generateNow(saleId),
      storeEnqueueError: (message) =>
        this.archives.safeStoreGenerationError(saleId, tenantId, message),
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
}
