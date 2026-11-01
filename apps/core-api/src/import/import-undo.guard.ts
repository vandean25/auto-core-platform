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

type RefRow = Record<string, string | null>;

type RefLoader = (ids: string[]) => Promise<RefRow[]>;

type BatchedRefCheck = {
  type: string;
  reason: UndoBlockedReasonCode;
  owners: string[];
  load: RefLoader;
};

function refCheck(
  type: string,
  reason: UndoBlockedReasonCode,
  owners: string[],
  load: RefLoader,
): BatchedRefCheck {
  return { type, reason, owners, load };
}

function blockAll(
  ids: string[],
  reason: UndoBlockedReasonCode,
): Map<string, ImportUndoEligibility> {
  const results = new Map<string, ImportUndoEligibility>();
  for (const id of ids) {
    results.set(id, { status: 'BLOCKED', reason });
  }
  return results;
}

/**
 * Undo eligibility for a whole batch: one query per reference table instead of one per row.
 * Every requested id gets an entry and the first blocking reference wins, so batched and
 * single-entity evaluation agree.
 */
export async function checkEntitiesUndoEligibility(
  client: UndoGuardPrismaClient,
  tenantId: string,
  entityType: string,
  entityIds: string[],
  appliedAt: Date,
): Promise<Map<string, ImportUndoEligibility>> {
  const ids = [...new Set(entityIds.filter(Boolean))];
  if (ids.length === 0) {
    return new Map();
  }
  if (isDocOrFinancialImport(entityType)) {
    return blockAll(
      ids,
      UNDO_BLOCKED_REASONS.FINANCIAL_IMPORT_CANNOT_BE_UNDONE,
    );
  }
  if (!isUndoSupportedEntityType(entityType)) {
    return blockAll(ids, UNDO_BLOCKED_REASONS.UNSUPPORTED_ENTITY_TYPE);
  }

  const entities = await fetchEntities(client, tenantId, entityType, ids);
  const blockedBy = await collectReferenceBlocks(
    client,
    tenantId,
    entityType,
    ids,
  );
  const audits = await findModificationAudits(
    client,
    tenantId,
    entityType,
    ids,
    appliedAt,
  );

  const results = new Map<string, ImportUndoEligibility>();
  for (const id of ids) {
    results.set(
      id,
      evaluateEntity(
        entityType,
        entities.get(id),
        id,
        blockedBy,
        audits.get(id),
        appliedAt,
      ),
    );
  }
  return results;
}

function evaluateEntity(
  entityType: string,
  entity: UndoEntityRecord | undefined,
  id: string,
  blockedBy: Map<string, ImportUndoEligibility>,
  audit: { occurred_at: Date } | undefined,
  appliedAt: Date,
): ImportUndoEligibility {
  if (!entity) {
    return {
      status: 'BLOCKED',
      reason: UNDO_BLOCKED_REASONS.ENTITY_NOT_FOUND,
    };
  }
  const referenceBlock =
    blockedBy.get(id) ?? checkEntityLocalReference(entityType, entity);
  if (referenceBlock) {
    return { ...referenceBlock, entity };
  }
  const conflict = findModification(entity, audit, appliedAt);
  if (conflict) {
    return { ...conflict, entity };
  }
  return { status: 'ELIGIBLE', entity };
}

async function collectReferenceBlocks(
  client: UndoGuardPrismaClient,
  tenantId: string,
  entityType: string,
  ids: string[],
): Promise<Map<string, ImportUndoEligibility>> {
  const idSet = new Set(ids);
  const blockedBy = new Map<string, ImportUndoEligibility>();
  for (const check of buildRefChecks(client, tenantId, entityType)) {
    for (const row of await check.load(ids)) {
      const ownerId = ownerOf(row, check.owners, idSet);
      if (!ownerId || blockedBy.has(ownerId)) {
        continue;
      }
      blockedBy.set(ownerId, {
        status: 'BLOCKED',
        reason: check.reason,
        references: [`${check.type}:${String(row.id)}`],
      });
    }
  }
  return blockedBy;
}

function ownerOf(
  row: RefRow,
  owners: string[],
  idSet: Set<string>,
): string | null {
  for (const column of owners) {
    const value = row[column];
    if (typeof value === 'string' && idSet.has(value)) {
      return value;
    }
  }
  return null;
}

export async function fetchEntities(
  client: UndoGuardPrismaClient,
  tenantId: string,
  entityType: string,
  entityIds: string[],
): Promise<Map<string, UndoEntityRecord>> {
  const rows = await findEntityRows(client, tenantId, entityType, entityIds);
  const entities = new Map<string, UndoEntityRecord>();
  for (const row of rows) {
    entities.set(row.id, row);
  }
  return entities;
}

