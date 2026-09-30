import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import type { Prisma as PrismaTypes } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { DocumentBrandingAssetStorage } from './document-branding-asset-storage.js';
import { DocumentBrandingUploadTaskService } from './document-branding-upload-task.service.js';
import { startDerivedLogoGraceIfUnreferenced } from './document-branding-extraction-retention.js';

const INITIAL_DISPATCH_GRACE_MS = 60 * 1000;
const DISPATCH_RECOVERY_GRACE_MS = 11 * 60 * 1000;

@Injectable()
export class DocumentBrandingUploadRecoveryService {
  private readonly logger = new Logger(
    DocumentBrandingUploadRecoveryService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: DocumentBrandingAssetStorage,
    private readonly tasks: DocumentBrandingUploadTaskService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'document-branding-upload-recovery',
  })
  async recoverAndClean() {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    const tenantIds = tenants.map(({ id }) => id);
    if (tenantIds.length === 0) return;

    const now = new Date();
    const staleBefore = new Date(now.getTime() - INITIAL_DISPATCH_GRACE_MS);
    const dispatchedStaleBefore = new Date(
      now.getTime() - DISPATCH_RECOVERY_GRACE_MS,
    );
    await this.prisma.documentBrandQuotaEvent.deleteMany({
      where: {
        tenant_id: { in: tenantIds },
        created_at: { lt: new Date(now.getTime() - 60 * 60 * 1000) },
      },
    });
    await this.prisma.documentBrandAsset.updateMany({
      where: {
        tenant_id: { in: tenantIds },
        state: 'QUARANTINED',
        validation_attempt_count: { gte: 3 },
        validation_lease_until: { lt: now },
      },
      data: {
        state: 'REJECTED',
        failure_code: 'VALIDATION_RETRIES_EXHAUSTED',
        expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        validation_lease_until: null,
      },
    });
    const pending = await this.prisma.documentBrandAsset.findMany({
      where: {
        tenant_id: { in: tenantIds },
        state: 'QUARANTINED',
        validation_attempt_count: { lt: 3 },
        OR: [
          { validation_lease_until: { lt: now } },
          {
            validation_lease_until: null,
            OR: [
              {
                validation_dispatched_at: null,
                createdAt: { lt: staleBefore },
              },
              { validation_dispatched_at: { lt: dispatchedStaleBefore } },
            ],
          },
        ],
      },
      select: { id: true, tenant_id: true },
      take: 100,
      orderBy: { createdAt: 'asc' },
    });
    await Promise.all(
      pending.map(({ id, tenant_id }) =>
        this.tasks
          .enqueue({ assetId: id, tenantId: tenant_id })
          .catch((error: unknown) => {
            this.logger.warn(
              `Could not requeue quarantined branding asset ${id}: ${safeError(error)}`,
            );
          }),
      ),
    );

    const expired = await this.prisma.documentBrandAsset.findMany({
      where: {
        tenant_id: { in: tenantIds },
        expires_at: { lte: now },
        state: { in: ['READY', 'QUARANTINED', 'REJECTED', 'DELETING'] },
      },
      select: { id: true, tenant_id: true, legal_entity_id: true },
      take: 100,
      orderBy: { expires_at: 'asc' },
    });
    await Promise.all(expired.map((asset) => this.deleteExpired(asset)));
    const publishedWithQuarantine =
      await this.prisma.documentBrandAsset.findMany({
        where: {
          tenant_id: { in: tenantIds },
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
      publishedWithQuarantine.map(async (asset) => {
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
      }),
    );
  }

  private async deleteExpired(asset: {
    id: string;
    tenant_id: string;
    legal_entity_id: string;
  }) {
    const target = await this.prisma.$transaction(async (tx) => {
      const entity = await tx.legalEntity.findFirst({
        where: { tenant_id: asset.tenant_id, id: asset.legal_entity_id },
        select: { id: true, is_active: true },
      });
      if (!entity) return null;
      const entityLock = await tx.legalEntity.updateMany({
        where: {
          tenant_id: asset.tenant_id,
          id: asset.legal_entity_id,
          is_active: entity.is_active,
        },
        data: { is_active: entity.is_active },
      });
      if (entityLock.count !== 1) return null;
      const current = await tx.documentBrandAsset.findFirst({
        where: {
          id: asset.id,
          tenant_id: asset.tenant_id,
          legal_entity_id: asset.legal_entity_id,
        },
      });
      if (
        !current ||
        current.state === 'DELETED' ||
        (current.state !== 'DELETING' &&
          (!current.expires_at ||
            current.expires_at > new Date() ||
            (current.state !== 'READY' &&
              current.state !== 'QUARANTINED' &&
              current.state !== 'REJECTED')))
      )
        return null;

      if (await this.releaseExpiredExtractionReferences(tx, current, asset)) {
        return null;
      }
      if (await this.hasCleanupReferences(tx, asset)) return null;

      if (current.state !== 'DELETING') {
        const marked = await tx.documentBrandAsset.updateMany({
          where: {
            id: current.id,
            tenant_id: asset.tenant_id,
            legal_entity_id: asset.legal_entity_id,
            state: current.state,
            expires_at: { lte: new Date() },
          },
          data: { state: 'DELETING' },
        });
        if (marked.count !== 1) return null;
      }
      return {
        bucket: current.bucket,
        object_key: current.object_key,
        object_generation: current.object_generation,
        quarantine_bucket: current.quarantine_bucket,
        quarantine_object_key: current.quarantine_object_key,
        quarantine_object_generation: current.quarantine_object_generation,
        preview_bucket: current.preview_bucket,
        preview_object_key: current.preview_object_key,
        preview_object_generation: current.preview_object_generation,
      };
    });
    if (!target) return;

    const confirmedTarget = await this.prisma.$transaction(async (tx) => {
      const entity = await tx.legalEntity.findFirst({
        where: { tenant_id: asset.tenant_id, id: asset.legal_entity_id },
        select: { id: true, is_active: true },
      });
      if (!entity) return null;
      const entityLock = await tx.legalEntity.updateMany({
        where: {
          tenant_id: asset.tenant_id,
          id: asset.legal_entity_id,
          is_active: entity.is_active,
        },
        data: { is_active: entity.is_active },
      });
      if (entityLock.count !== 1) return null;

      const current = await tx.documentBrandAsset.findFirst({
        where: {
          id: asset.id,
          tenant_id: asset.tenant_id,
          legal_entity_id: asset.legal_entity_id,
          state: 'DELETING',
        },
      });
      if (!current || (await this.hasCleanupReferences(tx, asset))) return null;
      return {
        bucket: current.bucket,
        object_key: current.object_key,
        object_generation: current.object_generation,
        quarantine_bucket: current.quarantine_bucket,
        quarantine_object_key: current.quarantine_object_key,
        quarantine_object_generation: current.quarantine_object_generation,
        preview_bucket: current.preview_bucket,
        preview_object_key: current.preview_object_key,
        preview_object_generation: current.preview_object_generation,
      };
    });
    if (!confirmedTarget) return;

    try {
      if (
        confirmedTarget.object_key &&
        confirmedTarget.bucket &&
        confirmedTarget.object_generation
      ) {
        await this.storage.deleteGeneration(
          confirmedTarget.bucket,
          confirmedTarget.object_key,
          confirmedTarget.object_generation,
        );
      }
      if (
        confirmedTarget.preview_object_key &&
        confirmedTarget.preview_bucket &&
        confirmedTarget.preview_object_generation
      ) {
        await this.storage.deleteGeneration(
          confirmedTarget.preview_bucket,
          confirmedTarget.preview_object_key,
          confirmedTarget.preview_object_generation,
        );
      }
      if (
        confirmedTarget.quarantine_bucket &&
        confirmedTarget.quarantine_object_key &&
        confirmedTarget.quarantine_object_generation
      ) {
        await this.storage.deleteGeneration(
          confirmedTarget.quarantine_bucket,
          confirmedTarget.quarantine_object_key,
          confirmedTarget.quarantine_object_generation,
        );
      }
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

  private async hasCleanupReferences(
    tx: PrismaTypes.TransactionClient,
    asset: { id: string; tenant_id: string; legal_entity_id: string },
  ): Promise<boolean> {
    const [
      profileReference,
      derivedAsset,
      invoiceReference,
      extractionReference,
    ] = await Promise.all([
      tx.documentBrandProfile.findFirst({
        where: {
          tenant_id: asset.tenant_id,
          legal_entity_id: asset.legal_entity_id,
          OR: [
            { active_logo_asset_id: asset.id },
            { draft_logo_asset_id: asset.id },
            { draft_source_asset_id: asset.id },
          ],
        },
        select: { id: true },
      }),
      tx.documentBrandAsset.findFirst({
        where: {
          tenant_id: asset.tenant_id,
          legal_entity_id: asset.legal_entity_id,
          source_asset_id: asset.id,
        },
        select: { id: true },
      }),
      tx.invoiceBrandAssetReference.findFirst({
        where: {
          tenant_id: asset.tenant_id,
          legal_entity_id: asset.legal_entity_id,
          asset_id: asset.id,
        },
        select: { id: true },
      }),
      tx.documentBrandExtraction.findFirst({
        where: {
          tenant_id: asset.tenant_id,
          legal_entity_id: asset.legal_entity_id,
          OR: [
            { source_asset_id: asset.id, state: { in: ['QUEUED', 'RUNNING'] } },
            {
              proposal_logo_asset_id: asset.id,
              expires_at: { gt: new Date() },
            },
          ],
        },
        select: { id: true },
      }),
    ]);
    return Boolean(
      profileReference ||
      derivedAsset ||
      invoiceReference ||
      extractionReference,
    );
  }

  private async releaseExpiredExtractionReferences(
    tx: PrismaTypes.TransactionClient,
    current: { id: string; purpose: 'SOURCE' | 'LOGO' },
    asset: { id: string; tenant_id: string; legal_entity_id: string },
  ): Promise<boolean> {
    const now = new Date();
    if (current.purpose === 'SOURCE') {
      await tx.documentBrandAsset.updateMany({
        where: {
          tenant_id: asset.tenant_id,
          legal_entity_id: asset.legal_entity_id,
          source_asset_id: current.id,
        },
        data: { source_asset_id: null },
      });
      await tx.documentBrandExtraction.updateMany({
        where: {
          tenant_id: asset.tenant_id,
          legal_entity_id: asset.legal_entity_id,
          source_asset_id: current.id,
          state: { in: ['QUEUED', 'RUNNING'] },
        },
        data: {
          state: 'FAILED',
          failure_code: 'BRAND_SOURCE_EXPIRED',
          lease_token: null,
          lease_until: null,
          completed_at: now,
          expires_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        },
      });
      await tx.documentBrandExtraction.updateMany({
        where: {
          tenant_id: asset.tenant_id,
          legal_entity_id: asset.legal_entity_id,
          source_asset_id: current.id,
        },
        data: { source_asset_id: null },
      });
    }
    const released = await tx.documentBrandExtraction.updateMany({
      where: {
        tenant_id: asset.tenant_id,
        legal_entity_id: asset.legal_entity_id,
        proposal_logo_asset_id: current.id,
        expires_at: { lte: now },
      },
      data: { proposal: Prisma.JsonNull, proposal_logo_asset_id: null },
    });
    if (released.count > 0 && current.purpose === 'LOGO') {
      return startDerivedLogoGraceIfUnreferenced(tx, {
        tenantId: asset.tenant_id,
        legalEntityId: asset.legal_entity_id,
        assetId: current.id,
        now,
      });
    }
    return false;
  }
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}
