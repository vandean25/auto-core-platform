import { randomUUID } from 'node:crypto';
import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  AuditActorType,
  AuditLogAction,
  Prisma,
  TransactionType,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { chunkedPromiseAll } from '../common/utils/promise.util.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import type {
  RevaluationGapDto,
  RevaluationReportDto,
  RevaluedAdjustmentDto,
} from './dto/revalue-unvalued-adjustments.dto.js';
import { InventoryItemMutationsService } from './inventory-item-mutations.service.js';
import { LedgerService } from './ledger.service.js';
import {
  MANUAL_ADJUSTMENT_REFERENCE,
  REVALUATION_BATCH_SIZE,
  REVALUATION_NOTE,
  classifyProcessedOriginals,
  planRevaluations,
  type PlannedRevaluation,
  type ResolvedAdjustmentCost,
  type RevaluationCandidate,
} from './revalue-unvalued-adjustments.plan.js';

type Db = Prisma.TransactionClient | PrismaService;

const CANDIDATE_SELECT = {
  id: true,
  item_id: true,
  location_id: true,
  site_id: true,
  quantity: true,
  reason: true,
} as const;

const BATCH_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 60_000 } as const;

interface BatchResult {
  revalued: RevaluedAdjustmentDto[];
  gaps: RevaluationGapDto[];
}

/**
 * AUT-1050: revalues legacy unvalued manual corrections (ADJUSTMENT, cost_basis null) by a Gegenbuchung plus a new
 * valued ADJUSTMENT dated now, both noted "nachbewertet". The original row is never updated.
 * Each batch of REVALUATION_BATCH_SIZE originals is one database transaction: a failure rolls back that batch only,
 * batches committed before it stay consistent (every pair is complete) and are skipped on the next run.
 */
