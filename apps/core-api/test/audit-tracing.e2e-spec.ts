import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { LogLevelService } from '../src/common/logging/log-level.service';
import {
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  cleanupTestTenantGraph,
} from './tenant-test-utils';
import { teardownTestApp } from './test-lifecycle';
import { AuditLogAction } from '@prisma/client';

describe('Audit Tracing and Governance (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let logLevelService: LogLevelService;

  let tenantA: string;
  let tenantB: string;
  let authHeaderA: string;
  let authHeaderB: string;
  let prismaA: PrismaService;
  let prismaB: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    authService = app.get<AuthService>(AuthService);
    logLevelService = app.get<LogLevelService>(LogLevelService);

    const tenantResA = await createTestTenant(prisma, 'audit-tenant-a');
    const tenantResB = await createTestTenant(prisma, 'audit-tenant-b');

    tenantA = tenantResA.tenantId;
    tenantB = tenantResB.tenantId;

    prismaA = createTenantAwarePrisma(prisma, tenantA);
    prismaB = createTenantAwarePrisma(prisma, tenantB);

    authHeaderA = `Bearer ${createTestAuthToken(authService, tenantResA)}`;
    authHeaderB = `Bearer ${createTestAuthToken(authService, tenantResB)}`;
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(prisma, tenantA);
    await cleanupTestTenantGraph(prisma, tenantB);
    await teardownTestApp(app, prisma);
  });

  it('1. Updating a tenant master record creates one AuditLog row with before/after/diff snapshots', async () => {
    // 1. Create a customer in tenant A
    const createRes = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', authHeaderA)
      .send({
        first_name: 'InitialFirst',
        last_name: 'InitialLast',
        email: `audit-test-${Date.now()}@example.com`,
      })
      .expect(201);

    const customerId = createRes.body.id;
    expect(customerId).toBeDefined();

    // 2. Update the customer
    const updateRes = await request(app.getHttpServer())
      .patch(`/customers/${customerId}`)
      .set('Authorization', authHeaderA)
      .send({
        first_name: 'UpdatedFirst',
      })
      .expect(200);

    expect(updateRes.body.first_name).toBe('UpdatedFirst');

    // 3. Inspect audit log via prisma directly in tenant A
    const auditLogs = await prismaA.auditLog.findMany({
      where: {
        entity_type: 'Customer',
        entity_id: customerId,
        action: AuditLogAction.UPDATE,
      },
    });

    expect(auditLogs).toHaveLength(1);
    const log = auditLogs[0];
    expect(log.tenant_id).toBe(tenantA);
    expect(log.action).toBe(AuditLogAction.UPDATE);
    expect((log.before as Record<string, unknown>)?.first_name).toBe('InitialFirst');
    expect((log.after as Record<string, unknown>)?.first_name).toBe('UpdatedFirst');
    expect(log.changed_fields).toContain('first_name');
  });

  it('2. Deleting a policy-allowed entity creates an AuditLog row with before snapshot and after = null', async () => {
    // 1. Create a customer to be deleted
    const customer = await prismaA.customer.create({
      data: {
        first_name: 'DeleteMe',
        last_name: 'Testing',
        email: `deleteme-${Date.now()}@example.com`,
      },
    });

    // 2. Delete the customer
    await request(app.getHttpServer())
      .delete(`/customers/${customer.id}`)
      .set('Authorization', authHeaderA)
      .expect(200);

    // 3. Verify delete audit log entry
    const deleteAuditLogs = await prismaA.auditLog.findMany({
      where: {
        entity_type: 'Customer',
        entity_id: customer.id,
        action: AuditLogAction.DELETE,
      },
    });

    expect(deleteAuditLogs).toHaveLength(1);
    const deleteLog = deleteAuditLogs[0];
    expect(deleteLog.tenant_id).toBe(tenantA);
    expect(deleteLog.action).toBe(AuditLogAction.DELETE);
    expect((deleteLog.before as Record<string, unknown>)?.first_name).toBe('DeleteMe');
    expect(deleteLog.after).toBeNull();
  });

  it('3. Cross-tenant user cannot see another tenant audit logs via GET /api/audit-logs', async () => {
    // Tenant A creates an update
    const customerA = await prismaA.customer.create({
      data: {
        first_name: 'TenantACustomer',
        last_name: 'Owner',
        email: `tenanta-${Date.now()}@example.com`,
      },
    });

    await prismaA.customer.update({
      where: { id: customerA.id },
      data: { first_name: 'TenantACustomerUpdated' },
    });

    // Tenant B queries audit logs
    const resB = await request(app.getHttpServer())
      .get('/audit-logs')
      .set('Authorization', authHeaderB)
      .expect(200);

    expect(resB.body.data).toBeDefined();
    const tenantBIds = resB.body.data.map((item: { entityId: string }) => item.entityId);
    expect(tenantBIds).not.toContain(customerA.id);

    // Tenant A queries audit logs
    const resA = await request(app.getHttpServer())
      .get('/audit-logs')
      .set('Authorization', authHeaderA)
      .expect(200);

    expect(resA.body.data).toBeDefined();
    const tenantAIds = resA.body.data.map((item: { entityId: string }) => item.entityId);
    expect(tenantAIds).toContain(customerA.id);
  });

  it('4. Audit capture coexists with InventoryTransaction ledger operations', async () => {
    // 1. Create a catalog item and storage location
    const item = await prismaA.catalogItem.create({
      data: {
        sku: `AUDIT-INV-${Date.now()}`,
        name: 'Audit Inventory Part',
        cost_price: 25,
        retail_price: 50,
      },
    });

    const location = await prismaA.storageLocation.create({
      data: {
        name: 'Main Shelf',
        code: `LOC-${Date.now()}`,
        type: 'warehouse',
      },
    });

    // 2. Perform an inventory transaction
    const initialTx = await prismaA.inventoryTransaction.create({
      data: {
        item_id: item.id,
        location_id: location.id,
        quantity: 10,
        type: 'INITIAL_BALANCE',
      },
    });

    expect(initialTx.id).toBeDefined();

    // 3. Update the catalog item name
    await prismaA.catalogItem.update({
      where: { id: item.id },
      data: { name: 'Audit Inventory Part Renamed' },
    });

    // 4. Verify both InventoryTransaction and AuditLog exist independently
    const transactions = await prismaA.inventoryTransaction.findMany({
      where: { item_id: item.id },
    });
    expect(transactions).toHaveLength(1);
    expect(Number(transactions[0].quantity)).toBe(10);

    const itemAuditLogs = await prismaA.auditLog.findMany({
      where: {
        entity_type: 'CatalogItem',
        entity_id: item.id,
        action: AuditLogAction.UPDATE,
      },
    });
    expect(itemAuditLogs).toHaveLength(1);
    expect(itemAuditLogs[0].changed_fields).toContain('name');
  });

  it('5. Batch updateMany creates individual audit records per mutated row', async () => {
    const uniqueSuffix = Date.now().toString();
    const c1 = await prismaA.customer.create({
      data: {
        first_name: `Batch1_${uniqueSuffix}`,
        last_name: 'BatchTest',
        email: `batch1-${uniqueSuffix}@example.com`,
      },
    });
    const c2 = await prismaA.customer.create({
      data: {
        first_name: `Batch2_${uniqueSuffix}`,
        last_name: 'BatchTest',
        email: `batch2-${uniqueSuffix}@example.com`,
      },
    });

    const updateBatch = await prismaA.customer.updateMany({
      where: {
        id: { in: [c1.id, c2.id] },
        last_name: 'BatchTest',
      },
      data: {
        last_name: 'BatchTestUpdated',
      },
    });

    expect(updateBatch.count).toBe(2);

    const c1Logs = await prismaA.auditLog.findMany({
      where: { entity_type: 'Customer', entity_id: c1.id, action: AuditLogAction.UPDATE },
    });
    const c2Logs = await prismaA.auditLog.findMany({
      where: { entity_type: 'Customer', entity_id: c2.id, action: AuditLogAction.UPDATE },
    });

    expect(c1Logs.length).toBeGreaterThanOrEqual(1);
    expect(c2Logs.length).toBeGreaterThanOrEqual(1);
    expect(c1Logs[0].changed_fields).toContain('last_name');
    expect(c2Logs[0].changed_fields).toContain('last_name');
  });

  it('6. Audit capture remains active regardless of operational LOG_LEVEL changes', async () => {
    // 1. Temporarily change operational log level to warn
    logLevelService.setLogLevel({
      level: 'warn',
      durationMinutes: 10,
      actorId: 'system',
    });

    // 2. Perform a mutation
    const customer = await prismaA.customer.create({
      data: {
        first_name: 'LogLevelCustomer',
        last_name: 'Test',
        email: `loglevel-${Date.now()}@example.com`,
      },
    });

    await prismaA.customer.update({
      where: { id: customer.id },
      data: { first_name: 'LogLevelCustomerModified' },
    });

    // 3. Verify audit log was recorded even when operational logging is in warn mode
    const logs = await prismaA.auditLog.findMany({
      where: { entity_type: 'Customer', entity_id: customer.id, action: AuditLogAction.UPDATE },
    });

    expect(logs).toHaveLength(1);
    expect((logs[0].after as Record<string, unknown>)?.first_name).toBe('LogLevelCustomerModified');

    // Revert log level
    logLevelService.resetLogLevel();
  });
});

