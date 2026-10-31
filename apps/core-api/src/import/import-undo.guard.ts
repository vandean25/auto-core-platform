import {
  UNDO_BLOCKED_REASONS,
  type ImportUndoEligibility,
  type UndoBlockedReasonCode,
  type UndoEntityRecord,
  type UndoGuardPrismaClient,
} from './import-undo.types.js';

const LEAWAY_MS = 1000;

const DOC_OR_FINANCIAL_IMPORT_TYPES = new Set([
  'LEGACY_INVOICE',
  'LEGACY_SERVICE_ORDER',
  'STOCK_OPENING_BALANCE',
  'OPEN_WORKSHOP_ORDER',
]);

const SUPPORTED_UNDO_ENTITY_TYPES = new Set([
  'CUSTOMER',
  'VEHICLE',
  'LABOR_OPERATION',
  'CATALOG_ITEM',
  'SUPPLIER_PRICE_LIST',
  'VEHICLE_NOTICE',
  'VEHICLE_PARTY',
]);

export function isDocOrFinancialImport(entityType: string): boolean {
  return DOC_OR_FINANCIAL_IMPORT_TYPES.has(entityType);
}

export function isUndoSupportedEntityType(entityType: string): boolean {
  return SUPPORTED_UNDO_ENTITY_TYPES.has(entityType);
}

export async function checkEntityUndoEligibility(
  client: UndoGuardPrismaClient,
  tenantId: string,
  entityType: string,
  entityId: string,
  appliedAt: Date,
): Promise<ImportUndoEligibility> {
  // Financial and document imports cannot be undone
  if (isDocOrFinancialImport(entityType)) {
    return {
      status: 'BLOCKED',
      reason: UNDO_BLOCKED_REASONS.FINANCIAL_IMPORT_CANNOT_BE_UNDONE,
    };
  }

  // Unsupported entity types fail closed
  if (!isUndoSupportedEntityType(entityType)) {
    return {
      status: 'BLOCKED',
      reason: UNDO_BLOCKED_REASONS.UNSUPPORTED_ENTITY_TYPE,
    };
  }

  // 1. Fetch current entity to check existence & updatedAt
  const entity = await fetchEntity(client, tenantId, entityType, entityId);
  if (!entity) {
    return {
      status: 'BLOCKED',
      reason: UNDO_BLOCKED_REASONS.ENTITY_NOT_FOUND,
    };
  }

  // 2. Check downstream references (Reference Guard)
  const refCheck = await checkReferences(
    client,
    tenantId,
    entityType,
    entityId,
    entity,
  );
  if (refCheck.status === 'BLOCKED') {
    return { ...refCheck, entity };
  }

  // 3. Check for subsequent modifications (Conflict Guard)
  const conflictCheck = await checkModifications(
    client,
    tenantId,
    entityType,
    entityId,
    appliedAt,
    entity.updatedAt,
  );
  if (conflictCheck.status === 'CONFLICT') {
    return { ...conflictCheck, entity };
  }

  return { status: 'ELIGIBLE', entity };
}

export async function fetchEntity(
  client: UndoGuardPrismaClient,
  tenantId: string,
  entityType: string,
  entityId: string,
): Promise<UndoEntityRecord | null> {
  switch (entityType) {
    case 'CUSTOMER':
      return client.customer.findFirst({
        where: { tenant_id: tenantId, id: entityId },
      });
    case 'VEHICLE':
      return client.vehicle.findFirst({
        where: { tenant_id: tenantId, id: entityId },
      });
    case 'LABOR_OPERATION':
      return client.laborOperation.findFirst({
        where: { tenant_id: tenantId, id: entityId },
      });
    case 'CATALOG_ITEM':
    case 'SUPPLIER_PRICE_LIST':
      return client.catalogItem.findFirst({
        where: { tenant_id: tenantId, id: entityId },
      });
    case 'VEHICLE_NOTICE':
      return client.vehicleNotice.findFirst({
        where: { tenant_id: tenantId, id: entityId },
      });
    case 'VEHICLE_PARTY':
      return client.vehicleParty.findFirst({
        where: { tenant_id: tenantId, id: entityId },
      });
    default:
      return null;
  }
}