async function findEntityRows(
  client: UndoGuardPrismaClient,
  tenantId: string,
  entityType: string,
  ids: string[],
): Promise<UndoEntityRecord[]> {
  const where = { tenant_id: tenantId, id: { in: ids } };
  switch (entityType) {
    case 'CUSTOMER':
      return client.customer.findMany({ where });
    case 'VEHICLE':
      return client.vehicle.findMany({ where });
    case 'LABOR_OPERATION':
      return client.laborOperation.findMany({ where });
    case 'CATALOG_ITEM':
    case 'SUPPLIER_PRICE_LIST':
      return client.catalogItem.findMany({ where });
    case 'VEHICLE_NOTICE':
      return client.vehicleNotice.findMany({ where });
    case 'VEHICLE_PARTY':
      return client.vehicleParty.findMany({ where });
    default:
      return [];
  }
}

function buildRefChecks(
  client: UndoGuardPrismaClient,
  tenantId: string,
  entityType: string,
): BatchedRefCheck[] {
  switch (entityType) {
    case 'CUSTOMER':
      return customerRefChecks(client, tenantId);
    case 'VEHICLE':
      return vehicleRefChecks(client, tenantId);
    case 'LABOR_OPERATION':
      return [
        refCheck(
          'workshopTaskLineItem',
          UNDO_BLOCKED_REASONS.DOWNSTREAM_WORK_ORDER,
          ['labor_operation_id'],
          (ids) =>
            client.workshopTaskLineItem.findMany({
              where: { tenant_id: tenantId, labor_operation_id: { in: ids } },
              select: { id: true, labor_operation_id: true },
            }),
        ),
      ];
    case 'CATALOG_ITEM':
    case 'SUPPLIER_PRICE_LIST':
      return catalogItemRefChecks(client, tenantId);
    default:
      return [];
  }
}

function customerRefChecks(
  client: UndoGuardPrismaClient,
  tenantId: string,
): BatchedRefCheck[] {
  const byCustomer = (
    type: string,
    reason: UndoBlockedReasonCode,
    load: RefLoader,
  ) => refCheck(type, reason, ['customer_id'], load);
  const byCustomerOrBillTo = (
    type: string,
    reason: UndoBlockedReasonCode,
    load: RefLoader,
  ) => refCheck(type, reason, ['customer_id', 'bill_to_customer_id'], load);
  const customerWhere = (ids: string[]) => ({
    tenant_id: tenantId,
    customer_id: { in: ids },
  });
  const select = { id: true, customer_id: true };
  const selectWithBillTo = {
    id: true,
    customer_id: true,
    bill_to_customer_id: true,
  };
  const billToWhere = (ids: string[]) => ({
    tenant_id: tenantId,
    OR: [{ customer_id: { in: ids } }, { bill_to_customer_id: { in: ids } }],
  });
  return [
    byCustomer('invoice', UNDO_BLOCKED_REASONS.DOWNSTREAM_INVOICE, (ids) =>
      client.invoice.findMany({ where: customerWhere(ids), select }),
    ),
    byCustomerOrBillTo(
      'workshopOrder',
      UNDO_BLOCKED_REASONS.DOWNSTREAM_WORK_ORDER,
      (ids) =>
        client.workshopOrder.findMany({
          where: billToWhere(ids),
          select: selectWithBillTo,
        }),
    ),
    byCustomer(
      'salesOrder',
      UNDO_BLOCKED_REASONS.DOWNSTREAM_SALES_ORDER,
      (ids) =>
        client.salesOrder.findMany({ where: customerWhere(ids), select }),
    ),
    byCustomer(
      'vehicleSale',
      UNDO_BLOCKED_REASONS.DOWNSTREAM_VEHICLE_SALE,
      (ids) =>
        client.vehicleSale.findMany({ where: customerWhere(ids), select }),
    ),
    byCustomer(
      'vehiclePurchase',
      UNDO_BLOCKED_REASONS.DOWNSTREAM_VEHICLE_PURCHASE,
      (ids) =>
        client.vehiclePurchase.findMany({ where: customerWhere(ids), select }),
    ),
    byCustomer(
      'loanerBooking',
      UNDO_BLOCKED_REASONS.DOWNSTREAM_LOANER_BOOKING,
      (ids) =>
        client.loanerBooking.findMany({ where: customerWhere(ids), select }),
    ),
    byCustomer(
      'customerConsent',
      UNDO_BLOCKED_REASONS.DOWNSTREAM_CUSTOMER_CONSENT,
      (ids) =>
        client.customerConsent.findMany({ where: customerWhere(ids), select }),
    ),
    byCustomer(
      'customerContactPoint',
      UNDO_BLOCKED_REASONS.DOWNSTREAM_CUSTOMER_CONTACT_POINT,
      (ids) =>
        client.customerContactPoint.findMany({
          where: customerWhere(ids),
          select,
        }),
    ),
    byCustomer(
      'vehicle',
      UNDO_BLOCKED_REASONS.DOWNSTREAM_CUSTOMER_VEHICLE,
      (ids) => client.vehicle.findMany({ where: customerWhere(ids), select }),
    ),
    byCustomerOrBillTo(
      'legacyDocument',
      UNDO_BLOCKED_REASONS.DOWNSTREAM_CUSTOMER_LEGACY_DOCUMENT,
      (ids) =>
        client.legacyDocument.findMany({
          where: billToWhere(ids),
          select: selectWithBillTo,
        }),
    ),
  ];
}

