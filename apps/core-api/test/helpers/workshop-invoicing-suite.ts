import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../src/prisma/prisma.service.js';
import { seedReadySellerAndAccountingProfile } from '../invoice-snapshot-v2-test-utils.js';
import { teardownTestApp } from '../test-lifecycle.js';
import {
  bootstrapE2eApp,
  createE2eTenant,
  deleteDocumentBrandRows,
} from './e2e-suite.js';

/**
 * Shared fixture for the workshop invoicing specs: a tenant with a ready seller, an empty invoice
 * ledger, and a private workshop customer.
 */
export async function createWorkshopInvoicingSuite() {
  const { app, basePrisma } = await bootstrapE2eApp();
  const { tenantId, prisma, authToken } = await createE2eTenant(
    app,
    basePrisma,
  );
  await seedReadySellerAndAccountingProfile(prisma, tenantId);
  const legalEntityId = (
    await prisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenantId },
      select: { id: true },
    })
  ).id;

  await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "invoice_items",
        "invoices",
        "workshop_task_line_items",
        "workshop_tasks",
        "workshop_orders",
        "vehicles",
        "customers",
        "invoice_sequences"
      CASCADE;
    `);

  const customer = await prisma.customer.create({
    data: {
      tenant_id: tenantId,
      first_name: 'Workshop',
      last_name: 'Customer',
      email: `workshop-${Date.now()}@example.com`,
      type: 'PRIVATE',
      address_street: 'Werkstattstraße 1',
      address_zip: '1010',
      address_city: 'Wien',
      address_country: 'AT',
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
  };
}

export type WorkshopInvoicingSuite = Awaited<
  ReturnType<typeof createWorkshopInvoicingSuite>
>;

/**
 * Creates a fresh BMW for the customer, so each test gets its own vehicle and VIN.
 */
export async function createWorkshopVehicle(
  prisma: PrismaService,
  customerId: string,
) {
  // The tenant-scoped client adds tenant_id to this lookup.
  const customer = await prisma.customer.findFirstOrThrow({
    where: { id: customerId },
    select: { tenant_id: true },
  });
  const vehicle = await prisma.vehicle.create({
    data: {
      tenant_id: customer.tenant_id,
      make: 'BMW',
      model: 'X3',
      year: 2021,
      vin: `VIN-INV-${randomUUID()}`,
      customer_id: customerId,
    },
  });
  return vehicle.id;
}

/**
 * Clears the invoicing, workshop, and customer rows the suite created, then shuts the app down.
 */
export async function disposeWorkshopInvoicingSuite({
  app,
  basePrisma,
  prisma,
  tenantId,
}: Pick<WorkshopInvoicingSuite, 'app' | 'basePrisma' | 'prisma' | 'tenantId'>) {
  await deleteDocumentBrandRows(basePrisma, prisma, tenantId);
  await prisma.invoiceItem.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.workshopTaskLineItem.deleteMany();
  await prisma.workshopTask.deleteMany();
  await prisma.workshopOrder.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.invoiceSequence.deleteMany();
  await teardownTestApp(app, prisma);
}