async function checkReferences(
  client: UndoGuardPrismaClient,
  tenantId: string,
  entityType: string,
  entityId: string,
  entity: UndoEntityRecord,
): Promise<ImportUndoEligibility> {
  switch (entityType) {
    case 'CUSTOMER':
      return checkCustomerReferences(client, tenantId, entityId);
    case 'VEHICLE':
      return checkVehicleReferences(client, tenantId, entityId);
    case 'LABOR_OPERATION':
      return checkLaborOperationReferences(client, tenantId, entityId);
    case 'CATALOG_ITEM':
    case 'SUPPLIER_PRICE_LIST':
      return checkCatalogItemReferences(client, tenantId, entityId);
    case 'VEHICLE_NOTICE':
      return checkVehicleNoticeReferences(entity);
    default:
      return { status: 'ELIGIBLE' };
  }
}

interface ReferenceCheckItem {
  type: string;
  reasonCode: UndoBlockedReasonCode;
  query: () => Promise<{ id: string; number?: string | null } | null>;
}

async function evaluateReferenceChecks(
  checks: ReferenceCheckItem[],
): Promise<ImportUndoEligibility> {
  for (const check of checks) {
    const ref = await check.query();
    if (ref) {
      return {
        status: 'BLOCKED',
        reason: check.reasonCode,
        references: [`${check.type}:${ref.id}`],
      };
    }
  }
  return { status: 'ELIGIBLE' };
}

async function checkCustomerReferences(
  client: UndoGuardPrismaClient,
  tenantId: string,
  customerId: string,
): Promise<ImportUndoEligibility> {
  return evaluateReferenceChecks([
    {
      type: 'invoice',
      reasonCode: UNDO_BLOCKED_REASONS.DOWNSTREAM_INVOICE,
      query: async () => {
        const row = await client.invoice.findFirst({
          where: { tenant_id: tenantId, customer_id: customerId },
        });
        return row ? { id: row.id, number: row.invoice_number } : null;
      },
    },
    {
      type: 'workshopOrder',
      reasonCode: UNDO_BLOCKED_REASONS.DOWNSTREAM_WORK_ORDER,
      query: async () => {
        const row = await client.workshopOrder.findFirst({
          where: {
            tenant_id: tenantId,
            OR: [
              { customer_id: customerId },
              { bill_to_customer_id: customerId },
            ],
          },
        });
        return row ? { id: row.id, number: row.order_number } : null;
      },
    },
    {
      type: 'salesOrder',
      reasonCode: UNDO_BLOCKED_REASONS.DOWNSTREAM_SALES_ORDER,
      query: async () => {
        const row = await client.salesOrder.findFirst({
          where: { tenant_id: tenantId, customer_id: customerId },
        });
        return row ? { id: row.id, number: row.order_number } : null;
      },
    },
    {
      type: 'vehicleSale',
      reasonCode: UNDO_BLOCKED_REASONS.DOWNSTREAM_VEHICLE_SALE,
      query: async () => {
        const row = await client.vehicleSale.findFirst({
          where: { tenant_id: tenantId, customer_id: customerId },
        });
        return row ? { id: row.id, number: row.sale_number } : null;
      },
    },
    {
      type: 'vehiclePurchase',
      reasonCode: UNDO_BLOCKED_REASONS.DOWNSTREAM_VEHICLE_PURCHASE,
      query: async () => {
        const row = await client.vehiclePurchase.findFirst({
          where: { tenant_id: tenantId, customer_id: customerId },
        });
        return row ? { id: row.id, number: row.purchase_number } : null;
      },
    },
    {
      type: 'loanerBooking',
      reasonCode: UNDO_BLOCKED_REASONS.DOWNSTREAM_LOANER_BOOKING,
      query: async () => {
        const row = await client.loanerBooking.findFirst({
          where: { tenant_id: tenantId, customer_id: customerId },
        });
        return row ? { id: row.id } : null;
      },
    },
    {
      type: 'customerConsent',
      reasonCode: UNDO_BLOCKED_REASONS.DOWNSTREAM_CUSTOMER_CONSENT,
      query: async () => {
        const row = await client.customerConsent.findFirst({
          where: { tenant_id: tenantId, customer_id: customerId },
        });
        return row ? { id: row.id } : null;
      },
    },
    {
      type: 'customerContactPoint',
      reasonCode: UNDO_BLOCKED_REASONS.DOWNSTREAM_CUSTOMER_CONTACT_POINT,
      query: async () => {
        const row = await client.customerContactPoint.findFirst({
          where: { tenant_id: tenantId, customer_id: customerId },
        });
        return row ? { id: row.id } : null;
      },
    },
    {
      type: 'vehicle',
      reasonCode: UNDO_BLOCKED_REASONS.DOWNSTREAM_CUSTOMER_VEHICLE,
      query: async () => {
        const row = await client.vehicle.findFirst({
          where: { tenant_id: tenantId, customer_id: customerId },
        });
        return row ? { id: row.id } : null;
      },
    },
    {
      type: 'legacyDocument',
      reasonCode: UNDO_BLOCKED_REASONS.DOWNSTREAM_CUSTOMER_LEGACY_DOCUMENT,
      query: async () => {
        const row = await client.legacyDocument.findFirst({
          where: {
            tenant_id: tenantId,
            OR: [
              { customer_id: customerId },
              { bill_to_customer_id: customerId },
            ],
          },
        });
        return row ? { id: row.id } : null;
      },
    },
  ]);
}

