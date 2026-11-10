import { InventoryPriceOperationState, type Prisma } from '@prisma/client';
import {
  inventoryRevisionConflict,
  operationFenced,
} from './guarded-price.errors.js';

export function isLockTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = (error as { code?: string }).code;
  const message = String((error as { message?: string }).message ?? '');
  return (
    code === 'P2034' || code === '55P03' || message.includes('lock timeout')
  );
}

export function isInteractiveTransactionExpired(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2028'
  );
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  );
}

export function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2025'
  );
}

export function haltForFinalJournalState(
  state: InventoryPriceOperationState,
): { kind: 'halt'; throw: () => never } | null {
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

export async function markJournalRevisionConflict(
  tx: Prisma.TransactionClient,
  tenantId: string,
  journalId: string,
): Promise<void> {
  await tx.inventoryPriceOperation.update({
    where: { tenant_id_id: { tenant_id: tenantId, id: journalId } },
    data: {
      state: InventoryPriceOperationState.CONFLICT,
      final_at: new Date(),
      error_code: 'INVENTORY_REVISION_CONFLICT',
    },
  });
}