function vehicleRefChecks(
  client: UndoGuardPrismaClient,
  tenantId: string,
): BatchedRefCheck[] {
  const byVehicle = (
    type: string,
    reason: UndoBlockedReasonCode,
    load: RefLoader,
  ) => refCheck(type, reason, ['vehicle_id'], load);
  const select = { id: true, vehicle_id: true };
  const vehicleWhere = (ids: string[]) => ({
    tenant_id: tenantId,
    vehicle_id: { in: ids },
  });
  return [
    byVehicle(
      'workshopOrder',
      UNDO_BLOCKED_REASONS.DOWNSTREAM_WORK_ORDER,
      (ids) =>
        client.workshopOrder.findMany({ where: vehicleWhere(ids), select }),
    ),
    byVehicle('invoice', UNDO_BLOCKED_REASONS.DOWNSTREAM_INVOICE, (ids) =>
      client.invoice.findMany({ where: vehicleWhere(ids), select }),
    ),
    byVehicle(
      'salesOrder',
      UNDO_BLOCKED_REASONS.DOWNSTREAM_SALES_ORDER,
      (ids) => client.salesOrder.findMany({ where: vehicleWhere(ids), select }),
    ),
    byVehicle(
      'vehicleLedgerEntry',
      UNDO_BLOCKED_REASONS.DOWNSTREAM_STOCK_MOVEMENT,
      (ids) =>
        client.vehicleLedgerEntry.findMany({
          where: vehicleWhere(ids),
          select,
        }),
    ),
    byVehicle(
      'vehicleSale',
      UNDO_BLOCKED_REASONS.DOWNSTREAM_VEHICLE_SALE,
      (ids) =>
        client.vehicleSale.findMany({ where: vehicleWhere(ids), select }),
    ),
    byVehicle(
      'vehiclePurchase',
      UNDO_BLOCKED_REASONS.DOWNSTREAM_VEHICLE_PURCHASE,
      (ids) =>
        client.vehiclePurchase.findMany({ where: vehicleWhere(ids), select }),
    ),
    byVehicle(
      'vehicleMedia',
      UNDO_BLOCKED_REASONS.DOWNSTREAM_VEHICLE_MEDIA,
      (ids) =>
        client.vehicleMedia.findMany({ where: vehicleWhere(ids), select }),
    ),
    byVehicle(
      'vehicleEquipmentSelection',
      UNDO_BLOCKED_REASONS.DOWNSTREAM_VEHICLE_EQUIPMENT,
      (ids) =>
        client.vehicleEquipmentSelection.findMany({
          where: vehicleWhere(ids),
          select,
        }),
    ),
    byVehicle(
      'vehicleEquipmentFreeTextItem',
      UNDO_BLOCKED_REASONS.DOWNSTREAM_VEHICLE_EQUIPMENT,
      (ids) =>
        client.vehicleEquipmentFreeTextItem.findMany({
          where: vehicleWhere(ids),
          select,
        }),
    ),
    byVehicle(
      'vehicleListing',
      UNDO_BLOCKED_REASONS.DOWNSTREAM_VEHICLE_LISTING,
      (ids) =>
        client.vehicleListing.findMany({ where: vehicleWhere(ids), select }),
    ),
    byVehicle(
      'vehicleValuationSnapshot',
      UNDO_BLOCKED_REASONS.DOWNSTREAM_VEHICLE_VALUATION,
      (ids) =>
        client.vehicleValuationSnapshot.findMany({
          where: vehicleWhere(ids),
          select,
        }),
    ),
    byVehicle(
      'vehicleParty',
      UNDO_BLOCKED_REASONS.DOWNSTREAM_VEHICLE_PARTY,
      (ids) =>
        client.vehicleParty.findMany({ where: vehicleWhere(ids), select }),
    ),
    byVehicle(
      'vehicleNotice',
      UNDO_BLOCKED_REASONS.DOWNSTREAM_VEHICLE_NOTICE,
      (ids) =>
        client.vehicleNotice.findMany({ where: vehicleWhere(ids), select }),
    ),
    byVehicle('tyreSet', UNDO_BLOCKED_REASONS.DOWNSTREAM_TYRE_RECORD, (ids) =>
      client.tyreSet.findMany({ where: vehicleWhere(ids), select }),
    ),
    byVehicle(
      'tyreMeasurement',
      UNDO_BLOCKED_REASONS.DOWNSTREAM_TYRE_RECORD,
      (ids) =>
        client.tyreMeasurement.findMany({ where: vehicleWhere(ids), select }),
    ),
    byVehicle(
      'vehicleInspectionRecord',
      UNDO_BLOCKED_REASONS.DOWNSTREAM_INSPECTION_RECORD,
      (ids) =>
        client.vehicleInspectionRecord.findMany({
          where: vehicleWhere(ids),
          select,
        }),
    ),
  ];
}

