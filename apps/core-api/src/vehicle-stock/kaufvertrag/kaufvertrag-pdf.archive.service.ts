import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  PdfStorage,
  type ImmutablePdfObject,
} from '../../common/pdf/pdf-storage.js';
import { resolvePdfStorageBucket } from '../../common/pdf/pdf-bucket.js';
import { DocumentBrandingAssetStorage } from '../../document-branding/document-branding-asset-storage.js';
import { getErrorCode } from '../../invoices/invoice-pdf-archive.helpers.js';
import { brandRenderInputUnavailable } from '../../invoices/invoice-pdf-branding.helpers.js';
import { KaufvertragPdfRenderer } from './kaufvertrag-pdf.renderer.js';
import type { PreparedKaufvertrag } from './kaufvertrag-pdf.snapshot.service.js';
import {
  buildKaufvertragArchiveIdentity,
  buildKaufvertragArchiveKey,
  type KaufvertragSnapshotBranding,
} from './kaufvertrag-snapshot.js';

export const KAUFVERTRAG_PDF_CONTENT_TYPE = 'application/pdf';

export function toErrorMessage(error: unknown): string {
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

/**
 * Renders the Kaufvertrag PDF, stores it as an immutable archive object, records the archive
 * pointer on the sale, and reads the archived bytes back. The key depends on the snapshot hash,
 * so identical facts reuse one object and changed facts create a new one.
 */
@Injectable()
export class KaufvertragPdfArchiveService {
  private readonly logger = new Logger(KaufvertragPdfArchiveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly renderer: KaufvertragPdfRenderer,
    private readonly storage: PdfStorage,
    @Optional()
    @Inject(DocumentBrandingAssetStorage)
    private readonly brandingStorage: DocumentBrandingAssetStorage | undefined,
  ) {}

  async renderAndArchive(
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

  /** Reads the exact archived generation, after checking the stored key belongs to these facts. */
  async readArchive(params: {
    tenantId: string;
    saleId: string;
    snapshotSha256: string;
    pointer: { bucket: string; key: string; generation: string; sha256: string };
  }) {
    const { tenantId, saleId, snapshotSha256, pointer } = params;
    const identity = buildKaufvertragArchiveIdentity({
      tenantId,
      saleId,
      snapshotSha256,
    });
    const expectedKey = buildKaufvertragArchiveKey({
      tenantId,
      saleId,
      snapshotSha256,
    });
    if (pointer.key !== expectedKey) {
      throw brandRenderInputUnavailable(
        'Kaufvertrag archive reference is inconsistent.',
      );
    }

    return this.storage.readImmutableObjectGeneration({
      bucket: pointer.bucket,
      key: pointer.key,
      generation: pointer.generation,
      expectedSha256: pointer.sha256,
      validateMetadata: (metadata) => matchesIdentity(metadata, identity),
    });
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

  async persistArchive(
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

  async clearGenerationError(saleId: string, tenantId: string): Promise<void> {
    await this.prisma.client.vehicleSale.updateMany({
      where: { id: saleId, tenant_id: tenantId },
      data: { kaufvertrag_generation_error: null },
    });
  }

  async safeStoreGenerationError(
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
