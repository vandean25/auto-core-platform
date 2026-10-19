import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTenantAwarePrisma,
  createTestTenant,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('customer and workshop composite FK tenant isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantAId: string;
  let tenantBId: string;

  const prefix = `e2e-composite-fk-${Date.now()}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    const tenantA = await createTestTenant(prisma, `${prefix}-a`);
    const tenantB = await createTestTenant(prisma, `${prefix}-b`);
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;
  });

  afterAll(async () => {
    await teardownTestApp(app);
  });

  it('rejects default bill-to customer from another tenant', async () => {
    const tenantAPrisma = createTenantAwarePrisma(prisma, tenantAId);
    const tenantBPrisma = createTenantAwarePrisma(prisma, tenantBId);

    const customerA = await tenantAPrisma.customer.create({
      data: {
        tenant_id: tenantAId,
        first_name: 'Bill',
        last_name: 'ToA',
        email: `${prefix}-a@example.com`,
      },
    });

    const customerB = await tenantBPrisma.customer.create({
      data: {
        tenant_id: tenantBId,
        first_name: 'Bill',
        last_name: 'ToB',
        email: `${prefix}-b@example.com`,
      },
    });

    const attempt = tenantAPrisma.customer.update({
      where: { id: customerA.id },
      data: { default_bill_to_customer_id: customerB.id },
    });

    await expect(attempt).rejects.toMatchObject({ code: 'P2003' });
  });

  it('rejects workshop order bill-to customer from another tenant', async () => {
    const tenantAPrisma = createTenantAwarePrisma(prisma, tenantAId);
    const tenantBPrisma = createTenantAwarePrisma(prisma, tenantBId);

    const siteA = await tenantAPrisma.site.findFirstOrThrow({
      where: { tenant_id: tenantAId },
    });

    const customerB = await tenantBPrisma.customer.create({
      data: {
        tenant_id: tenantBId,
        first_name: 'Order',
        last_name: 'BillB',
        email: `${prefix}-order-b@example.com`,
      },
    });

    const vehicleA = await tenantAPrisma.vehicle.create({
      data: {
        tenant_id: tenantAId,
        make: 'Test',
        model: 'Car',
        year: 2020,
        vin: `VIN${prefix}A`.padEnd(17, '0').slice(0, 17),
      },
    });

    const attempt = tenantAPrisma.workshopOrder.create({
      data: {
        tenant_id: tenantAId,
        site_id: siteA.id,
        vehicle_id: vehicleA.id,
        order_number: `${prefix}-WO-1`,
        odometer: 1,
        fuel_level: 50,
        bill_to_customer_id: customerB.id,
      },
    });

    await expect(attempt).rejects.toMatchObject({ code: 'P2003' });
  });

  it('clears default bill-to when the referenced customer is deleted', async () => {
    const tenantAPrisma = createTenantAwarePrisma(prisma, tenantAId);

    const billToCustomer = await tenantAPrisma.customer.create({
      data: {
        tenant_id: tenantAId,
        first_name: 'Default',
        last_name: 'BillTo',
        email: `${prefix}-billto@example.com`,
      },
    });

    const payerCustomer = await tenantAPrisma.customer.create({
      data: {
        tenant_id: tenantAId,
        first_name: 'Payer',
        last_name: 'Customer',
        email: `${prefix}-payer@example.com`,
        default_bill_to_customer_id: billToCustomer.id,
      },
    });

    await tenantAPrisma.customer.delete({ where: { id: billToCustomer.id } });

    const updated = await tenantAPrisma.customer.findFirstOrThrow({
      where: { id: payerCustomer.id, tenant_id: tenantAId },
    });

    expect(updated.tenant_id).toBe(tenantAId);
    expect(updated.default_bill_to_customer_id).toBeNull();
  });

  it('clears labor price group when the referenced group is deleted', async () => {
    const tenantAPrisma = createTenantAwarePrisma(prisma, tenantAId);

    const priceGroup = await tenantAPrisma.laborPriceGroup.create({
      data: {
        tenant_id: tenantAId,
        code: `${prefix}-LPG`,
        name: 'Standard',
        hourly_rate: 120,
      },
    });

    const customer = await tenantAPrisma.customer.create({
      data: {
        tenant_id: tenantAId,
        first_name: 'Labor',
        last_name: 'Group',
        email: `${prefix}-lpg@example.com`,
        labor_price_group_id: priceGroup.id,
      },
    });

    await tenantAPrisma.laborPriceGroup.delete({ where: { id: priceGroup.id } });

    const updated = await tenantAPrisma.customer.findFirstOrThrow({
      where: { id: customer.id, tenant_id: tenantAId },
    });

    expect(updated.tenant_id).toBe(tenantAId);
    expect(updated.labor_price_group_id).toBeNull();
  });
});
