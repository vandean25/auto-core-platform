import {
  AuditLogAction,
  InventoryPriceOperationState,
  type Prisma,
} from '@prisma/client';
import type { AuditService } from '../../audit/audit.service.js';
import { assertCanMutateInventoryStock } from '../inventory-access.guards.js';
import {
  lockGuardedPriceCatalogItem,
  lockGuardedPriceJournalRow,
  setGuardedPriceTxELockTimeout,
} from '../guarded-price-operation-locks.js';
import type { GuardedPriceIntent } from './guarded-price-intent.js';
import { minorUnitsToDecimalString } from './guarded-price.money.js';
import {
  haltForFinalJournalState,
  isRecordNotFound,
  markJournalRevisionConflict,
} from './guarded-price.helpers.js';
import {
  shouldFailTxEAfterCatalogUpdate,
  shouldFailTxEAfterJournalLock,
} from './guarded-price-test-hooks.js';
import { receiptFromAppliedJournal } from './guarded-price-receipt.js';
import { revisionFromDb, revisionToDb } from './guarded-price.revision.js';
import { operationUnresolved } from './guarded-price.errors.js';
import type { GuardedPriceReceiptDto } from '../dto/guarded-inventory-price.dto.js';

export type GuardedPriceTxEOutcome =
  | { kind: 'applied'; receipt: GuardedPriceReceiptDto; entityId: string }
  | { kind: 'replay'; receipt: GuardedPriceReceiptDto }
  | { kind: 'conflict' }
  | { kind: 'halt'; throw: () => never };

type GuardedPriceTxEContext = {
  tenantId: string;
  principalId: string;
  operationKey: string;
  intent: GuardedPriceIntent;
  role: string | undefined;
  auditService: AuditService;
};

async function lockAcceptedJournal(
  tx: Prisma.TransactionClient,
  ctx: GuardedPriceTxEContext,
): Promise<
  | {
      kind: 'journal';
      journal: Prisma.InventoryPriceOperationGetPayload<object>;
    }
  | { kind: 'replay'; receipt: GuardedPriceReceiptDto }
  | { kind: 'halt'; throw: () => never }
> {
  const journal = await tx.inventoryPriceOperation.findFirst({
    where: {
      tenant_id: ctx.tenantId,
      principal_id: ctx.principalId,
      key: ctx.operationKey,
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

  await lockGuardedPriceJournalRow(tx, ctx.tenantId, journal.id);

  if (shouldFailTxEAfterJournalLock()) {
    throw new Error('GUARDED_PRICE_TEST_TX_E_FAIL');
  }

  const lockedJournal = await tx.inventoryPriceOperation.findFirstOrThrow({
    where: { tenant_id: ctx.tenantId, id: journal.id },
  });

  if (lockedJournal.state === InventoryPriceOperationState.ACCEPTED) {
    return { kind: 'journal', journal: lockedJournal };
  }

  if (lockedJournal.state === InventoryPriceOperationState.APPLIED) {
    const item = await tx.catalogItem.findFirst({
      where: { id: lockedJournal.item_id, tenant_id: ctx.tenantId },
    });
    return {
      kind: 'replay',
      receipt: receiptFromAppliedJournal(lockedJournal, item),
    };
  }

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

async function applyCatalogPrice(
  tx: Prisma.TransactionClient,
  ctx: GuardedPriceTxEContext,
  journalId: string,
): Promise<GuardedPriceTxEOutcome> {
  await lockGuardedPriceCatalogItem(tx, ctx.tenantId, ctx.intent.itemId);

  const item = await tx.catalogItem.findFirst({
    where: { id: ctx.intent.itemId, tenant_id: ctx.tenantId },
  });
  if (!item) {
    await markJournalRevisionConflict(tx, ctx.tenantId, journalId);
    return { kind: 'conflict' };
  }

  const currentRevision = revisionFromDb(item.revision);
  if (currentRevision !== ctx.intent.expectedRevision) {
    await markJournalRevisionConflict(tx, ctx.tenantId, journalId);
    return { kind: 'conflict' };
  }

  const beforePrice = item.retail_price.toString();
  let updated: Prisma.CatalogItemGetPayload<object>;
  try {
    updated = await tx.catalogItem.update({
      where: {
        id: ctx.intent.itemId,
        tenant_id: ctx.tenantId,
        revision: revisionToDb(ctx.intent.expectedRevision),
      },
      data: {
        retail_price: minorUnitsToDecimalString(ctx.intent.targetMinor),
      },
    });
  } catch (error) {
    if (isRecordNotFound(error)) {
      await markJournalRevisionConflict(tx, ctx.tenantId, journalId);
      return { kind: 'conflict' };
    }
    throw error;
  }

  if (shouldFailTxEAfterCatalogUpdate()) {
    throw new Error('GUARDED_PRICE_TEST_TX_E_AFTER_CATALOG');
  }

  await ctx.auditService.recordTenantMutation(
    {
      entityType: 'CATALOG_ITEM',
      entityId: ctx.intent.itemId,
      action: AuditLogAction.UPDATE,
      source: 'inventory.guarded_price',
      before: { retail_price: beforePrice },
      after: { retail_price: updated.retail_price.toString() },
    },
    tx,
  );

  const resultRevision = revisionFromDb(updated.revision);
  const appliedJournal = await tx.inventoryPriceOperation.update({
    where: {
      tenant_id_id: { tenant_id: ctx.tenantId, id: journalId },
    },
    data: {
      state: InventoryPriceOperationState.APPLIED,
      final_at: new Date(),
      result_revision: revisionToDb(resultRevision),
    },
  });

  return {
    kind: 'applied',
    entityId: updated.id,
    receipt: receiptFromAppliedJournal(appliedJournal, updated),
  };
}

export async function executeGuardedPriceTxE(
  tx: Prisma.TransactionClient,
  ctx: GuardedPriceTxEContext,
): Promise<GuardedPriceTxEOutcome> {
  await setGuardedPriceTxELockTimeout(tx);
  assertCanMutateInventoryStock(ctx.role);

  const journalResult = await lockAcceptedJournal(tx, ctx);
  if (journalResult.kind === 'halt' || journalResult.kind === 'replay') {
    return journalResult;
  }

  return applyCatalogPrice(tx, ctx, journalResult.journal.id);
}
