import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditLogAction,
  InventoryPriceOperationState,
  Prisma,
} from '@prisma/client';
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
  lockGuardedPriceCatalogItem,
  lockGuardedPriceJournalRow,
  setGuardedPriceTxALockTimeout,
  setGuardedPriceTxELockTimeout,
} from '../guarded-price-operation-locks.js';
import {
  assertKeyAdmissionOnNoRowInsert,
  resolveOperationKey,
} from './guarded-price-admission.js';
import {
  GUARDED_PRICE_KIND,
  idempotencyKeyReused,
  inventoryRevisionConflict,
  operationFenced,
  operationUnresolved,
} from './guarded-price.errors.js';
import {
  frozenIntentMatchesRow,
  type GuardedPriceIntent,
} from './guarded-price-intent.js';
import {
  minorUnitsToDecimalString,
  retailMajorToMinorUnits,
} from './guarded-price.money.js';
import { receiptFromAppliedJournal } from './guarded-price-receipt.js';
import { revisionFromDb, revisionToDb } from './guarded-price.revision.js';

const guardedPriceTestHooksAllowed = process.env.JEST_WORKER_ID !== undefined;

/** Test-only flags (honored only when NODE_ENV=test). */
export const guardedPriceTestHooks = {
  failTxEAfterJournalLock: false,
  failTxEAfterCatalogUpdate: false,
};

function isLockTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = (error as { code?: string }).code;
  const message = String((error as { message?: string }).message ?? '');
  return (
    code === 'P2034' || code === '55P03' || message.includes('lock timeout')
  );
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  );
}

function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2025'
  );
}

