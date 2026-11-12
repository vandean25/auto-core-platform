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
  allocatePurchaseOrderNumber,
  createPurchaseOrderWithAllocatedNumber,
  formatPurchaseOrderNumber,
} from '../src/purchase/purchase-order-number.util.js';
import { waitForBlockedLock } from './helpers/pg-lock-wait.js';
import {
  passThroughPurchaseOrderCreateSavepoint,
  resetPurchaseOrderCreateSavepointPortForTests,
  setPurchaseOrderCreateSavepointPortForTests,
} from '../src/purchase/purchase-order-create-savepoint.js';

describe('Purchase order number allocation (e2e)', () => {
  let app: INestApplication;
  let rootPrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let siteId: string;
  let vendorId: string;

  beforeAll(async () => {
    app = await createE2eApp();
    rootPrisma = app.get(PrismaService);
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

  it('fails the same transaction when savepoint retry is disabled', async () => {
    const year = new Date().getFullYear();
    const takenNumber = formatPurchaseOrderNumber(year, 5);
    setPurchaseOrderCreateSavepointPortForTests(
      passThroughPurchaseOrderCreateSavepoint,
    );
    try {
      await expect(
        prisma.$transaction(async (tx) => {
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
            update: { current: 4 },
            create: { tenant_id: tenantId, year, current: 4 },
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
        }),
      ).rejects.toThrow();
    } finally {
      resetPurchaseOrderCreateSavepointPortForTests();
    }
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

  // Regression: when the tenant/year sequence row was missing, the second of two
  // overlapping allocations hit a unique violation on the seed insert, which aborted
  // its transaction and failed the purchase-order create.
  it('seeds a missing sequence row under two overlapping allocations', async () => {
    const now = new Date('2031-06-01T12:00:00.000Z');
    const year = now.getFullYear();
    await prisma.purchaseOrder.create({
      data: {
        tenant_id: tenantId,
        site_id: siteId,
        vendor_id: vendorId,
        order_number: formatPurchaseOrderNumber(year, 7),
        status: PurchaseOrderStatus.DRAFT,
      },
    });

    let releaseFirst!: () => void;
    const firstMayCommit = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstSeeded!: () => void;
    const seeded = new Promise<void>((resolve) => {
      firstSeeded = resolve;
    });
    const first = prisma.$transaction(async (tx) => {
      const orderNumber = await allocatePurchaseOrderNumber(tx, tenantId, now);
      firstSeeded();
      await firstMayCommit;
      return orderNumber;
    });
    await seeded;
    // The first transaction holds its uncommitted sequence row, so the second one
    // still sees no row and its seed insert queues behind the first.
    const second = prisma.$transaction((tx) =>
      allocatePurchaseOrderNumber(tx, tenantId, now),
    );
    await waitForBlockedLock(rootPrisma);
    releaseFirst();

    await expect(Promise.all([first, second])).resolves.toEqual([
      formatPurchaseOrderNumber(year, 8),
      formatPurchaseOrderNumber(year, 9),
    ]);
  });
});
