import { teardownTestApp } from '../test-lifecycle.js';
import {
  seedInvoiceReadyCustomer,
  seedReadySellerAndAccountingProfile,
} from '../invoice-snapshot-v2-test-utils.js';
import { resolveTestMainSiteId } from '../tenant-test-utils.js';
import {
  bootstrapE2eApp,
  createE2eTenant,
  deleteDocumentBrandRows,
} from './e2e-suite.js';

/**
 * Shared fixture for the SalesController specs: a tenant with a ready seller, an invoice-ready
 * customer, and one catalog item with 100 units on a warehouse location.
 */
export async function createSalesInvoiceSuite() {
  const { app, basePrisma } = await bootstrapE2eApp();
  const { tenantId, prisma, authToken } = await createE2eTenant(
    app,
    basePrisma,
  );
  const legalEntityId = (
    await prisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenantId },
      select: { id: true },
    })
  ).id;

  await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "inventory_transactions",
        "inventory_stocks",
        "invoice_items",
        "invoices",
        "invoice_sequences",
        "sales_order_items",
        "sales_orders"
      CASCADE;
    `);

  await seedReadySellerAndAccountingProfile(prisma, tenantId);
  const customer = await seedInvoiceReadyCustomer(prisma, tenantId);

  const catalogItem = await prisma.catalogItem.create({
    data: {
      tenant_id: tenantId,
      sku: `TEST-ITEM-${Date.now()}`,
      name: 'Test Item',
      cost_price: 10,
      retail_price: 20,
    },
  });

  // Create Stock
  const siteId = await resolveTestMainSiteId(prisma, tenantId);
  const location = await prisma.storageLocation.create({
    data: {
      tenant_id: tenantId,
      code: `LOC-${Date.now()}`,
      name: 'Test Location',
      type: 'warehouse',
      site_id: siteId,
    },
  });

  await prisma.inventoryStock.create({
    data: {
      tenant_id: tenantId,
      catalog_item_id: catalogItem.id,
      site_id: siteId,
      location_id: location.id,
      quantity_on_hand: 100,
    },
  });

  return {
    app,
    basePrisma,
    prisma,
    tenantId,
    authToken,
    legalEntityId,
    customerId: customer.id,
    catalogItemId: catalogItem.id,
  };
}

export type SalesInvoiceSuite = Awaited<
  ReturnType<typeof createSalesInvoiceSuite>
>;

/**
 * Clears the sales and invoicing rows the suite created, then shuts the app down.
 */
export async function disposeSalesInvoiceSuite({
  app,
  basePrisma,
  prisma,
  tenantId,
}: Pick<SalesInvoiceSuite, 'app' | 'basePrisma' | 'prisma' | 'tenantId'>) {
  await prisma.inventoryTransaction.deleteMany();
  await prisma.inventoryStock.deleteMany();
  await prisma.storageLocation.deleteMany();
  await deleteDocumentBrandRows(basePrisma, prisma, tenantId);
  await prisma.invoiceItem.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.salesOrderItem.deleteMany();
  await prisma.salesOrder.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.catalogItem.deleteMany();
  await prisma.revenueGroup.deleteMany();
  await prisma.brand.deleteMany();
  await teardownTestApp(app, prisma);
}
