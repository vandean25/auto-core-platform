import type { Prisma } from '@prisma/client';

export type ImportUndoEligibilityStatus = 'ELIGIBLE' | 'CONFLICT' | 'BLOCKED';

export interface ImportUndoEligibility {
  status: ImportUndoEligibilityStatus;
  reason?: string;
  references?: string[];
  currentUpdatedAt?: Date | null;
}

export type UndoGuardPrismaClient = Pick<
  Prisma.TransactionClient,
  | 'customer'
  | 'vehicle'
  | 'laborOperation'
  | 'catalogItem'
  | 'vehicleNotice'
  | 'vehicleParty'
  | 'invoice'
  | 'workshopOrder'
  | 'salesOrder'
  | 'vehicleSale'
  | 'vehiclePurchase'
  | 'loanerBooking'
  | 'vehicleLedgerEntry'
  | 'workshopTaskLineItem'
  | 'inventoryTransaction'
  | 'invoiceItem'
  | 'purchaseOrderItem'
  | 'auditLog'
>;

export interface UndoEntityRecord {
  id: string;
  updatedAt?: Date;
  status?: string;
  resolved_workshop_order_id?: string | null;
}
