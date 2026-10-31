import type { Prisma } from '@prisma/client';

export type ImportUndoEligibilityStatus = 'ELIGIBLE' | 'CONFLICT' | 'BLOCKED';

export interface ImportUndoEligibility {
  status: ImportUndoEligibilityStatus;
  reason?: string;
  references?: string[];
  currentUpdatedAt?: Date | null;
}

export interface ImportUndoRowPreview {
  rowNumber: number;
  entityType: string;
  entityId: string | null;
  action: 'CREATE' | 'UPDATE';
  status: ImportUndoEligibilityStatus;
  reason?: string;
  references?: string[];
  displayName?: string;
}

export interface ImportUndoPreviewSummary {
  jobId: string;
  status: ImportUndoEligibilityStatus;
  counts: {
    total: number;
    toDelete: number;
    toRestore: number;
    conflicts: number;
    blocked: number;
  };
  deletions: ImportUndoRowPreview[];
  restorations: ImportUndoRowPreview[];
  conflicts: ImportUndoRowPreview[];
  blocked: ImportUndoRowPreview[];
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