function catalogItemRefChecks(
  client: UndoGuardPrismaClient,
  tenantId: string,
): BatchedRefCheck[] {
  const byCatalogItem = (
    type: string,
    reason: UndoBlockedReasonCode,
    load: RefLoader,
  ) => refCheck(type, reason, ['catalog_item_id'], load);
  const select = { id: true, catalog_item_id: true };
  const catalogItemWhere = (ids: string[]) => ({
    tenant_id: tenantId,
    catalog_item_id: { in: ids },
  });
  return [
    byCatalogItem(
      'inventoryTransaction',
      UNDO_BLOCKED_REASONS.DOWNSTREAM_STOCK_MOVEMENT,
      (ids) =>
        client.inventoryTransaction.findMany({
          where: catalogItemWhere(ids),
          select,
        }),
    ),
    byCatalogItem(
      'invoiceItem',
      UNDO_BLOCKED_REASONS.DOWNSTREAM_INVOICE,
      (ids) =>
        client.invoiceItem.findMany({
          where: catalogItemWhere(ids),
          select,
        }),
    ),
    byCatalogItem(
      'purchaseOrderItem',
      UNDO_BLOCKED_REASONS.DOWNSTREAM_PURCHASE_ORDER,
      (ids) =>
        client.purchaseOrderItem.findMany({
          where: catalogItemWhere(ids),
          select,
        }),
    ),
  ];
}

/** Reference state that lives on the entity itself and needs no extra query. */
function checkEntityLocalReference(
  entityType: string,
  entity: UndoEntityRecord,
): ImportUndoEligibility | null {
  if (entityType !== 'VEHICLE_NOTICE') {
    return null;
  }
  if (entity.resolved_workshop_order_id || entity.status === 'RESOLVED') {
    return {
      status: 'BLOCKED',
      reason: UNDO_BLOCKED_REASONS.DOWNSTREAM_WORK_ORDER,
      references: entity.resolved_workshop_order_id
        ? [`workshopOrder:${entity.resolved_workshop_order_id}`]
        : [],
    };
  }
  return null;
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

async function findModificationAudits(
  client: UndoGuardPrismaClient,
  tenantId: string,
  entityType: string,
  ids: string[],
  appliedAt: Date,
): Promise<Map<string, { occurred_at: Date }>> {
  const threshold = new Date(appliedAt.getTime() + LEAWAY_MS);
  const rows = await client.auditLog.findMany({
    where: {
      tenant_id: tenantId,
      entity_type: { in: getAuditEntityTypeVariants(entityType) },
      entity_id: { in: ids },
      occurred_at: { gt: threshold },
    },
    orderBy: { occurred_at: 'desc' },
    select: { entity_id: true, occurred_at: true },
  });
  const latest = new Map<string, { occurred_at: Date }>();
  for (const row of rows) {
    if (!latest.has(row.entity_id)) {
      latest.set(row.entity_id, { occurred_at: row.occurred_at });
    }
  }
  return latest;
}

function findModification(
  entity: UndoEntityRecord,
  audit: { occurred_at: Date } | undefined,
  appliedAt: Date,
): ImportUndoEligibility | null {
  const threshold = appliedAt.getTime() + LEAWAY_MS;
  if (entity.updatedAt && entity.updatedAt.getTime() > threshold) {
    return {
      status: 'CONFLICT',
      reason: UNDO_BLOCKED_REASONS.MODIFIED_SINCE_IMPORT,
      currentUpdatedAt: entity.updatedAt,
    };
  }
  if (audit) {
    return {
      status: 'CONFLICT',
      reason: UNDO_BLOCKED_REASONS.MODIFIED_SINCE_IMPORT,
      currentUpdatedAt: audit.occurred_at,
    };
  }
  return null;
}
