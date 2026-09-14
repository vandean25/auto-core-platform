import { TransactionType } from '@prisma/client';
import type { RecordTransactionParams } from '../inventory/ledger.service';

export interface TransferLedgerPairParams {
  itemId: string;
  outLocationId: string;
  inLocationId: string;
  quantity: string;
  transferId: string;
  movementGroupId: string;
  costBasis?: string | number | null;
}

/**
 * Ruling 34/35: builds one paired TRANSFER_OUT + TRANSFER_IN ledger movement
 * with a shared movement_group_id and reference_id = transfer id. The row's
 * site_id is derived from its own location by the ledger.
 */
export function buildTransferLedgerPair(
  params: TransferLedgerPairParams,
): RecordTransactionParams[] {
  const costBasis: number | null | undefined =
    params.costBasis === undefined || params.costBasis === null
      ? params.costBasis === undefined
        ? undefined
        : null
      : Number(params.costBasis);
  return [
    {
      itemId: params.itemId,
      locationId: params.outLocationId,
      quantity: -Number(params.quantity),
      type: TransactionType.TRANSFER_OUT,
      referenceId: params.transferId,
      costBasis,
      movementGroupId: params.movementGroupId,
      stockTransferId: params.transferId,
    },
    {
      itemId: params.itemId,
      locationId: params.inLocationId,
      quantity: Number(params.quantity),
      type: TransactionType.TRANSFER_IN,
      referenceId: params.transferId,
      costBasis,
      movementGroupId: params.movementGroupId,
      stockTransferId: params.transferId,
    },
  ];
}
