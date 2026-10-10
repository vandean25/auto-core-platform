import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WorkshopEstimateStatus } from '@prisma/client';
import * as Sentry from '@sentry/node';
import { Readable } from 'node:stream';
import { PrismaService } from '../prisma/prisma.service.js';
import { CloudTasksService } from '../common/services/cloud-tasks.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import {
  PdfStorage,
  type ImmutablePdfObject,
} from '../common/pdf/pdf-storage.js';
import { resolvePdfStorageBucket } from '../common/pdf/pdf-bucket.js';
import { enqueueOrGeneratePdf } from '../common/pdf/pdf-generation-dispatch.js';
import { DocumentBrandingAssetStorage } from '../document-branding/document-branding-asset-storage.js';
import { getErrorCode } from '../invoices/invoice-pdf-archive.helpers.js';
import {
  brandRenderInputUnavailable,
  verifyFrozenAssetMetadata,
  verifyFrozenLogoHash,
} from '../invoices/invoice-pdf-branding.helpers.js';
import { WorkshopEstimatePdfRenderer } from './workshop-estimate-pdf.renderer.js';
import {
  WORKSHOP_ESTIMATE_SNAPSHOT_SCHEMA_VERSION,
  WORKSHOP_ESTIMATE_TITLE,
} from './workshop-estimate.constants.js';
import {
  hashWorkshopEstimateSnapshot,
  type WorkshopEstimateSnapshot,
} from './workshop-estimate-snapshot.js';

const PDF_CONTENT_TYPE = 'application/pdf';
/** Shown to the workshop. The raw error stays in the logs. */
const SAFE_GENERATION_ERROR =
  'PDF generation failed. Please try again or contact support.';

export type WorkshopEstimatePdfScope = { tenantId: string; siteId: string };

export type WorkshopEstimatePdfRequestResponse =
  | {
      mode: 'cached' | 'generated';
      versionId: string;
      bucket: string;
      key: string;
      generatedAt: Date;
    }
  | { mode: 'enqueued'; versionId: string; taskId: string };

export type WorkshopEstimatePdfGenerated = {
  versionId: string;
  bucket: string;
  key: string;
  generatedAt: Date;
};

export type WorkshopEstimatePdfStream = {
  filename: string;
  contentType: string;
  contentLength: number;
  stream: Readable;
};

const PDF_VERSION_SELECT = {
  id: true,
  tenant_id: true,
  version: true,
  status: true,
  legal_entity_id: true,
  snapshot: true,
  snapshot_sha256: true,
  pdf_storage_bucket: true,
  pdf_storage_key: true,
  pdf_archive_generation: true,
  pdf_sha256: true,
  pdf_generated_at: true,
  estimate: { select: { estimate_number: true } },
} satisfies Prisma.WorkshopEstimateVersionSelect;

type PdfVersionRow = Prisma.WorkshopEstimateVersionGetPayload<{
  select: typeof PDF_VERSION_SELECT;
}>;

type ArchivePointer = {
  bucket: string;
  key: string;
  generation: string;
  sha256: string;
  generatedAt: Date;
};

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function notSentConflict(): ConflictException {
  return new ConflictException({
    code: 'ESTIMATE_PDF_NOT_SENT',
    message: 'Only a sent estimate version has a PDF.',
  });
}

function readArchivePointer(row: PdfVersionRow): ArchivePointer | null {
  if (
    !row.pdf_storage_bucket ||
    !row.pdf_storage_key ||
    !row.pdf_archive_generation ||
    !row.pdf_sha256 ||
    !row.pdf_generated_at
  ) {
    return null;
  }
  return {
    bucket: row.pdf_storage_bucket,
    key: row.pdf_storage_key,
    generation: row.pdf_archive_generation,
    sha256: row.pdf_sha256,
    generatedAt: row.pdf_generated_at,
  };
}

/** The key follows the frozen snapshot, so one version has one archive name. */
function buildArchiveKey(
  tenantId: string,
  versionId: string,
  snapshotSha256: string,
): string {
  return `workshop-estimates/${tenantId}/${versionId}/${snapshotSha256}.pdf`;
}

