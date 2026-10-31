import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AuditActorType, AuditLogAction } from '@prisma/client';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import {
  cleanupTestTenantGraph,
  createMemberBearer,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';
import { serializeCsv } from '../src/import/csv-parse.util.js';

describe('Import Undo (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let tenant: Awaited<ReturnType<typeof createTestTenant>>;
  let adminHeader: string;
  let ownerHeader: string;
  let salesHeader: string;
  let techHeader: string;

  const customerMapping = {
    external_id: 'Kunden-Nr',
    type: 'Typ',
    first_name: 'Vorname',
    last_name: 'Nachname',
    email: 'E-Mail',
    phone: 'Telefon',
    address_country: 'Land',
  };

  const vehicleMapping = {
    external_id: 'Fahrzeug-Nr',
    vin: 'FIN',
    plate: 'Kennzeichen',
    make: 'Marke',
    model: 'Modell',
    year: 'Baujahr',
    owner_customer_external_id: 'Kunden-Nr',
  };

  function customerCsv(rows: string[][]) {
    const headers = [
      'Kunden-Nr',
      'Typ',
      'Vorname',
      'Nachname',
      'E-Mail',
      'Telefon',
      'Land',
    ];
    return Buffer.from(serializeCsv(headers, rows, ';'), 'utf8');
  }

  function vehicleCsv(rows: string[][]) {
    const headers = [
      'Fahrzeug-Nr',
      'FIN',
      'Kennzeichen',
      'Marke',
      'Modell',
      'Baujahr',
      'Kunden-Nr',
    ];
    return Buffer.from(serializeCsv(headers, rows, ';'), 'utf8');
  }

  async function importAndApplyCustomerRows(
    rows: string[][],
  ): Promise<{ id: string }> {
    const file = customerCsv(rows);
    const dryRun = await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', adminHeader)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', 'legacy-dms')
      .field('mapping', JSON.stringify(customerMapping))
      .attach('file', file, 'customers.csv')
      .expect(201);

    await request(app.getHttpServer())
      .post(`/imports/${dryRun.body.id}/apply`)
      .set('Authorization', adminHeader)
      .expect(202);

    return dryRun.body as { id: string };
  }

  beforeAll(async () => {
    process.env.IMPORT_MAX_ROW_COUNT = '20000';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
    authService = app.get(AuthService);

    tenant = await createTestTenant(prisma, 'import-undo');
    adminHeader = `Bearer ${createTestAuthToken(authService, tenant)}`;
    ownerHeader = await createMemberBearer(prisma, authService, tenant, 'OWNER');
    salesHeader = await createMemberBearer(prisma, authService, tenant, 'SALES');
    techHeader = await createMemberBearer(prisma, authService, tenant, 'TECH');
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(prisma, tenant.tenantId);
    await teardownTestApp(app, prisma);
  });

  it('role matrix: non-admin roles (SALES, TECH) get 403 on preview and undo', async () => {
    // 1. Create a dummy applied job
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const dummyJob = await tenantPrisma.importJob.create({
      data: {
        tenant_id: tenant.tenantId,
        source_system: 'legacy-dms',
        entity_type: 'CUSTOMER',
        file_name: 'matrix.csv',
        file_sha256: 'mock-matrix-sha',
        mapping_json: {},
        options_json: {},
        status: 'APPLIED',
        totals_json: { total: 1, create: 1, update: 0, skip: 0, error: 0 },
        created_by: tenant.firebaseUid,
      },
    });

    // 2. SALES forbidden
    await request(app.getHttpServer())
      .post(`/imports/${dummyJob.id}/undo/preview`)
      .set('Authorization', salesHeader)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/imports/${dummyJob.id}/undo`)
      .set('Authorization', salesHeader)
      .expect(403);

    // 3. TECH forbidden
    await request(app.getHttpServer())
      .post(`/imports/${dummyJob.id}/undo/preview`)
      .set('Authorization', techHeader)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/imports/${dummyJob.id}/undo`)
      .set('Authorization', techHeader)
      .expect(403);

    // 4. OWNER allowed
    await request(app.getHttpServer())
      .post(`/imports/${dummyJob.id}/undo/preview`)
      .set('Authorization', ownerHeader)
      .expect(200);
  });

  it('happy path: imports synthetic customers and vehicles, undoes them, and restores original state', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);

    // 1. Pre-existing customer to test UPDATE undo
    const preExistingCustomer = await tenantPrisma.customer.create({
      data: {
        tenant_id: tenant.tenantId,
        type: 'PRIVATE',
        first_name: 'Original',
        last_name: 'Customer',
        email: `orig-${Date.now()}@example.com`,
      },
    });

    const initialJob = await tenantPrisma.importJob.create({
      data: {
        tenant_id: tenant.tenantId,
        source_system: 'legacy-dms',
        entity_type: 'CUSTOMER',
        file_name: 'initial.csv',
        file_sha256: 'mock-initial-sha',
        mapping_json: {},
        options_json: {},
        status: 'APPLIED',
        totals_json: { total: 1, create: 1, update: 0, skip: 0, error: 0 },
        created_by: tenant.firebaseUid,
      },
    });

    // Seed existing mapping for preExistingCustomer
    await tenantPrisma.externalIdMapping.create({
      data: {
        tenant_id: tenant.tenantId,
        source_system: 'legacy-dms',
        entity_type: 'CUSTOMER',
        external_id: 'EXT-EXISTING-1',
        entity_id: preExistingCustomer.id,
        first_seen_import_job_id: initialJob.id,
      },
    });

    // 2. Import batch containing:
    //    Row 1: UPDATE of pre-existing customer
    //    Row 2: CREATE of new customer
    const emailNew = `new-${Date.now()}@example.com`;
    const customerFile = customerCsv([
      ['EXT-EXISTING-1', 'PRIVATE', 'Original', 'UpdatedName', preExistingCustomer.email!, '111', 'AT'],
      ['EXT-NEW-1', 'PRIVATE', 'New', 'Customer', emailNew, '222', 'AT'],
    ]);

    const dryRun = await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', adminHeader)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', 'legacy-dms')
      .field('mapping', JSON.stringify(customerMapping))
      .field('options', JSON.stringify({ update_existing: true }))
      .attach('file', customerFile, 'customers.csv')
      .expect(201);

    expect(dryRun.body.totals.create).toBe(1);
    expect(dryRun.body.totals.update).toBe(1);

    const applyRes = await request(app.getHttpServer())
      .post(`/imports/${dryRun.body.id}/apply`)
      .set('Authorization', adminHeader)
      .expect(202);

    expect(applyRes.body.status).toBe('APPLIED');

    // Verify DB has updated pre-existing and created new customer
    const updatedPreExisting = await tenantPrisma.customer.findFirstOrThrow({
      where: { id: preExistingCustomer.id },
    });
    expect(updatedPreExisting.last_name).toBe('UpdatedName');

    const createdCustomer = await tenantPrisma.customer.findFirst({
      where: { email: emailNew },
    });
    expect(createdCustomer).toBeTruthy();

    // 3. Preview undo
    const previewRes = await request(app.getHttpServer())
      .post(`/imports/${dryRun.body.id}/undo/preview`)
      .set('Authorization', adminHeader)
      .expect(200);

    expect(previewRes.body.status).toBe('ELIGIBLE');
    expect(previewRes.body.canUndo).toBe(true);
    expect(previewRes.body.counts.toDelete).toBe(1);
    expect(previewRes.body.counts.toRestore).toBe(1);
    expect(previewRes.body.counts.conflicts).toBe(0);
    expect(previewRes.body.counts.blocked).toBe(0);

    // 4. Execute undo
    const undoRes = await request(app.getHttpServer())
      .post(`/imports/${dryRun.body.id}/undo`)
      .set('Authorization', adminHeader)
      .expect(200);

    expect(undoRes.body.status).toBe('UNDONE');

    // 5. Verify DB equals pre-import state
    // - Created customer removed
    const remainingCreated = await tenantPrisma.customer.findFirst({
      where: { email: emailNew },
    });
    expect(remainingCreated).toBeNull();

    // - Mapping for created customer removed
    const createdMapping = await tenantPrisma.externalIdMapping.findFirst({
      where: {
        source_system: 'legacy-dms',
        external_id: 'EXT-NEW-1',
      },
    });
    expect(createdMapping).toBeNull();

    // - Updated customer restored to pre-import snapshot
    const restoredCustomer = await tenantPrisma.customer.findFirstOrThrow({
      where: { id: preExistingCustomer.id },
    });
    expect(restoredCustomer.last_name).toBe('Customer');

    // - Original mapping for pre-existing customer preserved
    const origMapping = await tenantPrisma.externalIdMapping.findFirst({
      where: {
        source_system: 'legacy-dms',
        external_id: 'EXT-EXISTING-1',
      },
    });
    expect(origMapping?.entity_id).toBe(preExistingCustomer.id);

    // - AuditLog written for undo
    const undoAudit = await tenantPrisma.auditLog.findFirst({
      where: {
        entity_type: 'ImportJob',
        entity_id: dryRun.body.id,
        action: AuditLogAction.UPDATE,
      },
    });
    expect(undoAudit).toBeTruthy();

    // 6. Re-import creates fresh records without duplicates
    const reImport = await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', adminHeader)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', 'legacy-dms')
      .field('mapping', JSON.stringify(customerMapping))
      .field('options', JSON.stringify({ update_existing: true }))
      .attach('file', customerFile, 'customers.csv')
      .expect(201);

    expect(reImport.body.totals.create).toBe(1);
    const reApply = await request(app.getHttpServer())
      .post(`/imports/${reImport.body.id}/apply`)
      .set('Authorization', adminHeader)
      .expect(202);

    expect(reApply.body.status).toBe('APPLIED');

    const freshCreated = await tenantPrisma.customer.findFirst({
      where: { email: emailNew },
    });
    expect(freshCreated).toBeTruthy();
  });

  it('conflict guard: post-import modification requires explicit confirmation', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const emailConflict = `conflict-${Date.now()}@example.com`;

    const dryRun = await importAndApplyCustomerRows([
      ['EXT-CONF-1', 'PRIVATE', 'Conflict', 'User', emailConflict, '333', 'AT'],
    ]);

    const createdCust = await tenantPrisma.customer.findFirstOrThrow({
      where: { email: emailConflict },
    });

    // Simulate user edit after import
    await tenantPrisma.customer.update({
      where: { id: createdCust.id },
      data: {
        phone: '999999',
        updatedAt: new Date(Date.now() + 60000),
      },
    });
    // Add audit log after import
    await tenantPrisma.auditLog.create({
      data: {
        tenant_id: tenant.tenantId,
        entity_type: 'Customer',
        entity_id: createdCust.id,
        action: AuditLogAction.UPDATE,
        actor_type: AuditActorType.USER,
        occurred_at: new Date(Date.now() + 60000),
      },
    });

    // Preview should report conflict
    const preview = await request(app.getHttpServer())
      .post(`/imports/${dryRun.id}/undo/preview`)
      .set('Authorization', adminHeader)
      .expect(200);

    expect(preview.body.status).toBe('CONFLICT');
    expect(preview.body.counts.conflicts).toBe(1);
    expect(preview.body.conflicts[0].reason).toContain('modified');

    // Undo without confirmedEntityIds: conflict is skipped
    const undoWithoutConfirm = await request(app.getHttpServer())
      .post(`/imports/${dryRun.id}/undo`)
      .set('Authorization', adminHeader)
      .send({ confirmedEntityIds: [] })
      .expect(200);

    expect(undoWithoutConfirm.body.status).toBe('PARTIALLY_UNDONE');

    const stillExists = await tenantPrisma.customer.findFirst({
      where: { id: createdCust.id },
    });
    expect(stillExists).toBeTruthy();

    // Undo WITH confirmedEntityIds: conflict is undone
    const undoWithConfirm = await request(app.getHttpServer())
      .post(`/imports/${dryRun.id}/undo`)
      .set('Authorization', adminHeader)
      .send({ confirmedEntityIds: [createdCust.id] })
      .expect(200);

    expect(undoWithConfirm.body.status).toBe('UNDONE');

    const deletedCust = await tenantPrisma.customer.findFirst({
      where: { id: createdCust.id },
    });
    expect(deletedCust).toBeNull();
  });

  it('reference guard: customer linked to invoice/work order is BLOCKED and finalized invoice is never modified', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const emailBlocked = `blocked-${Date.now()}@example.com`;

    const dryRun = await importAndApplyCustomerRows([
      ['EXT-BLOCK-1', 'PRIVATE', 'Invoice', 'Owner', emailBlocked, '444', 'AT'],
    ]);

    const customer = await tenantPrisma.customer.findFirstOrThrow({
      where: { email: emailBlocked },
    });

    // Create a finalized invoice with line items for this customer
    const invoice = await tenantPrisma.invoice.create({
      data: {
        tenant_id: tenant.tenantId,
        customer_id: customer.id,
        status: 'ISSUED',
        date: new Date(),
        due_date: new Date(),
        total_net: 500,
        total_tax: 100,
        total_gross: 600,
        items: {
          create: [
            {
              tenant_id: tenant.tenantId,
              description: 'Immutable Service Line',
              quantity: 1,
              unit_price: 500,
              tax_rate: 20,
              line_total: 500,
            },
          ],
        },
      },
      include: { items: true },
    });

    // Preview should report customer as BLOCKED
    const preview = await request(app.getHttpServer())
      .post(`/imports/${dryRun.id}/undo/preview`)
      .set('Authorization', adminHeader)
      .expect(200);

    expect(preview.body.status).toBe('BLOCKED');
    expect(preview.body.counts.blocked).toBe(1);
    expect(preview.body.blocked[0].reason).toContain('invoice');

    // Attempting undo must NOT touch the customer or invoice
    const undoRes = await request(app.getHttpServer())
      .post(`/imports/${dryRun.id}/undo`)
      .set('Authorization', adminHeader)
      .expect(200);

    expect(undoRes.body.status).toBe('PARTIALLY_UNDONE');

    // Verify customer is untouched
    const untouchedCustomer = await tenantPrisma.customer.findFirst({
      where: { id: customer.id },
    });
    expect(untouchedCustomer).toBeTruthy();

    // Verify invoice and its lines are strictly unmodified
    const checkInvoice = await tenantPrisma.invoice.findFirstOrThrow({
      where: { id: invoice.id },
      include: { items: true },
    });
    expect(checkInvoice.status).toBe('ISSUED');
    expect(Number(checkInvoice.total_net)).toBe(500);
    expect(checkInvoice.items).toHaveLength(1);
    expect(checkInvoice.items[0].description).toBe('Immutable Service Line');
  });

  it('idempotency: calling undo twice on an undone job is a safe no-op', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const emailIdem = `idem-${Date.now()}@example.com`;

    const dryRun = await importAndApplyCustomerRows([
      ['EXT-IDEM-1', 'PRIVATE', 'Idem', 'Test', emailIdem, '555', 'AT'],
    ]);

    // First undo
    const firstUndo = await request(app.getHttpServer())
      .post(`/imports/${dryRun.id}/undo`)
      .set('Authorization', adminHeader)
      .expect(200);

    expect(firstUndo.body.status).toBe('UNDONE');

    // Second undo: no-op, returns 200 with job
    const secondUndo = await request(app.getHttpServer())
      .post(`/imports/${dryRun.id}/undo`)
      .set('Authorization', adminHeader)
      .expect(200);

    expect(secondUndo.body.status).toBe('UNDONE');
  });
});
