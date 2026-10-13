import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { DocumentBrandingAssetStorage } from './document-branding-asset-storage.js';
import {
  type CleanupTx,
  hasCleanupReferences,
  releaseExpiredExtractionReferences,
} from './document-branding-cleanup-references.js';
import {
  type ExpiredAssetRef,
  isDeletionDue,
  RECOVERY_LOG_CONTEXT,
  safeError,
  toGenerationTarget,
} from './document-branding-upload-recovery.rules.js';

type GenerationTarget = ReturnType<typeof toGenerationTarget>;

/**
 * Deletes expired branding assets and their storage generations, and drops quarantine
 * copies that outlived validation. Deletion runs in two guarded transactions so a
 * reference committed between them blocks the delete.
 */
@Injectable()
export class DocumentBrandingAssetCleanupService {
  private readonly logger = new Logger(RECOVERY_LOG_CONTEXT);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: DocumentBrandingAssetStorage,
  ) {}

  async purgeExpired(now: Date) {
    const expired = await this.prisma.documentBrandAsset.findMany({
      where: {
        expires_at: { lte: now },
        state: { in: ['READY', 'QUARANTINED', 'REJECTED', 'DELETING'] },
        // A sent estimate version pins its logo (ADR-0025 §3). Skip pinned logos here so
        // they do not fill the batch on every run.
        workshopEstimateReferences: { none: {} },
      },
      select: { id: true, tenant_id: true, legal_entity_id: true },
      take: 100,
      orderBy: { expires_at: 'asc' },
    });
    await Promise.all(expired.map((asset) => this.deleteExpired(asset)));
  }

  async removeStaleQuarantineCopies() {
    const publishedWithQuarantine =
      await this.prisma.documentBrandAsset.findMany({
        where: {
          state: 'READY',
          quarantine_bucket: { not: null },
          quarantine_object_key: { not: null },
          quarantine_object_generation: { not: null },
        },
        select: {
          id: true,
          tenant_id: true,
          quarantine_bucket: true,
          quarantine_object_key: true,
          quarantine_object_generation: true,
        },
        take: 100,
        orderBy: { updatedAt: 'asc' },
      });
    await Promise.all(
      publishedWithQuarantine.map((asset) => this.removeQuarantineCopy(asset)),
    );
  }

  private async deleteExpired(asset: ExpiredAssetRef) {
    if (!(await this.markForDeletion(asset))) return;
    const confirmedTarget = await this.confirmDeletionTarget(asset);
    if (!confirmedTarget) return;

    try {
      await this.deleteGenerations(confirmedTarget);
      await this.prisma.documentBrandAsset.updateMany({
        where: { id: asset.id, tenant_id: asset.tenant_id, state: 'DELETING' },
        data: {
          state: 'DELETED',
          validation_lease_until: null,
          preview_bucket: null,
          preview_object_key: null,
          preview_object_generation: null,
        },
      });
    } catch (error) {
      this.logger.error(
        `Could not delete expired branding asset ${asset.id}: ${safeError(error)}`,
      );
    }
  }

  private markForDeletion(asset: ExpiredAssetRef) {
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockEntityForCleanup(tx, asset))) return null;
      const current = await tx.documentBrandAsset.findFirst({
        where: {
          id: asset.id,
          tenant_id: asset.tenant_id,
          legal_entity_id: asset.legal_entity_id,
        },
      });
      if (!current || !isDeletionDue(current, new Date())) return null;
      if (await releaseExpiredExtractionReferences(tx, current, asset)) {
        return null;
      }
      if (await hasCleanupReferences(tx, asset)) return null;

      if (current.state !== 'DELETING') {
        const marked = await tx.documentBrandAsset.updateMany({
          where: {
            id: current.id,
            tenant_id: asset.tenant_id,
            legal_entity_id: asset.legal_entity_id,
            state: current.state,
            expires_at: { lte: new Date() },
            // A sent estimate version pins its logo (ADR-0025 §3).
            workshopEstimateReferences: { none: {} },
          },
          data: { state: 'DELETING' },
        });
        if (marked.count !== 1) return null;
      }
      return toGenerationTarget(current);
    });
  }

  private confirmDeletionTarget(asset: ExpiredAssetRef) {
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockEntityForCleanup(tx, asset))) return null;
      const current = await tx.documentBrandAsset.findFirst({
        where: {
          id: asset.id,
          tenant_id: asset.tenant_id,
          legal_entity_id: asset.legal_entity_id,
          state: 'DELETING',
          // A sent estimate version pins its logo (ADR-0025 §3).
          workshopEstimateReferences: { none: {} },
        },
      });
      if (!current || (await hasCleanupReferences(tx, asset))) return null;
      return toGenerationTarget(current);
    });
  }

  private async deleteGenerations(target: GenerationTarget) {
    await this.deleteGenerationIfPresent(
      target.bucket,
      target.object_key,
      target.object_generation,
    );
    await this.deleteGenerationIfPresent(
      target.preview_bucket,
      target.preview_object_key,
      target.preview_object_generation,
    );
    await this.deleteGenerationIfPresent(
      target.quarantine_bucket,
      target.quarantine_object_key,
      target.quarantine_object_generation,
    );
  }

  private async deleteGenerationIfPresent(
    bucket: string | null,
    objectKey: string | null,
    generation: string | null,
  ) {
    if (bucket && objectKey && generation) {
      await this.storage.deleteGeneration(bucket, objectKey, generation);
    }
  }

  private async removeQuarantineCopy(asset: {
    id: string;
    tenant_id: string;
    quarantine_bucket: string | null;
    quarantine_object_key: string | null;
    quarantine_object_generation: string | null;
  }) {
    if (
      !asset.quarantine_bucket ||
      !asset.quarantine_object_key ||
      !asset.quarantine_object_generation
    ) {
      return;
    }
    try {
      await this.storage.deleteGeneration(
        asset.quarantine_bucket,
        asset.quarantine_object_key,
        asset.quarantine_object_generation,
      );
      await this.prisma.documentBrandAsset.updateMany({
        where: { id: asset.id, tenant_id: asset.tenant_id, state: 'READY' },
        data: {
          quarantine_bucket: null,
          quarantine_object_key: null,
          quarantine_object_generation: null,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Could not remove the quarantine copy for branding asset ${asset.id}: ${safeError(error)}`,
      );
    }
  }
}

/** Locks the owning entity for a cleanup transaction; false when it is gone or changed. */
async function lockEntityForCleanup(
  tx: CleanupTx,
  asset: ExpiredAssetRef,
): Promise<boolean> {
  const entity = await tx.legalEntity.findFirst({
    where: { tenant_id: asset.tenant_id, id: asset.legal_entity_id },
    select: { id: true, is_active: true },
  });
  if (!entity) return false;
  const entityLock = await tx.legalEntity.updateMany({
    where: {
      tenant_id: asset.tenant_id,
      id: asset.legal_entity_id,
      is_active: entity.is_active,
    },
    data: { is_active: entity.is_active },
  });
  return entityLock.count === 1;
}