function buildArchiveIdentity(
  tenantId: string,
  versionId: string,
  snapshotSha256: string,
): Record<string, string> {
  return {
    tenant_id: tenantId,
    workshop_estimate_version_id: versionId,
    snapshot_sha256: snapshotSha256,
    document_kind: 'WORKSHOP_ESTIMATE',
  };
}

function matchesIdentity(
  metadata: Record<string, string>,
  identity: Record<string, string>,
): boolean {
  return Object.entries(identity).every(
    ([key, value]) => metadata[key] === value,
  );
}

/**
 * The stored snapshot must still hash to the value stored at send. Otherwise the
 * PDF would print facts that no longer match what the customer was offered.
 */
function readFrozenSnapshot(row: PdfVersionRow): {
  snapshot: WorkshopEstimateSnapshot;
  snapshotSha256: string;
} {
  const snapshot = row.snapshot as unknown as WorkshopEstimateSnapshot | null;
  if (
    !snapshot ||
    typeof snapshot !== 'object' ||
    snapshot.schema_version !== WORKSHOP_ESTIMATE_SNAPSHOT_SCHEMA_VERSION ||
    !row.snapshot_sha256 ||
    hashWorkshopEstimateSnapshot(snapshot) !== row.snapshot_sha256
  ) {
    throw brandRenderInputUnavailable(
      'Frozen estimate snapshot could not be verified.',
    );
  }
  return { snapshot, snapshotSha256: row.snapshot_sha256 };
}

/**
 * Generates the Kaufvertrag-style archive for a Kostenvoranschlag version and keeps
 * it immutable (ADR-0007, ADR-0024 §5, ADR-0025 §2). A SENT or later version is
 * rendered once. A DRAFT is never rendered. The archive is create-only, and a
 * stored archive is never re-rendered.
 */
@Injectable()
export class WorkshopEstimatePdfService {
  private readonly logger = new Logger(WorkshopEstimatePdfService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly renderer: WorkshopEstimatePdfRenderer,
    private readonly storage: PdfStorage,
    private readonly cloudTasks: CloudTasksService,
    private readonly tenantContext: TenantContextService,
    private readonly brandingStorage: DocumentBrandingAssetStorage,
  ) {}

  /**
   * Request from the workshop UI or from the send hook. The caller has already
   * resolved the role and site scope. An existing archive is served as it is.
   * Otherwise the render goes through the async pipeline, or inline outside
   * production, like the other document kinds.
   */
  async requestGeneration(
    scope: WorkshopEstimatePdfScope,
    versionId: string,
    params: { targetBaseUrl: string },
  ): Promise<WorkshopEstimatePdfRequestResponse> {
    const row = await this.findVersionInScope(scope, versionId);
    if (row.status === WorkshopEstimateStatus.DRAFT) {
      throw notSentConflict();
    }
    const archive = readArchivePointer(row);
    if (archive) {
      return {
        mode: 'cached',
        versionId,
        bucket: archive.bucket,
        key: archive.key,
        generatedAt: archive.generatedAt,
      };
    }

    const { tenantId } = scope;
    const outcome = await enqueueOrGeneratePdf({
      kind: 'workshop-estimate',
      resourceId: versionId,
      resourceName: 'workshop estimate',
      tenantId,
      targetBaseUrl: params.targetBaseUrl,
      cloudTasks: this.cloudTasks,
      nodeEnv: process.env.NODE_ENV,
      logger: this.logger,
      clearError: () => this.clearGenerationError(versionId, tenantId),
      generateInline: () => this.generateNow(versionId, tenantId),
      storeEnqueueError: (message) =>
        this.storeGenerationError(versionId, tenantId, message),
      onEnqueueError: (error) => {
        Sentry.captureException(error, {
          tags: {
            workshopEstimateVersionId: versionId,
            operation: 'cloudtasks.enqueuePdfGeneration',
          },
        });
      },
    });

    if (outcome.mode === 'enqueued') {
      return { mode: 'enqueued', versionId, taskId: outcome.taskId };
    }
    return { mode: 'generated', ...outcome.result };
  }

