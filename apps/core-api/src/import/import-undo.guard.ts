import type {
  ImportUndoEligibility,
  UndoEntityRecord,
  UndoGuardPrismaClient,
} from './import-undo.types.js';

const LEAWAY_MS = 1000;

const DOC_OR_FINANCIAL_IMPORT_TYPES = new Set([
  'LEGACY_INVOICE',
  'LEGACY_SERVICE_ORDER',
  'STOCK_OPENING_BALANCE',
  'OPEN_WORKSHOP_ORDER',
]);

export function isDocOrFinancialImport(entityType: string): boolean {
  return DOC_OR_FINANCIAL_IMPORT_TYPES.has(entityType);
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
      reason: 'Financial and document imports cannot be undone',
    };
  }

  // 1. Fetch current entity to check existence & updatedAt
  const entity = await fetchEntity(client, tenantId, entityType, entityId);
  if (!entity) {
    return { status: 'ELIGIBLE', reason: 'Entity does not exist' };
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
    return refCheck;
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
    return conflictCheck;
  }

  return { status: 'ELIGIBLE' };
}

async function fetchEntity(
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
  label: string;
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
        reason: `Referenced by ${check.label} ${ref.number ?? ref.id}`,
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
      label: 'invoice',
      query: async () => {
        const row = await client.invoice.findFirst({
          where: { tenant_id: tenantId, customer_id: customerId },
        });
        return row ? { id: row.id, number: row.invoice_number } : null;
      },
    },
    {
      type: 'workshopOrder',
      label: 'workshop order',
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
      label: 'sales order',
      query: async () => {
        const row = await client.salesOrder.findFirst({
          where: { tenant_id: tenantId, customer_id: customerId },
        });
        return row ? { id: row.id, number: row.order_number } : null;
      },
    },
    {
      type: 'vehicleSale',
      label: 'vehicle sale',
      query: async () => {
        const row = await client.vehicleSale.findFirst({
          where: { tenant_id: tenantId, customer_id: customerId },
        });
        return row ? { id: row.id, number: row.sale_number } : null;
      },
    },
    {
      type: 'vehiclePurchase',
      label: 'vehicle purchase',
      query: async () => {
        const row = await client.vehiclePurchase.findFirst({
          where: { tenant_id: tenantId, customer_id: customerId },
        });
        return row ? { id: row.id, number: row.purchase_number } : null;
      },
    },
    {
      type: 'loanerBooking',
      label: 'loaner booking',
      query: async () => {
        const row = await client.loanerBooking.findFirst({
          where: { tenant_id: tenantId, customer_id: customerId },
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
      label: 'workshop order',
      query: async () => {
        const row = await client.workshopOrder.findFirst({
          where: { tenant_id: tenantId, vehicle_id: vehicleId },
        });
        return row ? { id: row.id, number: row.order_number } : null;
      },
    },
    {
      type: 'invoice',
      label: 'invoice',
      query: async () => {
        const row = await client.invoice.findFirst({
          where: { tenant_id: tenantId, vehicle_id: vehicleId },
        });
        return row ? { id: row.id, number: row.invoice_number } : null;
      },
    },
    {
      type: 'salesOrder',
      label: 'sales order',
      query: async () => {
        const row = await client.salesOrder.findFirst({
          where: { tenant_id: tenantId, vehicle_id: vehicleId },
        });
        return row ? { id: row.id, number: row.order_number } : null;
      },
    },
    {
      type: 'vehicleLedgerEntry',
      label: 'vehicle ledger entry',
      query: async () => {
        const row = await client.vehicleLedgerEntry.findFirst({
          where: { tenant_id: tenantId, vehicle_id: vehicleId },
        });
        return row ? { id: row.id } : null;
      },
    },
    {
      type: 'vehicleSale',
      label: 'vehicle sale',
      query: async () => {
        const row = await client.vehicleSale.findFirst({
          where: { tenant_id: tenantId, vehicle_id: vehicleId },
        });
        return row ? { id: row.id, number: row.sale_number } : null;
      },
    },
    {
      type: 'vehiclePurchase',
      label: 'vehicle purchase',
      query: async () => {
        const row = await client.vehiclePurchase.findFirst({
          where: { tenant_id: tenantId, vehicle_id: vehicleId },
        });
        return row ? { id: row.id, number: row.purchase_number } : null;
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
      reason: 'Referenced by workshop tasks',
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
      reason: `Referenced by inventory transaction ${tx.id}`,
      references: [`inventoryTransaction:${tx.id}`],
    };
  }

  const invItem = await client.invoiceItem.findFirst({
    where: { tenant_id: tenantId, catalog_item_id: catalogItemId },
  });
  if (invItem) {
    return {
      status: 'BLOCKED',
      reason: `Referenced by invoice line item ${invItem.id}`,
      references: [`invoiceItem:${invItem.id}`],
    };
  }

  const poItem = await client.purchaseOrderItem.findFirst({
    where: { tenant_id: tenantId, catalog_item_id: catalogItemId },
  });
  if (poItem) {
    return {
      status: 'BLOCKED',
      reason: `Referenced by purchase order line item ${poItem.id}`,
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
      reason: 'Notice was resolved in a workshop order',
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
      reason: `Record was modified after import on ${updatedAt.toISOString()}`,
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
    const actor = subsequentAudit.actor_email ?? 'user';
    return {
      status: 'CONFLICT',
      reason: `Record was modified by ${actor} after import on ${subsequentAudit.occurred_at.toISOString()}`,
      currentUpdatedAt: subsequentAudit.occurred_at,
    };
  }

  return { status: 'ELIGIBLE' };
}
