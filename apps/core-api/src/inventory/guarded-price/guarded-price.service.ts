import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InventoryPriceOperationState, Prisma } from '@prisma/client';
import { AuditService } from '../../audit/audit.service.js';
import { DashboardRealtimeService } from '../../dashboard-realtime/dashboard-realtime.service.js';
import { DashboardRealtimeDeferStorage } from '../../dashboard-realtime/dashboard-realtime-defer.storage.js';
import { TenantContextService } from '../../common/services/tenant-context.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { assertCanMutateInventoryStock } from '../inventory-access.guards.js';
import { toCatalogItemResponseDto } from '../catalog-item-response.mapper.js';
import type { GuardedPriceReceiptDto } from '../dto/guarded-inventory-price.dto.js';
import {
  acquireGuardedPriceAdvisoryLock,
  lockGuardedPriceJournalRow,
  setGuardedPriceTxALockTimeout,
} from '../guarded-price-operation-locks.js';
import {
  assertKeyAdmissionOnNoRowInsert,
  resolveOperationKey,
} from './guarded-price-admission.js';
import {
  GUARDED_PRICE_KIND,
  idempotencyKeyReused,
  inventoryRevisionConflict,
  operationUnresolved,
} from './guarded-price.errors.js';
import {
  haltForFinalJournalState,
  isInteractiveTransactionExpired,
  isLockTimeoutError,
  isUniqueViolation,
} from './guarded-price.helpers.js';
import {
  frozenIntentMatchesRow,
  type GuardedPriceIntent,
} from './guarded-price-intent.js';
import { retailMajorToMinorUnits } from './guarded-price.money.js';
import { receiptFromAppliedJournal } from './guarded-price-receipt.js';
import { revisionToDb } from './guarded-price.revision.js';
import { executeGuardedPriceTxE } from './guarded-price-txe.js';

