import type { UndoGuardPrismaClient } from './import-undo.types.js';

export const GUARD_MODELS = [
  'customer',
  'vehicle',
  'laborOperation',
  'catalogItem',
  'vehicleNotice',
  'vehicleParty',
  'invoice',
  'workshopOrder',
  'salesOrder',
  'vehicleSale',
  'vehiclePurchase',
  'loanerBooking',
  'vehicleLedgerEntry',
  'workshopTaskLineItem',
  'inventoryTransaction',
  'invoiceItem',
  'purchaseOrderItem',
  'auditLog',
  'customerConsent',
  'customerContactPoint',
  'legacyDocument',
  'tyreSet',
  'vehicleMedia',
  'vehicleEquipmentSelection',
  'vehicleEquipmentFreeTextItem',
  'vehicleListing',
  'vehicleValuationSnapshot',
  'tyreMeasurement',
  'vehicleInspectionRecord',
] as const;

export type GuardModel = (typeof GUARD_MODELS)[number];

export type MockDelegate = { findMany: jest.Mock };

/** Doubles every model the undo guard reads; each delegate starts empty. */
export function createMockClient(): UndoGuardPrismaClient {
  const client: Record<string, MockDelegate> = {};
  for (const model of GUARD_MODELS) {
    client[model] = { findMany: jest.fn().mockResolvedValue([]) };
  }
  return client as unknown as UndoGuardPrismaClient;
}

export function delegateOf(
  client: UndoGuardPrismaClient,
  model: GuardModel,
) {
  return client[model] as unknown as MockDelegate;
}

export function mockRows(
  client: UndoGuardPrismaClient,
  model: GuardModel,
  rows: Record<string, unknown>[],
): void {
  delegateOf(client, model).findMany.mockResolvedValue(rows);
}