  /**
   * Worker entry point and inline path. The tenant comes from the signed task
   * payload (or the caller), because the worker runs without a user site scope.
   */
  async generateNow(
    versionId: string,
    tenantId?: string,
  ): Promise<WorkshopEstimatePdfGenerated> {
    return Sentry.startSpan(
      { name: 'Generate Workshop Estimate PDF', op: 'pdf.generate' },
      async (span) => {
        const resolvedTenantId =
          tenantId ?? (await this.tenantContext.getTenantId());
        span.setAttribute('workshopEstimateVersionId', versionId);

        const row = await this.findVersionForTenant(
          resolvedTenantId,
          versionId,
        );
        if (row.status === WorkshopEstimateStatus.DRAFT) {
          throw notSentConflict();
        }
        const existing = readArchivePointer(row);
        if (existing) {
          return {
            versionId,
            bucket: existing.bucket,
            key: existing.key,
            generatedAt: existing.generatedAt,
          };
        }

        try {
          const { snapshot, snapshotSha256 } = readFrozenSnapshot(row);
          const logoPng = await this.loadFrozenLogo(
            row,
            resolvedTenantId,
            snapshot,
          );
          const archive = await this.renderAndArchive(
            resolvedTenantId,
            versionId,
            snapshot,
            snapshotSha256,
            logoPng,
          );
          return await this.persistArchive(
            versionId,
            resolvedTenantId,
            archive,
            new Date(),
          );
        } catch (error) {
          this.logger.error(
            `Workshop estimate PDF generation failed for ${versionId}: ${toErrorMessage(error)}`,
            error instanceof Error ? error.stack : undefined,
          );
          await this.storeGenerationError(
            versionId,
            resolvedTenantId,
            SAFE_GENERATION_ERROR,
          );
          throw error;
        }
      },
    );
  }

  /** Serves the archived bytes after checking the key, the identity and the SHA-256. */
  async getPdf(
    scope: WorkshopEstimatePdfScope,
    versionId: string,
  ): Promise<WorkshopEstimatePdfStream> {
    const row = await this.findVersionInScope(scope, versionId);
    const archive = readArchivePointer(row);
    const snapshotSha256 = row.snapshot_sha256;
    if (!archive || !snapshotSha256) {
      throw new NotFoundException('Estimate PDF is not generated yet');
    }
    const expectedKey = buildArchiveKey(scope.tenantId, row.id, snapshotSha256);
    if (archive.key !== expectedKey) {
      throw brandRenderInputUnavailable(
        'Estimate archive reference is inconsistent.',
      );
    }

    const identity = buildArchiveIdentity(
      scope.tenantId,
      row.id,
      snapshotSha256,
    );
    const object = await this.storage.readImmutableObjectGeneration({
      bucket: archive.bucket,
      key: archive.key,
      generation: archive.generation,
      expectedSha256: archive.sha256,
      validateMetadata: (metadata) => matchesIdentity(metadata, identity),
    });

    return {
      filename: `${WORKSHOP_ESTIMATE_TITLE}-${row.estimate.estimate_number}-v${row.version}.pdf`,
      contentType: PDF_CONTENT_TYPE,
      contentLength: object.body.length,
      stream: Readable.from(object.body),
    };
  }

  /**
   * Logo bytes for the render. The version's own asset reference must still match
   * the frozen metadata, and the bytes must match the frozen hash (ADR-0024).
   */
  private async loadFrozenLogo(
    row: PdfVersionRow,
    tenantId: string,
    snapshot: WorkshopEstimateSnapshot,
  ): Promise<Buffer | undefined> {
    const logo = snapshot.branding.logo;
    if (!logo) return undefined;
    if (!row.legal_entity_id) {
      throw brandRenderInputUnavailable();
    }

    const reference =
      await this.prisma.workshopEstimateBrandAssetReference.findFirst({
        where: {
          tenant_id: tenantId,
          legal_entity_id: row.legal_entity_id,
          workshop_estimate_version_id: row.id,
          asset_id: logo.asset_id,
        },
        select: {
          asset: {
            select: {
              bucket: true,
              object_key: true,
              object_generation: true,
              sha256: true,
              detected_mime_type: true,
              pixel_width: true,
              pixel_height: true,
            },
          },
        },
      });
    if (!verifyFrozenAssetMetadata(reference?.asset, logo)) {
      throw brandRenderInputUnavailable();
    }

    const bytes = await this.brandingStorage.readGeneration(
      logo.bucket,
      logo.key,
      logo.generation,
    );
    if (!verifyFrozenLogoHash(bytes, logo.sha256)) {
      throw brandRenderInputUnavailable();
    }
    return bytes;
  }