@Injectable()
export class GuardedPriceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
    private readonly dashboardRealtime: DashboardRealtimeService,
  ) {}

  async patchGuardedPrice(
    itemId: string,
    retailPrice: number,
    expectedRevision: number,
    idempotencyHeader: string | undefined,
    operationKeyQuery: string | undefined,
  ): Promise<GuardedPriceReceiptDto> {
    const role = this.tenantContext.getAuthenticatedUser()?.role;
    assertCanMutateInventoryStock(role);
    const principalId = this.requirePrincipalId();
    const tenantId = await this.tenantContext.getTenantId();
    const operationKey = resolveOperationKey(
      idempotencyHeader,
      operationKeyQuery,
    );
    const targetMinor = retailMajorToMinorUnits(retailPrice);

    const replayReceipt = await this.tryReplayWithoutCatalogItem(
      itemId,
      tenantId,
      principalId,
      operationKey,
      expectedRevision,
      targetMinor,
    );
    if (replayReceipt) {
      return replayReceipt;
    }

    const item = await this.prisma.catalogItem.findFirst({
      where: { id: itemId, tenant_id: tenantId },
    });
    if (!item) {
      throw new NotFoundException(`Catalog item ${itemId} not found`);
    }

    const intent: GuardedPriceIntent = {
      itemId,
      expectedRevision,
      targetMinor,
      basisMinor: retailMajorToMinorUnits(Number(item.retail_price)),
      sku: item.sku,
    };

    const txAResult = await this.runTxA(
      tenantId,
      principalId,
      operationKey,
      intent,
    );
    if (txAResult.kind === 'replay') {
      return txAResult.receipt;
    }
    if (txAResult.kind === 'halt') {
      txAResult.throw();
    }
    if (txAResult.kind !== 'proceed') {
      operationUnresolved('Guarded acceptance did not proceed to execution.');
    }

    return await this.runTxE(tenantId, principalId, operationKey, intent);
  }

  private async tryReplayWithoutCatalogItem(
    itemId: string,
    tenantId: string,
    principalId: string,
    operationKey: string,
    expectedRevision: number,
    targetMinor: bigint,
  ): Promise<GuardedPriceReceiptDto | null> {
    const priorJournal = await this.prisma.inventoryPriceOperation.findFirst({
      where: {
        tenant_id: tenantId,
        principal_id: principalId,
        key: operationKey,
        item_id: itemId,
      },
    });
    if (
      !priorJournal ||
      priorJournal.state !== InventoryPriceOperationState.APPLIED ||
      priorJournal.expected_revision !== revisionToDb(expectedRevision) ||
      priorJournal.target_minor !== targetMinor
    ) {
      return null;
    }

    const item = await this.prisma.catalogItem.findFirst({
      where: { id: itemId, tenant_id: tenantId },
    });
    if (item) {
      return null;
    }

    const intent: GuardedPriceIntent = {
      itemId,
      expectedRevision,
      targetMinor,
      basisMinor: priorJournal.basis_minor,
      sku: priorJournal.sku,
    };
    const txAResult = await this.runTxA(
      tenantId,
      principalId,
      operationKey,
      intent,
    );
    if (txAResult.kind === 'replay') {
      return txAResult.receipt;
    }
    return null;
  }

  private requirePrincipalId(): string {
    const user = this.tenantContext.getAuthenticatedUser();
    if (!user?.userId) {
      throw new ForbiddenException('Authenticated principal is required.');
    }
    return user.userId;
  }

  private async runTxA(
    tenantId: string,
    principalId: string,
    operationKey: string,
    intent: GuardedPriceIntent,
  ): Promise<
    | { kind: 'proceed' }
    | { kind: 'replay'; receipt: GuardedPriceReceiptDto }
    | { kind: 'halt'; throw: () => never }
  > {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await setGuardedPriceTxALockTimeout(tx);
          await acquireGuardedPriceAdvisoryLock(
            tx,
            tenantId,
            principalId,
            operationKey,
          );

          const existing = await tx.inventoryPriceOperation.findFirst({
            where: {
              tenant_id: tenantId,
              principal_id: principalId,
              key: operationKey,
            },
          });

          if (existing) {
            return await this.handleExistingJournalRow(
              tx,
              tenantId,
              operationKey,
              existing,
              intent,
            );
          }

          assertKeyAdmissionOnNoRowInsert(operationKey);

          await tx.inventoryPriceOperation.create({
            data: {
              tenant_id: tenantId,
              principal_id: principalId,
              key: operationKey,
              item_id: intent.itemId,
              sku: intent.sku,
              kind: GUARDED_PRICE_KIND,
              expected_revision: revisionToDb(intent.expectedRevision),
              target_minor: intent.targetMinor,
              basis_minor: intent.basisMinor,
              state: InventoryPriceOperationState.ACCEPTED,
              accepted_at: new Date(),
            },
          });

          return { kind: 'proceed' as const };
        },
        {
          timeout: 10_000,
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        },
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raced = await this.prisma.inventoryPriceOperation.findFirst({
          where: {
            tenant_id: tenantId,
            principal_id: principalId,
            key: operationKey,
          },
        });
        if (raced) {
          return await this.prisma.$transaction(
            async (tx) => {
              await setGuardedPriceTxALockTimeout(tx);
              await acquireGuardedPriceAdvisoryLock(
                tx,
                tenantId,
                principalId,
                operationKey,
              );
              return await this.handleExistingJournalRow(
                tx,
                tenantId,
                operationKey,
                raced,
                intent,
              );
            },
            {
              timeout: 10_000,
              isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
            },
          );
        }
        operationUnresolved(
          'Another guarded operation is still in progress for this item.',
        );
      }
      if (isLockTimeoutError(error) || isInteractiveTransactionExpired(error)) {
        operationUnresolved(
          'Could not acquire the guarded operation lock in time.',
        );
      }
      throw error;
    }
  }

  private async handleExistingJournalRow(
    tx: Prisma.TransactionClient,
    tenantId: string,
    callerKey: string,
    row: Prisma.InventoryPriceOperationGetPayload<object>,
    intent: GuardedPriceIntent,
  ): Promise<
    | { kind: 'proceed' }
    | { kind: 'replay'; receipt: GuardedPriceReceiptDto }
    | { kind: 'halt'; throw: () => never }
  > {
    if (!frozenIntentMatchesRow(row, intent)) {
      idempotencyKeyReused(
        'Operation key was already used with a different intent.',
      );
    }

    await lockGuardedPriceJournalRow(tx, tenantId, row.id);

    const fresh = await tx.inventoryPriceOperation.findFirstOrThrow({
      where: { tenant_id: tenantId, id: row.id },
    });

    if (fresh.state === InventoryPriceOperationState.ACCEPTED) {
      if (fresh.key !== callerKey) {
        return {
          kind: 'halt',
          throw: () =>
            operationUnresolved(
              'Another guarded operation is still in progress for this item.',
            ),
        };
      }
      return { kind: 'proceed' };
    }
    if (fresh.state === InventoryPriceOperationState.APPLIED) {
      const item = await tx.catalogItem.findFirst({
        where: { id: fresh.item_id, tenant_id: tenantId },
      });
      return {
        kind: 'replay',
        receipt: receiptFromAppliedJournal(fresh, item),
      };
    }

    const halt = haltForFinalJournalState(fresh.state);
    if (halt) {
      return halt;
    }

    operationUnresolved('Guarded operation is in an unknown state.');
  }

  private async runTxE(
    tenantId: string,
    principalId: string,
    operationKey: string,
    intent: GuardedPriceIntent,
  ): Promise<GuardedPriceReceiptDto> {
    try {
      const role = this.tenantContext.getAuthenticatedUser()?.role;
      const outcome = await DashboardRealtimeDeferStorage.runDeferred(() =>
        this.prisma.$transaction(
          (tx) =>
            executeGuardedPriceTxE(tx, {
              tenantId,
              principalId,
              operationKey,
              intent,
              role,
              auditService: this.auditService,
            }),
          {
            timeout: 30_000,
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          },
        ),
      );

      if (outcome.kind === 'halt') {
        outcome.throw();
      }
      if (outcome.kind === 'replay') {
        return outcome.receipt;
      }
      if (outcome.kind === 'conflict') {
        inventoryRevisionConflict('Catalog item revision no longer matches.');
      }
      if (outcome.kind !== 'applied') {
        operationUnresolved('Guarded execution did not apply.');
      }

      this.dashboardRealtime.emitEntityUpdated(tenantId, {
        type: 'CATALOG_ITEM',
        action: 'UPDATED',
        entityId: outcome.item.id,
      });

      return toCatalogItemResponseDto(outcome.item);
    } catch (error) {
      if (isLockTimeoutError(error)) {
        operationUnresolved(
          'Guarded execution could not acquire row locks in time.',
        );
      }
      throw error;
    }
  }
}

// Re-export for e2e tests (hook flags live in guarded-price-test-hooks.ts).
export { guardedPriceTestHooks } from './guarded-price-test-hooks.js';