async function checkVehicleReferences(
  client: UndoGuardPrismaClient,
  tenantId: string,
  vehicleId: string,
): Promise<ImportUndoEligibility> {
  return evaluateReferenceChecks([
    {
      type: 'workshopOrder',
      reasonCode: UNDO_BLOCKED_REASONS.DOWNSTREAM_WORK_ORDER,
      query: async () => {
        const row = await client.workshopOrder.findFirst({
          where: { tenant_id: tenantId, vehicle_id: vehicleId },
        });
        return row ? { id: row.id, number: row.order_number } : null;
      },
    },
    {
      type: 'invoice',
      reasonCode: UNDO_BLOCKED_REASONS.DOWNSTREAM_INVOICE,
      query: async () => {
        const row = await client.invoice.findFirst({
          where: { tenant_id: tenantId, vehicle_id: vehicleId },
        });
        return row ? { id: row.id, number: row.invoice_number } : null;
      },
    },
    {
      type: 'salesOrder',
      reasonCode: UNDO_BLOCKED_REASONS.DOWNSTREAM_SALES_ORDER,
      query: async () => {
        const row = await client.salesOrder.findFirst({
          where: { tenant_id: tenantId, vehicle_id: vehicleId },
        });
        return row ? { id: row.id, number: row.order_number } : null;
      },
    },
    {
      type: 'vehicleLedgerEntry',
      reasonCode: UNDO_BLOCKED_REASONS.DOWNSTREAM_STOCK_MOVEMENT,
      query: async () => {
        const row = await client.vehicleLedgerEntry.findFirst({
          where: { tenant_id: tenantId, vehicle_id: vehicleId },
        });
        return row ? { id: row.id } : null;
      },
    },
    {
      type: 'vehicleSale',
      reasonCode: UNDO_BLOCKED_REASONS.DOWNSTREAM_VEHICLE_SALE,
      query: async () => {
        const row = await client.vehicleSale.findFirst({
          where: { tenant_id: tenantId, vehicle_id: vehicleId },
        });
        return row ? { id: row.id, number: row.sale_number } : null;
      },
    },
    {
      type: 'vehiclePurchase',
      reasonCode: UNDO_BLOCKED_REASONS.DOWNSTREAM_VEHICLE_PURCHASE,
      query: async () => {
        const row = await client.vehiclePurchase.findFirst({
          where: { tenant_id: tenantId, vehicle_id: vehicleId },
        });
        return row ? { id: row.id, number: row.purchase_number } : null;
      },
    },
    {
      type: 'vehicleMedia',
      reasonCode: UNDO_BLOCKED_REASONS.DOWNSTREAM_VEHICLE_MEDIA,
      query: async () => {
        const row = await client.vehicleMedia.findFirst({
          where: { tenant_id: tenantId, vehicle_id: vehicleId },
        });
        return row ? { id: row.id } : null;
      },
    },
    {
      type: 'vehicleEquipmentSelection',
      reasonCode: UNDO_BLOCKED_REASONS.DOWNSTREAM_VEHICLE_EQUIPMENT,
      query: async () => {
        const row = await client.vehicleEquipmentSelection.findFirst({
          where: { tenant_id: tenantId, vehicle_id: vehicleId },
        });
        return row ? { id: row.id } : null;
      },
    },
    {
      type: 'vehicleEquipmentFreeTextItem',
      reasonCode: UNDO_BLOCKED_REASONS.DOWNSTREAM_VEHICLE_EQUIPMENT,
      query: async () => {
        const row = await client.vehicleEquipmentFreeTextItem.findFirst({
          where: { tenant_id: tenantId, vehicle_id: vehicleId },
        });
        return row ? { id: row.id } : null;
      },
    },
    {
      type: 'vehicleListing',
      reasonCode: UNDO_BLOCKED_REASONS.DOWNSTREAM_VEHICLE_LISTING,
      query: async () => {
        const row = await client.vehicleListing.findFirst({
          where: { tenant_id: tenantId, vehicle_id: vehicleId },
        });
        return row ? { id: row.id } : null;
      },
    },
    {
      type: 'vehicleValuationSnapshot',
      reasonCode: UNDO_BLOCKED_REASONS.DOWNSTREAM_VEHICLE_VALUATION,
      query: async () => {
        const row = await client.vehicleValuationSnapshot.findFirst({
          where: { tenant_id: tenantId, vehicle_id: vehicleId },
        });
        return row ? { id: row.id } : null;
      },
    },
    {
      type: 'vehicleParty',
      reasonCode: UNDO_BLOCKED_REASONS.DOWNSTREAM_VEHICLE_PARTY,
      query: async () => {
        const row = await client.vehicleParty.findFirst({
          where: { tenant_id: tenantId, vehicle_id: vehicleId },
        });
        return row ? { id: row.id } : null;
      },
    },
    {
      type: 'vehicleNotice',
      reasonCode: UNDO_BLOCKED_REASONS.DOWNSTREAM_VEHICLE_NOTICE,
      query: async () => {
        const row = await client.vehicleNotice.findFirst({
          where: { tenant_id: tenantId, vehicle_id: vehicleId },
        });
        return row ? { id: row.id } : null;
      },
    },
    {
      type: 'tyreSet',
      reasonCode: UNDO_BLOCKED_REASONS.DOWNSTREAM_TYRE_RECORD,
      query: async () => {
        const row = await client.tyreSet.findFirst({
          where: { tenant_id: tenantId, vehicle_id: vehicleId },
        });
        return row ? { id: row.id } : null;
      },
    },
    {
      type: 'tyreMeasurement',
      reasonCode: UNDO_BLOCKED_REASONS.DOWNSTREAM_TYRE_RECORD,
      query: async () => {
        const row = await client.tyreMeasurement.findFirst({
          where: { tenant_id: tenantId, vehicle_id: vehicleId },
        });
        return row ? { id: row.id } : null;
      },
    },
    {
      type: 'vehicleInspectionRecord',
      reasonCode: UNDO_BLOCKED_REASONS.DOWNSTREAM_INSPECTION_RECORD,
      query: async () => {
        const row = await client.vehicleInspectionRecord.findFirst({
          where: { tenant_id: tenantId, vehicle_id: vehicleId },
        });
        return row ? { id: row.id } : null;
      },
    },
  ]);
}

