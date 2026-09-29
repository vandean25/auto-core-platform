import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { DocumentBrandingExtractionTaskService } from './document-branding-extraction-task.service.js';
import { startDerivedLogoGraceIfUnreferenced } from './document-branding-extraction-retention.js';

const INITIAL_DISPATCH_GRACE_MS = 60 * 1000;
const DISPATCH_RECOVERY_GRACE_MS = 11 * 60 * 1000;
const EXTRACTION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class DocumentBrandingExtractionRecoveryService {
  private readonly logger = new Logger(
    DocumentBrandingExtractionRecoveryService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: DocumentBrandingExtractionTaskService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'document-branding-extraction-recovery',
  })
  async recover() {
    const tenantRows = await this.prisma.tenant.findMany({
      select: { id: true },
    });
    const tenantIds = tenantRows.map(({ id }) => id);
    if (tenantIds.length === 0) return;

    const now = new Date();
    const queued = await this.prisma.documentBrandExtraction.findMany({
      where: {
        tenant_id: { in: tenantIds },
        state: 'QUEUED',
        attempt_count: { lt: 3 },
        OR: [
          {
            dispatched_at: null,
            createdAt: {
              lt: new Date(now.getTime() - INITIAL_DISPATCH_GRACE_MS),
            },
          },
          {
            dispatched_at: {
              lt: new Date(now.getTime() - DISPATCH_RECOVERY_GRACE_MS),
            },
          },
        ],
      },
      select: {
        id: true,
        tenant_id: true,
        legal_entity_id: true,
        attempt_count: true,
      },
      take: 100,
      orderBy: { createdAt: 'asc' },
    });
    await Promise.all(queued.map((job) => this.requeue(job)));

    const expiredLeases = await this.prisma.documentBrandExtraction.findMany({
      where: {
        tenant_id: { in: tenantIds },
        state: 'RUNNING',
        lease_until: { lt: now },
      },
      select: {
        id: true,
        tenant_id: true,
        legal_entity_id: true,
        attempt_count: true,
        lease_token: true,
      },
      take: 100,
      orderBy: { lease_until: 'asc' },
    });
    await Promise.all(
      expiredLeases.map(async (job) => {
        const retry = job.attempt_count < 3;
        const updated = await this.prisma.documentBrandExtraction.updateMany({
          where: {
            id: job.id,
            tenant_id: job.tenant_id,
            legal_entity_id: job.legal_entity_id,
            state: 'RUNNING',
            lease_token: job.lease_token,
            lease_until: { lt: now },
          },
          data: {
            state: retry ? 'QUEUED' : 'FAILED',
            failure_code: retry ? null : 'BRAND_EXTRACTION_RETRIES_EXHAUSTED',
            lease_token: null,
            lease_until: null,
            dispatched_at: null,
            completed_at: retry ? null : now,
            expires_at: retry
              ? null
              : new Date(now.getTime() + EXTRACTION_RETENTION_MS),
          },
        });
        if (updated.count === 1 && retry) await this.requeue(job);
      }),
    );

    const expiredProposals = await this.prisma.documentBrandExtraction.findMany(
      {
        where: {
          tenant_id: { in: tenantIds },
          state: 'SUCCEEDED',
          expires_at: { lte: now },
          OR: [
            { proposal: { not: Prisma.DbNull } },
            { proposal_logo_asset_id: { not: null } },
          ],
        },
        select: {
          id: true,
          tenant_id: true,
          legal_entity_id: true,
          proposal_logo_asset_id: true,
        },
        take: 100,
        orderBy: { expires_at: 'asc' },
      },
    );
    await Promise.all(
      expiredProposals.map((job) =>
        this.prisma.$transaction(async (tx) => {
          const entity = await tx.legalEntity.findFirst({
            where: { id: job.legal_entity_id, tenant_id: job.tenant_id },
            select: { id: true, is_active: true },
          });
          if (!entity) return;
          const locked = await tx.legalEntity.updateMany({
            where: {
              id: job.legal_entity_id,
              tenant_id: job.tenant_id,
              is_active: entity.is_active,
            },
            data: { is_active: entity.is_active },
          });
          if (locked.count !== 1) return;
          const released = await tx.documentBrandExtraction.updateMany({
            where: {
              id: job.id,
              tenant_id: job.tenant_id,
              legal_entity_id: job.legal_entity_id,
              state: 'SUCCEEDED',
              expires_at: { lte: now },
            },
            data: { proposal: Prisma.DbNull, proposal_logo_asset_id: null },
          });
          if (released.count === 1 && job.proposal_logo_asset_id) {
            await startDerivedLogoGraceIfUnreferenced(tx, {
              tenantId: job.tenant_id,
              legalEntityId: job.legal_entity_id,
              assetId: job.proposal_logo_asset_id,
              now,
            });
          }
        }),
      ),
    );
  }

  private async requeue(job: {
    id: string;
    tenant_id: string;
    legal_entity_id: string;
    attempt_count: number;
  }) {
    try {
      await this.tasks.enqueue({
        extractionId: job.id,
        legalEntityId: job.legal_entity_id,
        tenantId: job.tenant_id,
        expectedAttemptCount: job.attempt_count,
      });
    } catch (error) {
      this.logger.warn(
        `Could not requeue document branding extraction ${job.id}: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
    }
  }
}