function haltForFinalJournalState(
  state: InventoryPriceOperationState,
): { kind: 'halt'; throw: () => never } | null {
  if (state === InventoryPriceOperationState.ACCEPTED) {
    return {
      kind: 'halt',
      throw: () =>
        operationUnresolved('Guarded operation is still in progress.'),
    };
  }
  if (state === InventoryPriceOperationState.FENCED) {
    return {
      kind: 'halt',
      throw: () =>
        operationFenced('Guarded operation was fenced as not applied.'),
    };
  }
  if (state === InventoryPriceOperationState.CONFLICT) {
    return {
      kind: 'halt',
      throw: () =>
        inventoryRevisionConflict('Catalog item revision no longer matches.'),
    };
  }
  return null;
}

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

    const item = await this.prisma.catalogItem.findFirst({
      where: { id: itemId, tenant_id: tenantId },
    });
    const priorJournal = await this.prisma.inventoryPriceOperation.findFirst({
      where: {
        tenant_id: tenantId,
        principal_id: principalId,
        key: operationKey,
        item_id: itemId,
      },
    });

    if (!item) {
      if (
        priorJournal &&
        priorJournal.state === InventoryPriceOperationState.APPLIED &&
        priorJournal.expected_revision === revisionToDb(expectedRevision) &&
        priorJournal.target_minor === targetMinor
      ) {
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
      }
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

    return await this.runTxE(tenantId, principalId, operationKey, intent);
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
              existing,
              intent,
            );
          }

          assertKeyAdmissionOnNoRowInsert(operationKey);

          try {
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
          } catch (error) {
            if (isUniqueViolation(error)) {
              const raced = await tx.inventoryPriceOperation.findFirst({
                where: {
                  tenant_id: tenantId,
                  principal_id: principalId,
                  key: operationKey,
                },
              });
              if (raced) {
                return await this.handleExistingJournalRow(
                  tx,
                  tenantId,
                  raced,
                  intent,
                );
              }
              operationUnresolved(
                'Another guarded operation is still in progress for this item.',
              );
            }
            throw error;
          }

          return { kind: 'proceed' as const };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    } catch (error) {
      if (isLockTimeoutError(error) || isUniqueViolation(error)) {
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

    const halt = haltForFinalJournalState(fresh.state);
    if (halt) {
      return halt;
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

    operationUnresolved('Guarded operation is in an unknown state.');
  }

  private async runTxE(
    tenantId: string,
    principalId: string,
    operationKey: string,
    intent: GuardedPriceIntent,
  ): Promise<GuardedPriceReceiptDto> {
    try {
      const outcome = await DashboardRealtimeDeferStorage.runDeferred(() =>
        this.prisma.$transaction(
          async (tx): Promise<
            | { kind: 'applied'; item: Prisma.CatalogItemGetPayload<object> }
            | { kind: 'conflict' }
            | { kind: 'halt'; throw: () => never }
          > => {
            await setGuardedPriceTxELockTimeout(tx);
            assertCanMutateInventoryStock(
              this.tenantContext.getAuthenticatedUser()?.role,
            );

            const journal = await tx.inventoryPriceOperation.findFirst({
              where: {
                tenant_id: tenantId,
                principal_id: principalId,
                key: operationKey,
              },
            });
            if (!journal) {
              return {
                kind: 'halt',
                throw: () =>
                  operationUnresolved(
                    'Guarded acceptance row is not available for execution.',
                  ),
              };
            }

            await lockGuardedPriceJournalRow(tx, tenantId, journal.id);

            if (
              guardedPriceTestHooksAllowed &&
              guardedPriceTestHooks.failTxEAfterJournalLock
            ) {
              throw new Error('GUARDED_PRICE_TEST_TX_E_FAIL');
            }

            const lockedJournal =
              await tx.inventoryPriceOperation.findFirstOrThrow({
                where: { tenant_id: tenantId, id: journal.id },
              });

            if (lockedJournal.state !== InventoryPriceOperationState.ACCEPTED) {
              const halt = haltForFinalJournalState(lockedJournal.state);
              if (halt) {
                return halt;
              }
              return {
                kind: 'halt',
                throw: () =>
                  operationUnresolved(
                    'Guarded acceptance row is not available for execution.',
                  ),
              };
            }

            await lockGuardedPriceCatalogItem(tx, tenantId, intent.itemId);

            const item = await tx.catalogItem.findFirst({
              where: { id: intent.itemId, tenant_id: tenantId },
            });
            if (!item) {
              await tx.inventoryPriceOperation.update({
                where: {
                  tenant_id_id: { tenant_id: tenantId, id: lockedJournal.id },
                },
                data: {
                  state: InventoryPriceOperationState.CONFLICT,
                  final_at: new Date(),
                  error_code: 'INVENTORY_REVISION_CONFLICT',
                },
              });
              return { kind: 'conflict' as const };
            }

            const currentRevision = revisionFromDb(item.revision);
            if (currentRevision !== intent.expectedRevision) {
              await tx.inventoryPriceOperation.update({
                where: {
                  tenant_id_id: { tenant_id: tenantId, id: lockedJournal.id },
                },
                data: {
                  state: InventoryPriceOperationState.CONFLICT,
                  final_at: new Date(),
                  error_code: 'INVENTORY_REVISION_CONFLICT',
                },
              });
              return { kind: 'conflict' as const };
            }

            const beforePrice = item.retail_price.toString();
            let updated: Prisma.CatalogItemGetPayload<object>;
            try {
              updated = await tx.catalogItem.update({
                where: {
                  id: intent.itemId,
                  tenant_id: tenantId,
                  revision: revisionToDb(intent.expectedRevision),
                },
                data: {
                  retail_price: minorUnitsToDecimalString(intent.targetMinor),
                },
              });
            } catch (error) {
              if (isRecordNotFound(error)) {
                await tx.inventoryPriceOperation.update({
                  where: {
                    tenant_id_id: {
                      tenant_id: tenantId,
                      id: lockedJournal.id,
                    },
                  },
                  data: {
                    state: InventoryPriceOperationState.CONFLICT,
                    final_at: new Date(),
                    error_code: 'INVENTORY_REVISION_CONFLICT',
                  },
                });
                return { kind: 'conflict' as const };
              }
              throw error;
            }

            if (
              guardedPriceTestHooksAllowed &&
              guardedPriceTestHooks.failTxEAfterCatalogUpdate
            ) {
              throw new Error('GUARDED_PRICE_TEST_TX_E_AFTER_CATALOG');
            }

            await this.auditService.recordTenantMutation(
              {
                entityType: 'CATALOG_ITEM',
                entityId: intent.itemId,
                action: AuditLogAction.UPDATE,
                source: 'inventory.guarded_price',
                before: { retail_price: beforePrice },
                after: { retail_price: updated.retail_price.toString() },
              },
              tx,
            );

            const resultRevision = revisionFromDb(updated.revision);
            await tx.inventoryPriceOperation.update({
              where: {
                tenant_id_id: { tenant_id: tenantId, id: lockedJournal.id },
              },
              data: {
                state: InventoryPriceOperationState.APPLIED,
                final_at: new Date(),
                result_revision: revisionToDb(resultRevision),
              },
            });

            return { kind: 'applied' as const, item: updated };
          },
          {
            timeout: 30_000,
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          },
        ),
      );

      if (outcome.kind === 'halt') {
        outcome.throw();
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