async function checkLaborOperationReferences(
  client: UndoGuardPrismaClient,
  tenantId: string,
  laborOperationId: string,
): Promise<ImportUndoEligibility> {
  const lineItem = await client.workshopTaskLineItem.findFirst({
    where: { tenant_id: tenantId, labor_operation_id: laborOperationId },
  });
  if (lineItem) {
    return {
      status: 'BLOCKED',
      reason: UNDO_BLOCKED_REASONS.DOWNSTREAM_WORK_ORDER,
      references: [`workshopTaskLineItem:${lineItem.id}`],
    };
  }
  return { status: 'ELIGIBLE' };
}

async function checkCatalogItemReferences(
  client: UndoGuardPrismaClient,
  tenantId: string,
  catalogItemId: string,
): Promise<ImportUndoEligibility> {
  const tx = await client.inventoryTransaction.findFirst({
    where: { tenant_id: tenantId, catalog_item_id: catalogItemId },
  });
  if (tx) {
    return {
      status: 'BLOCKED',
      reason: UNDO_BLOCKED_REASONS.DOWNSTREAM_STOCK_MOVEMENT,
      references: [`inventoryTransaction:${tx.id}`],
    };
  }

  const invItem = await client.invoiceItem.findFirst({
    where: { tenant_id: tenantId, catalog_item_id: catalogItemId },
  });
  if (invItem) {
    return {
      status: 'BLOCKED',
      reason: UNDO_BLOCKED_REASONS.DOWNSTREAM_INVOICE,
      references: [`invoiceItem:${invItem.id}`],
    };
  }

  const poItem = await client.purchaseOrderItem.findFirst({
    where: { tenant_id: tenantId, catalog_item_id: catalogItemId },
  });
  if (poItem) {
    return {
      status: 'BLOCKED',
      reason: UNDO_BLOCKED_REASONS.DOWNSTREAM_PURCHASE_ORDER,
      references: [`purchaseOrderItem:${poItem.id}`],
    };
  }

  return { status: 'ELIGIBLE' };
}

