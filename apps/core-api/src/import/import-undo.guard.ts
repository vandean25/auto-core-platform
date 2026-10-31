import type {
  ImportUndoEligibility,
  UndoEntityRecord,
  UndoGuardPrismaClient,
} from './import-undo.types.js';

const LEAWAY_MS = 1000;

export async function checkEntityUndoEligibility(
  client: UndoGuardPrismaClient,
  tenantId: string,
  entityType: string,
  entityId: string,
  appliedAt: Date,
): Promise<ImportUndoEligibility> {
  // Financial and document imports cannot be undone
  if (
    entityType === 'LEGACY_INVOICE' ||
    entityType === 'LEGACY_SERVICE_ORDER' ||
    entityType === 'STOCK_OPENING_BALANCE' ||
    entityType === 'OPEN_WORKSHOP_ORDER'
  ) {
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
      return client.customer.findUnique({
        where: { tenant_id_id: { tenant_id: tenantId, id: entityId } },
      });
    case 'VEHICLE':
      return client.vehicle.findUnique({
        where: { tenant_id_id: { tenant_id: tenantId, id: entityId } },
      });
    case 'LABOR_OPERATION':
      return client.laborOperation.findUnique({
        where: { id: entityId },
      });
    case 'CATALOG_ITEM':
    case 'SUPPLIER_PRICE_LIST':
      return client.catalogItem.findUnique({
        where: { id: entityId },
      });
    case 'VEHICLE_NOTICE':
      return client.vehicleNotice.findUnique({
        where: { tenant_id_id: { tenant_id: tenantId, id: entityId } },
      });
    case 'VEHICLE_PARTY':
      return client.vehicleParty.findUnique({
        where: { tenant_id_id: { tenant_id: tenantId, id: entityId } },
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

async function checkCustomerReferences(
  client: UndoGuardPrismaClient,
  tenantId: string,
  customerId: string,
): Promise<ImportUndoEligibility> {
  const invoice = await client.invoice.findFirst({
    where: { tenant_id: tenantId, customer_id: customerId },
  });
  if (invoice) {
    return {
      status: 'BLOCKED',
      reason: `Referenced by invoice ${invoice.invoice_number ?? invoice.id}`,
      references: [`invoice:${invoice.id}`],
    };
  }

  const wo = await client.workshopOrder.findFirst({
    where: {
      tenant_id: tenantId,
      OR: [{ customer_id: customerId }, { bill_to_customer_id: customerId }],
    },
  });
  if (wo) {
    return {
      status: 'BLOCKED',
      reason: `Referenced by workshop order ${wo.order_number ?? wo.id}`,
      references: [`workshopOrder:${wo.id}`],
    };
  }

  const so = await client.salesOrder.findFirst({
    where: { tenant_id: tenantId, customer_id: customerId },
  });
  if (so) {
    return {
      status: 'BLOCKED',
      reason: `Referenced by sales order ${so.order_number ?? so.id}`,
      references: [`salesOrder:${so.id}`],
    };
  }

  const vs = await client.vehicleSale.findFirst({
    where: { tenant_id: tenantId, customer_id: customerId },
  });
  if (vs) {
    return {
      status: 'BLOCKED',
      reason: `Referenced by vehicle sale ${vs.sale_number ?? vs.id}`,
      references: [`vehicleSale:${vs.id}`],
    };
  }

  const vp = await client.vehiclePurchase.findFirst({
    where: { tenant_id: tenantId, customer_id: customerId },
  });
  if (vp) {
    return {
      status: 'BLOCKED',
      reason: `Referenced by vehicle purchase ${vp.purchase_number ?? vp.id}`,
      references: [`vehiclePurchase:${vp.id}`],
    };
  }

  const lb = await client.loanerBooking.findFirst({
    where: { tenant_id: tenantId, customer_id: customerId },
  });
  if (lb) {
    return {
      status: 'BLOCKED',
      reason: `Referenced by loaner booking ${lb.id}`,
      references: [`loanerBooking:${lb.id}`],
    };
  }

  return { status: 'ELIGIBLE' };
}

async function checkVehicleReferences(
  client: UndoGuardPrismaClient,
  tenantId: string,
  vehicleId: string,
): Promise<ImportUndoEligibility> {
  const wo = await client.workshopOrder.findFirst({
    where: { tenant_id: tenantId, vehicle_id: vehicleId },
  });
  if (wo) {
    return {
      status: 'BLOCKED',
      reason: `Referenced by workshop order ${wo.order_number ?? wo.id}`,
      references: [`workshopOrder:${wo.id}`],
    };
  }

  const inv = await client.invoice.findFirst({
    where: { tenant_id: tenantId, vehicle_id: vehicleId },
  });
  if (inv) {
    return {
      status: 'BLOCKED',
      reason: `Referenced by invoice ${inv.invoice_number ?? inv.id}`,
      references: [`invoice:${inv.id}`],
    };
  }

  const so = await client.salesOrder.findFirst({
    where: { tenant_id: tenantId, vehicle_id: vehicleId },
  });
  if (so) {
    return {
      status: 'BLOCKED',
      reason: `Referenced by sales order ${so.order_number ?? so.id}`,
      references: [`salesOrder:${so.id}`],
    };
  }

  const vle = await client.vehicleLedgerEntry.findFirst({
    where: { tenant_id: tenantId, vehicle_id: vehicleId },
  });
  if (vle) {
    return {
      status: 'BLOCKED',
      reason: `Referenced by vehicle ledger entry ${vle.id}`,
      references: [`vehicleLedgerEntry:${vle.id}`],
    };
  }

  const vs = await client.vehicleSale.findFirst({
    where: { tenant_id: tenantId, vehicle_id: vehicleId },
  });
  if (vs) {
    return {
      status: 'BLOCKED',
      reason: `Referenced by vehicle sale ${vs.sale_number ?? vs.id}`,
      references: [`vehicleSale:${vs.id}`],
    };
  }

  const vp = await client.vehiclePurchase.findFirst({
    where: { tenant_id: tenantId, vehicle_id: vehicleId },
  });
  if (vp) {
    return {
      status: 'BLOCKED',
      reason: `Referenced by vehicle purchase ${vp.purchase_number ?? vp.id}`,
      references: [`vehiclePurchase:${vp.id}`],
    };
  }

  return { status: 'ELIGIBLE' };
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
      entity_type: entityType,
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