  private async renderAndArchive(
    tenantId: string,
    versionId: string,
    snapshot: WorkshopEstimateSnapshot,
    snapshotSha256: string,
    logoPng: Buffer | undefined,
  ): Promise<ImmutablePdfObject> {
    const key = buildArchiveKey(tenantId, versionId, snapshotSha256);
    const identity = buildArchiveIdentity(tenantId, versionId, snapshotSha256);
    const pdf = await this.renderer.render({ snapshot, logoPng });

    try {
      return await this.storage.publishImmutableObject({
        key,
        body: pdf,
        contentType: PDF_CONTENT_TYPE,
        customMetadata: identity,
      });
    } catch (error) {
      if (getErrorCode(error) !== 412) {
        throw error;
      }
      // An earlier attempt published this object but could not store its pointer.
      // Adopt that object only when its identity matches. It is never overwritten.
      return this.storage.readImmutableObjectByKey({
        bucket: resolvePdfStorageBucket(),
        key,
        validateMetadata: (metadata) => matchesIdentity(metadata, identity),
      });
    }
  }

  /** Guarded write: only a version without an archive pointer takes this one. */
  private async persistArchive(
    versionId: string,
    tenantId: string,
    archive: ImmutablePdfObject,
    generatedAt: Date,
  ): Promise<WorkshopEstimatePdfGenerated> {
    const stored = await this.prisma.workshopEstimateVersion.updateMany({
      where: { id: versionId, tenant_id: tenantId, pdf_storage_key: null },
      data: {
        pdf_storage_bucket: archive.bucket,
        pdf_storage_key: archive.key,
        pdf_archive_generation: archive.generation,
        pdf_sha256: archive.sha256,
        pdf_generated_at: generatedAt,
        pdf_generation_error: null,
      },
    });
    if (stored.count === 1) {
      return {
        versionId,
        bucket: archive.bucket,
        key: archive.key,
        generatedAt,
      };
    }

    // Another worker stored its pointer first. Its archive is the one the version serves.
    const current = await this.findVersionForTenant(tenantId, versionId);
    const winner = readArchivePointer(current);
    if (!winner) {
      throw new ConflictException({
        code: 'ESTIMATE_PDF_NOT_STORED',
        message: 'The estimate PDF could not be stored. Please try again.',
      });
    }
    return {
      versionId,
      bucket: winner.bucket,
      key: winner.key,
      generatedAt: winner.generatedAt,
    };
  }

  private async findVersionInScope(
    scope: WorkshopEstimatePdfScope,
    versionId: string,
  ): Promise<PdfVersionRow> {
    const row = await this.prisma.workshopEstimateVersion.findFirst({
      where: {
        id: versionId,
        tenant_id: scope.tenantId,
        estimate: { site_id: scope.siteId },
      },
      select: PDF_VERSION_SELECT,
    });
    if (!row) {
      throw new NotFoundException('Workshop estimate version not found');
    }
    return row;
  }

  private async findVersionForTenant(
    tenantId: string,
    versionId: string,
  ): Promise<PdfVersionRow> {
    const row = await this.prisma.workshopEstimateVersion.findFirst({
      where: { id: versionId, tenant_id: tenantId },
      select: PDF_VERSION_SELECT,
    });
    if (!row) {
      throw new NotFoundException('Workshop estimate version not found');
    }
    return row;
  }

  private async clearGenerationError(
    versionId: string,
    tenantId: string,
  ): Promise<void> {
    await this.prisma.workshopEstimateVersion.updateMany({
      where: { id: versionId, tenant_id: tenantId },
      data: { pdf_generation_error: null },
    });
  }

  private async storeGenerationError(
    versionId: string,
    tenantId: string,
    message: string,
  ): Promise<void> {
    try {
      await this.prisma.workshopEstimateVersion.updateMany({
        where: { id: versionId, tenant_id: tenantId },
        data: { pdf_generation_error: message },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to store estimate PDF error for ${versionId}: ${toErrorMessage(error)}`,
      );
    }
  }
}