function checkVehicleNoticeReferences(
  entity: UndoEntityRecord,
): ImportUndoEligibility {
  if (entity.resolved_workshop_order_id || entity.status === 'RESOLVED') {
    return {
      status: 'BLOCKED',
      reason: UNDO_BLOCKED_REASONS.DOWNSTREAM_WORK_ORDER,
      references: entity.resolved_workshop_order_id
        ? [`workshopOrder:${entity.resolved_workshop_order_id}`]
        : [],
    };
  }
  return { status: 'ELIGIBLE' };
}

function getAuditEntityTypeVariants(entityType: string): string[] {
  const upper = entityType.toUpperCase();
  const lower = entityType.toLowerCase();
  const pascal = entityType
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
  return [...new Set([entityType, upper, lower, pascal])];
}

async function checkModifications(
  client: UndoGuardPrismaClient,
  tenantId: string,
  entityType: string,
  entityId: string,
  appliedAt: Date,
  updatedAt?: Date,
): Promise<ImportUndoEligibility> {
  const threshold = new Date(appliedAt.getTime() + LEAWAY_MS);

  // Check updatedAt field if present
  if (updatedAt && updatedAt.getTime() > threshold.getTime()) {
    return {
      status: 'CONFLICT',
      reason: UNDO_BLOCKED_REASONS.MODIFIED_SINCE_IMPORT,
      currentUpdatedAt: updatedAt,
    };
  }

  // Check AuditLog table for any newer entries
  const subsequentAudit = await client.auditLog.findFirst({
    where: {
      tenant_id: tenantId,
      entity_type: { in: getAuditEntityTypeVariants(entityType) },
      entity_id: entityId,
      occurred_at: { gt: threshold },
    },
    orderBy: { occurred_at: 'desc' },
  });

  if (subsequentAudit) {
    return {
      status: 'CONFLICT',
      reason: UNDO_BLOCKED_REASONS.MODIFIED_SINCE_IMPORT,
      currentUpdatedAt: subsequentAudit.occurred_at,
    };
  }

  return { status: 'ELIGIBLE' };
}
