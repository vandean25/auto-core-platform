import { createE2eApp } from './helpers/e2e-suite.js';
import { INestApplication } from '@nestjs/common';
import { InventoryPriceOperationState } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTestTenant,
  runWithTenantContext,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('inventory_price_operations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let itemId: string;

  beforeEach(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    const testTenant = await createTestTenant(prisma, 'price-ops-journal');
    tenantId = testTenant.tenantId;

    await runWithTenantContext(tenantId, async () => {
      const item = await prisma.catalogItem.create({
        data: {
          tenant_id: tenantId,
          sku: 'JOURNAL-001',
          name: 'Journal part',
          retail_price: 10,
          unit: 'pcs',
        },
      });
      itemId = item.id;
    });
  });

  afterEach(async () => {
    if (tenantId) {
      await cleanupTestTenantGraph(prisma, tenantId);
      tenantId = '';
    }
    await teardownTestApp(app, prisma);
  });

  it('rejects duplicate idempotency key for same principal', async () => {
    const principalId = 'user-principal-key';
    const key = '00000000-0000-7000-8000-000000000010';
    const baseRow = {
      tenant_id: tenantId,
      principal_id: principalId,
      item_id: itemId,
      sku: 'JOURNAL-001',
      kind: 'RETAIL_PRICE',
      expected_revision: BigInt(1),
      target_minor: BigInt(1500),
      basis_minor: BigInt(1000),
      accepted_at: new Date(),
    };

    await runWithTenantContext(tenantId, async () => {
      await prisma.inventoryPriceOperation.create({
        data: {
          ...baseRow,
          key,
          state: InventoryPriceOperationState.ACCEPTED,
        },
      });
    });

    await expect(
      runWithTenantContext(tenantId, async () =>
        prisma.inventoryPriceOperation.create({
          data: {
            ...baseRow,
            key,
            state: InventoryPriceOperationState.APPLIED,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows a new accepted after applied for the same principal and item', async () => {
    const principalId = 'user-principal-applied';
    const keyApplied = '00000000-0000-7000-8000-000000000020';
    const keyAccepted = '00000000-0000-7000-8000-000000000021';
    const baseRow = {
      tenant_id: tenantId,
      principal_id: principalId,
      item_id: itemId,
      sku: 'JOURNAL-001',
      kind: 'RETAIL_PRICE',
      expected_revision: BigInt(2),
      target_minor: BigInt(1600),
      basis_minor: BigInt(1000),
      accepted_at: new Date(),
    };

    await runWithTenantContext(tenantId, async () => {
      await prisma.inventoryPriceOperation.create({
        data: {
          ...baseRow,
          key: keyApplied,
          state: InventoryPriceOperationState.APPLIED,
          final_at: new Date(),
        },
      });
      await prisma.inventoryPriceOperation.create({
        data: {
          ...baseRow,
          key: keyAccepted,
          state: InventoryPriceOperationState.ACCEPTED,
        },
      });
    });

    const rows = await runWithTenantContext(tenantId, async () =>
      prisma.inventoryPriceOperation.findMany({
        where: { principal_id: principalId, item_id: itemId },
      }),
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.state).sort()).toEqual([
      InventoryPriceOperationState.ACCEPTED,
      InventoryPriceOperationState.APPLIED,
    ]);
  });

  it('one accepted per principal and item', async () => {
    const principalId = 'user-principal-1';
    const keyA = '00000000-0000-7000-8000-000000000001';
    const keyB = '00000000-0000-7000-8000-000000000002';
    const baseRow = {
      tenant_id: tenantId,
      principal_id: principalId,
      item_id: itemId,
      sku: 'JOURNAL-001',
      kind: 'RETAIL_PRICE',
      expected_revision: BigInt(1),
      target_minor: BigInt(1500),
      basis_minor: BigInt(1000),
      accepted_at: new Date(),
    };

    await runWithTenantContext(tenantId, async () => {
      await prisma.inventoryPriceOperation.create({
        data: {
          ...baseRow,
          key: keyA,
          state: InventoryPriceOperationState.ACCEPTED,
        },
      });
    });

    await expect(
      runWithTenantContext(tenantId, async () =>
        prisma.inventoryPriceOperation.create({
          data: {
            ...baseRow,
            key: keyB,
            state: InventoryPriceOperationState.ACCEPTED,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
