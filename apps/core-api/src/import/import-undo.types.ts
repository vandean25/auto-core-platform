import type { Prisma } from '@prisma/client';

export type ImportUndoEligibilityStatus = 'ELIGIBLE' | 'CONFLICT' | 'BLOCKED';

export const UNDO_BLOCKED_REASONS = {
  DOWNSTREAM_WORK_ORDER: 'DOWNSTREAM_WORK_ORDER',
  DOWNSTREAM_ESTIMATE: 'DOWNSTREAM_ESTIMATE',
  DOWNSTREAM_INVOICE: 'DOWNSTREAM_INVOICE',
  DOWNSTREAM_CREDIT_NOTE: 'DOWNSTREAM_CREDIT_NOTE',
  DOWNSTREAM_STOCK_MOVEMENT: 'DOWNSTREAM_STOCK_MOVEMENT',
  DOWNSTREAM_PURCHASE_ORDER: 'DOWNSTREAM_PURCHASE_ORDER',
  DOWNSTREAM_SALES_ORDER: 'DOWNSTREAM_SALES_ORDER',
  DOWNSTREAM_VEHICLE_SALE: 'DOWNSTREAM_VEHICLE_SALE',
  DOWNSTREAM_VEHICLE_PURCHASE: 'DOWNSTREAM_VEHICLE_PURCHASE',
  DOWNSTREAM_LOANER_BOOKING: 'DOWNSTREAM_LOANER_BOOKING',
  DOWNSTREAM_CUSTOMER_CONSENT: 'DOWNSTREAM_CUSTOMER_CONSENT',
  DOWNSTREAM_CUSTOMER_CONTACT_POINT: 'DOWNSTREAM_CUSTOMER_CONTACT_POINT',
  DOWNSTREAM_CUSTOMER_VEHICLE: 'DOWNSTREAM_CUSTOMER_VEHICLE',
  DOWNSTREAM_CUSTOMER_LEGACY_DOCUMENT: 'DOWNSTREAM_CUSTOMER_LEGACY_DOCUMENT',
  DOWNSTREAM_VEHICLE_MEDIA: 'DOWNSTREAM_VEHICLE_MEDIA',
  DOWNSTREAM_VEHICLE_EQUIPMENT: 'DOWNSTREAM_VEHICLE_EQUIPMENT',
  DOWNSTREAM_VEHICLE_LISTING: 'DOWNSTREAM_VEHICLE_LISTING',
  DOWNSTREAM_VEHICLE_VALUATION: 'DOWNSTREAM_VEHICLE_VALUATION',
  DOWNSTREAM_VEHICLE_PARTY: 'DOWNSTREAM_VEHICLE_PARTY',
  DOWNSTREAM_VEHICLE_NOTICE: 'DOWNSTREAM_VEHICLE_NOTICE',
  DOWNSTREAM_TYRE_RECORD: 'DOWNSTREAM_TYRE_RECORD',
  DOWNSTREAM_INSPECTION_RECORD: 'DOWNSTREAM_INSPECTION_RECORD',
  MODIFIED_SINCE_IMPORT: 'MODIFIED_SINCE_IMPORT',
  MISSING_BEFORE_SNAPSHOT: 'MISSING_BEFORE_SNAPSHOT',
  /** The row write failed; the technical detail stays in the server log. */
  ROW_ERROR: 'ROW_ERROR',
  ROWS_PURGED: 'ROWS_PURGED',
  ENTITY_NOT_FOUND: 'ENTITY_NOT_FOUND',
  UNSUPPORTED_ENTITY_TYPE: 'UNSUPPORTED_ENTITY_TYPE',
  FINANCIAL_IMPORT_CANNOT_BE_UNDONE: 'FINANCIAL_IMPORT_CANNOT_BE_UNDONE',
  UNKNOWN: 'UNKNOWN',
} as const;

export type UndoBlockedReasonCode =
  (typeof UNDO_BLOCKED_REASONS)[keyof typeof UNDO_BLOCKED_REASONS];

export interface ImportUndoEligibility {
  status: ImportUndoEligibilityStatus;
  reason?: string;
  references?: string[];
  currentUpdatedAt?: Date | null;
  entity?: UndoEntityRecord | null;
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
  | 'customerConsent'
  | 'customerContactPoint'
  | 'legacyDocument'
  | 'tyreSet'
  | 'vehicleMedia'
  | 'vehicleEquipmentSelection'
  | 'vehicleEquipmentFreeTextItem'
  | 'vehicleListing'
  | 'vehicleValuationSnapshot'
  | 'tyreMeasurement'
  | 'vehicleInspectionRecord'
>;

export interface UndoEntityRecord {
  id: string;
  updatedAt?: Date;
  status?: string;
  resolved_workshop_order_id?: string | null;
}