@Injectable()
export class RevalueUnvaluedAdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
    private readonly auditService: AuditService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly mutations: InventoryItemMutationsService,
  ) {}

  async run(dryRun: boolean): Promise<RevaluationReportDto> {
    const tenantId = await this.tenantContext.getTenantId();
    const access = await this.mutations.resolveMemberAccess(tenantId);
    if (!access.permissions.has('stock.adjust')) {
      throw new ForbiddenException(
        'Only OWNER or ADMIN can revalue stock corrections.',
      );
    }
    const siteIds = await this.siteContext.listAuthorizedSiteIds();
    const scope = {
      tenant_id: tenantId,
      type: TransactionType.ADJUSTMENT,
      reference_id: MANUAL_ADJUSTMENT_REFERENCE,
      cost_basis: null,
      reversal_of_transaction_id: null,
    };
    const [pending, processed] = await Promise.all([
      this.prisma.inventoryTransaction.findMany({
        where: {
          ...scope,
          site_id: { in: siteIds },
          reversed_by: { none: {} },
        },
        select: CANDIDATE_SELECT,
        orderBy: { seq: 'asc' },
      }),
      this.prisma.inventoryTransaction.findMany({
        where: {
          ...scope,
          site_id: { in: siteIds },
          reversed_by: { some: {} },
        },
        select: { id: true, reversed_by: { select: { note: true } } },
        orderBy: { seq: 'asc' },
      }),
    ]);

    const batches: RevaluationCandidate[][] = [];
    for (let i = 0; i < pending.length; i += REVALUATION_BATCH_SIZE) {
      batches.push(pending.slice(i, i + REVALUATION_BATCH_SIZE));
    }
    // Batches run one after another (chunk size 1) so each commits before the next starts.
    const results = await chunkedPromiseAll(
      batches,
      (batch) =>
        dryRun
          ? this.planBatch(this.prisma, tenantId, batch)
          : this.prisma.$transaction(
              (tx) => this.applyBatch(tx, tenantId, siteIds, batch),
              BATCH_TRANSACTION_OPTIONS,
            ),
      1,
    );

    return {
      dryRun,
      batchSize: REVALUATION_BATCH_SIZE,
      revalued: results.flatMap((r) => r.revalued),
      gaps: results.flatMap((r) => r.gaps),
      ...classifyProcessedOriginals(processed),
    };
  }

  private async planBatch(
    db: Db,
    tenantId: string,
    batch: RevaluationCandidate[],
  ): Promise<BatchResult & { planned: PlannedRevaluation[] }> {
    const costs = await this.resolveCosts(db, tenantId, batch);
    const { planned, gaps } = planRevaluations(batch, costs, randomUUID);
    return {
      planned,
      revalued: planned.map((p) => toReportEntry(p, null, null)),
      gaps: gaps.map((g) => ({
        originalTransactionId: g.id,
        itemId: g.item_id,
        locationId: g.location_id,
      })),
    };
  }

  private async applyBatch(
    tx: Prisma.TransactionClient,
    tenantId: string,
    siteIds: string[],
    batch: RevaluationCandidate[],
  ): Promise<BatchResult> {
    const { planned, gaps } = await this.planBatch(tx, tenantId, batch);
    if (planned.length === 0) return { revalued: [], gaps };

    // Both rows of all pairs in one insert; the unique reversal_of_transaction_id blocks a concurrent second pair.
    await this.ledgerService.recordTransactions(
      planned.flatMap((p) => p.bookings),
      tx,
    );
    const written = await tx.inventoryTransaction.findMany({
      where: {
        tenant_id: tenantId,
        site_id: { in: siteIds },
        movement_group_id: { in: planned.map((p) => p.movementGroupId) },
      },
      select: {
        id: true,
        movement_group_id: true,
        reversal_of_transaction_id: true,
      },
    });

    const revalued = planned.map((p) => {
      const pair = written.filter(
        (row) => row.movement_group_id === p.movementGroupId,
      );
      const reversalId = pair.find(
        (row) => row.reversal_of_transaction_id !== null,
      )!.id;
      const revaluedId = pair.find(
        (row) => row.reversal_of_transaction_id === null,
      )!.id;
      return toReportEntry(p, reversalId, revaluedId);
    });

    await chunkedPromiseAll(revalued, (entry) =>
      this.auditService.recordTenantMutation(
        {
          entityType: 'CATALOG_ITEM',
          entityId: entry.itemId,
          action: AuditLogAction.UPDATE,
          actorType: AuditActorType.MIGRATION,
          source: 'inventory.adjustment_revaluation',
          after: { ...entry, note: REVALUATION_NOTE },
        },
        tx,
      ),
    );

    return { revalued, gaps };
  }

  /** AUT-1048 cost order per original: AVG of its legal entity, else last EK; null when neither exists. */
  private async resolveCosts(
    db: Db,
    tenantId: string,
    batch: RevaluationCandidate[],
  ): Promise<Map<string, ResolvedAdjustmentCost>> {
    const sites = await db.site.findMany({
      where: {
        tenant_id: tenantId,
        id: { in: [...new Set(batch.map((c) => c.site_id))] },
      },
      select: { id: true, legal_entity_id: true },
    });
    const legalEntityBySite = new Map(
      sites.map((s) => [s.id, s.legal_entity_id]),
    );
    const keys = new Map<string, { legalEntityId: string; itemId: string }>();
    for (const c of batch) {
      const legalEntityId = legalEntityBySite.get(c.site_id);
      if (legalEntityId)
        keys.set(`${legalEntityId}:${c.item_id}`, {
          legalEntityId,
          itemId: c.item_id,
        });
    }
    // shortcut: one AVG/Last-EK lookup per distinct article of the batch (bounded by REVALUATION_BATCH_SIZE), set-based reads if legacy volumes grow.
    const costByKey = new Map(
      await chunkedPromiseAll(
        [...keys],
        async ([key, k]) =>
          [
            key,
            await this.mutations.resolveAutomaticAdjustmentCost(
              db,
              tenantId,
              k.legalEntityId,
              k.itemId,
            ),
          ] as const,
      ),
    );
    return new Map(
      batch.map((c) => [
        c.id,
        costByKey.get(`${legalEntityBySite.get(c.site_id)}:${c.item_id}`) ?? {
          unitCost: null,
          valueSource: null,
        },
      ]),
    );
  }
}

function toReportEntry(
  p: PlannedRevaluation,
  reversalTransactionId: string | null,
  revaluedTransactionId: string | null,
): RevaluedAdjustmentDto {
  return {
    originalTransactionId: p.original.id,
    itemId: p.original.item_id,
    locationId: p.original.location_id,
    quantity: p.original.quantity.toString(),
    unitCost: p.unitCost.toString(),
    valueSource: p.valueSource,
    reversalTransactionId,
    revaluedTransactionId,
  };
}
