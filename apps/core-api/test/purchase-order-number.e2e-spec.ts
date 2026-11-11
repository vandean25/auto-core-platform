import { INestApplication } from '@nestjs/common';
import { PurchaseOrderStatus } from '@prisma/client';
import { createE2eApp } from './helpers/e2e-suite.js';
import {
  createTenantAwarePrisma,
  createTestTenant,
  resolveTestMainSiteId,
} from './tenant-test-utils.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { teardownTestApp } from './test-lifecycle.js';
import {
  createPurchaseOrderWithAllocatedNumber,
  formatPurchaseOrderNumber,
} from '../src/purchase/purchase-order-number.util.js';

describe('Purchase order number allocation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let siteId: string;
  let vendorId: string;

  beforeAll(async () => {
    app = await createE2eApp();
    const rootPrisma = app.get(PrismaService);
    const testTenant = await createTestTenant(rootPrisma);
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(rootPrisma, tenantId);
    siteId = await resolveTestMainSiteId(prisma, tenantId);

    const vendor = await prisma.vendor.create({
      data: {
        tenant_id: tenantId,
        name: `PO-number-vendor-${Date.now()}`,
        email: `po-num-${Date.now()}@example.com`,
        account_number: `POV-${Date.now()}`,
      },
    });
    vendorId = vendor.id;
  });

  afterAll(async () => {
    await teardownTestApp(app);
  });

  it('retries after order_number unique violation in the same transaction', async () => {
    const year = new Date().getFullYear();
    const takenSuffix = 5;
    const takenNumber = formatPurchaseOrderNumber(year, takenSuffix);

    const created = await prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.create({
        data: {
          tenant_id: tenantId,
          site_id: siteId,
          vendor_id: vendorId,
          order_number: takenNumber,
          status: PurchaseOrderStatus.DRAFT,
        },
      });

      await tx.purchaseOrderSequence.upsert({
        where: { tenant_id_year: { tenant_id: tenantId, year } },
        update: { current: takenSuffix - 1 },
        create: { tenant_id: tenantId, year, current: takenSuffix - 1 },
      });

      return createPurchaseOrderWithAllocatedNumber(
        tx,
        tenantId,
        new Date(),
        (orderNumber) =>
          tx.purchaseOrder.create({
            data: {
              tenant_id: tenantId,
              site_id: siteId,
              vendor_id: vendorId,
              order_number: orderNumber,
              status: PurchaseOrderStatus.DRAFT,
            },
          }),
      );
    });

    expect(created.order_number).toBe(
      formatPurchaseOrderNumber(year, takenSuffix + 1),
    );
  });
});
