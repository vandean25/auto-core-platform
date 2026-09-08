import type { SeedPrismaClient } from './types';

export interface TableCleaner {
  table: string;
  clean: (prisma: SeedPrismaClient) => Promise<unknown>;
}

/**
 * Ordered list of table cleaners arranged in topological order to satisfy foreign key constraints.
 * Dependent / child tables are cleaned before referenced / parent tables.
 * `tenants` is cleaned last because all tenant-scoped tables reference it via foreign key.
 */
export const TABLE_CLEANERS: TableCleaner[] = [
  {
    table: 'purchase_invoice_lines',
    clean: (p) => p.purchaseInvoiceLine.deleteMany(),
  },
  { table: 'purchase_invoices', clean: (p) => p.purchaseInvoice.deleteMany() },
  {
    table: 'purchase_order_items',
    clean: (p) => p.purchaseOrderItem.deleteMany(),
  },
  { table: 'purchase_orders', clean: (p) => p.purchaseOrder.deleteMany() },
  {
    table: 'inventory_transactions',
    clean: (p) => p.inventoryTransaction.deleteMany(),
  },
  {
    table: 'parts_reservations',
    clean: (p) => p.partsReservation.deleteMany(),
  },
  {
    table: 'parts_requisition_lines',
    clean: (p) => p.partsRequisitionLine.deleteMany(),
  },
  {
    table: 'parts_requisitions',
    clean: (p) => p.partsRequisition.deleteMany(),
  },
  { table: 'inventory_stocks', clean: (p) => p.inventoryStock.deleteMany() },
  { table: 'invoice_items', clean: (p) => p.invoiceItem.deleteMany() },
  { table: 'invoices', clean: (p) => p.invoice.deleteMany() },
  { table: 'catalog_items', clean: (p) => p.catalogItem.deleteMany() },
  {
    table: 'workshop_opening_hours',
    clean: (p) => p.workshopOpeningHour.deleteMany(),
  },
  { table: 'workshop_holidays', clean: (p) => p.workshopHoliday.deleteMany() },
  { table: 'storage_locations', clean: (p) => p.storageLocation.deleteMany() },
  { table: 'site_memberships', clean: (p) => p.siteMembership.deleteMany() },
  { table: 'sites', clean: (p) => p.site.deleteMany() },
  { table: 'legal_entities', clean: (p) => p.legalEntity.deleteMany() },
  { table: 'revenue_groups', clean: (p) => p.revenueGroup.deleteMany() },
  { table: 'finance_settings', clean: (p) => p.financeSettings.deleteMany() },
  {
    table: 'catalog_provider_settings',
    clean: (p) => p.catalogProviderSettings.deleteMany(),
  },
  { table: 'labor_operations', clean: (p) => p.laborOperation.deleteMany() },
  {
    table: 'labor_categories',
    clean: async (p) => {
      await p.laborCategory.deleteMany({ where: { parent_id: { not: null } } });
      await p.laborCategory.deleteMany();
    },
  },
  { table: 'workshop_orders', clean: (p) => p.workshopOrder.deleteMany() },
  {
    table: 'voice_note_rate_limits',
    clean: (p) => p.voiceNoteRateLimit.deleteMany(),
  },
  { table: 'vehicles', clean: (p) => p.vehicle.deleteMany() },
  {
    table: 'catalog_oem_concern_makes',
    clean: (p) => p.catalogOemConcernMake.deleteMany(),
  },
  {
    table: 'catalog_oem_concerns',
    clean: (p) => p.catalogOemConcern.deleteMany(),
  },
  {
    table: 'vehicle_make_aliases',
    clean: (p) => p.vehicleMakeAlias.deleteMany(),
  },
  { table: 'customers', clean: (p) => p.customer.deleteMany() },
  { table: 'vendors', clean: (p) => p.vendor.deleteMany() },
  { table: 'brands', clean: (p) => p.brand.deleteMany() },
  { table: 'tenants', clean: (p) => p.tenant.deleteMany() },
];

async function getExistingTables(
  prisma: SeedPrismaClient,
): Promise<Set<string>> {
  // eslint-disable-next-line no-restricted-syntax -- Schema inspection to discover existing tables in database
  const result = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
  `;
  return new Set((result || []).map((row) => row.table_name));
}

/**
 * Cleans all database tables in topological order to satisfy foreign key constraints.
 * Replaces iterative single tableExists checks with a single query to information_schema.
 */
export async function cleanDb(prisma: SeedPrismaClient): Promise<string[]> {
  console.log('Cleaning database...');
  const existingTables = await getExistingTables(prisma);
  const cleaned: string[] = [];

  for (const cleaner of TABLE_CLEANERS) {
    if (existingTables.has(cleaner.table)) {
      await cleaner.clean(prisma);
      cleaned.push(cleaner.table);
    }
  }

  return cleaned;
}
