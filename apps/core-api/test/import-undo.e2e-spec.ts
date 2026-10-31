import { randomBytes } from 'node:crypto';

// Set environment variables before any module imports
process.env.API_KEY_PEPPER = Buffer.alloc(32, 1).toString('base64');
process.env.IMPORT_MAX_ROW_COUNT = '20000';

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import {
  AuditActorType,
  AuditLogAction,
  ImportJobStatus,
} from '@prisma/client';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SystemPrismaService } from '../src/prisma/system-prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import {
  cleanupTestTenantGraph,
  createMemberBearer,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';
import { serializeCsv } from '../src/import/csv-parse.util.js';
import { UNDO_BLOCKED_REASONS } from '../src/import/import-undo.types.js';

describe('Import Undo (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let systemPrisma: SystemPrismaService;
  let authService: AuthService;
  let tenant: Awaited<ReturnType<typeof createTestTenant>>;
  let siteId: string;
  let adminHeader: string;
  let ownerHeader: string;
  let salesHeader: string;
  let techHeader: string;
  let demoHeader: string;
  let apiKeyHeader: string;

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

  async function importAndApplyRows(params: {
    entityType: string;
    file: Buffer;
    fileName: string;
    mapping: object;
    options?: object;
  }): Promise<{
    id: string;
    totals: { total: number; create: number; update: number };
  }> {
    const dryRun = await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', adminHeader)
      .field('entityType', params.entityType)
      .field('sourceSystem', 'legacy-dms')
      .field('mapping', JSON.stringify(params.mapping))
      .field(
        'options',
        JSON.stringify(params.options ?? { update_existing: true }),
      )
      .attach('file', params.file, params.fileName)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/imports/${dryRun.body.id}/apply`)
      .set('Authorization', adminHeader)
      .expect(202);

    return dryRun.body as {
      id: string;
      totals: { total: number; create: number; update: number };
    };
  }

  function importCustomerBatch(
    rows: string[][],
    options = { update_existing: true },
  ) {
    return importAndApplyRows({
      entityType: 'CUSTOMER',
      file: customerCsv(rows),
      fileName: 'customers.csv',
      mapping: customerMapping,
      options,
    });
  }

  function importVehicleBatch(
    rows: string[][],
    options = { update_existing: true },
  ) {
    return importAndApplyRows({
      entityType: 'VEHICLE',
      file: vehicleCsv(rows),
      fileName: 'vehicles.csv',
      mapping: vehicleMapping,
      options,
    });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
    systemPrisma = app.get(SystemPrismaService);
    authService = app.get(AuthService);

    tenant = await createTestTenant(prisma, 'import-undo');
    siteId = await resolveTestMainSiteId(prisma, tenant.tenantId);
    adminHeader = `Bearer ${createTestAuthToken(authService, tenant)}`;
    ownerHeader = await createMemberBearer(
      prisma,
      authService,
      tenant,
      'OWNER',
    );
    salesHeader = await createMemberBearer(
      prisma,
      authService,
      tenant,
      'SALES',
    );
    techHeader = await createMemberBearer(prisma, authService, tenant, 'TECH');
    demoHeader = await createMemberBearer(prisma, authService, tenant, 'DEMO');

    // Grant DEMO session so it passes authentication and hits authorization role check
    const demoUser = await systemPrisma.user.findFirstOrThrow({
      where: { firebaseUid: `e2e-demo-${tenant.tenantId}` },
      select: { id: true },
    });
    const demoAccessRequest =
      await systemPrisma.landingDemoAccessRequest.create({
        data: {
          email: `demo-${tenant.tenantId}@example.com`,
          name: 'Demo E2E',
          betrieb: 'E2E',
          consent_recorded_at: new Date(),
        },
      });
    await systemPrisma.landingDemoSignInGrant.create({
      data: {
        access_request_id: demoAccessRequest.id,
        user_id: demoUser.id,
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    // Create an API key for API key role matrix testing
    const apiKeyRes = await request(app.getHttpServer())
      .post('/tenant-api-keys')
      .set('Authorization', adminHeader)
      .send({ name: 'Import Undo Matrix Key', scopes: ['customers:read'] })
      .expect(201);
    apiKeyHeader = `Bearer ${apiKeyRes.body.token}`;
  });

  afterAll(async () => {
    await systemPrisma.landingDemoSignInGrant.deleteMany({
      where: { user: { firebaseUid: `e2e-demo-${tenant.tenantId}` } },
    });
    await systemPrisma.landingDemoAccessRequest.deleteMany({
      where: { email: `demo-${tenant.tenantId}@example.com` },
    });
    await cleanupTestTenantGraph(prisma, tenant.tenantId);
    await teardownTestApp(app, prisma);
  });

  it('role matrix: non-admin roles (SALES, TECH, DEMO) and API keys get 403 on preview and undo; OWNER and ADMIN get 200', async () => {
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

    // 1. SALES forbidden
    await request(app.getHttpServer())
      .post(`/imports/${dummyJob.id}/undo/preview`)
      .set('Authorization', salesHeader)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/imports/${dummyJob.id}/undo`)
      .set('Authorization', salesHeader)
      .expect(403);

    // 2. TECH forbidden
    await request(app.getHttpServer())
      .post(`/imports/${dummyJob.id}/undo/preview`)
      .set('Authorization', techHeader)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/imports/${dummyJob.id}/undo`)
      .set('Authorization', techHeader)
      .expect(403);

    // 3. DEMO forbidden
    await request(app.getHttpServer())
      .post(`/imports/${dummyJob.id}/undo/preview`)
      .set('Authorization', demoHeader)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/imports/${dummyJob.id}/undo`)
      .set('Authorization', demoHeader)
      .expect(403);

    // 4. API Key forbidden
    await request(app.getHttpServer())
      .post(`/imports/${dummyJob.id}/undo/preview`)
      .set('Authorization', apiKeyHeader)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/imports/${dummyJob.id}/undo`)
      .set('Authorization', apiKeyHeader)
      .expect(403);

    // 5. OWNER allowed
    await request(app.getHttpServer())
      .post(`/imports/${dummyJob.id}/undo/preview`)
      .set('Authorization', ownerHeader)
      .expect(200);

    // 6. ADMIN allowed
    await request(app.getHttpServer())
      .post(`/imports/${dummyJob.id}/undo/preview`)
      .set('Authorization', adminHeader)
      .expect(200);
  });

  it('customer acceptance: imports synthetic customers (CREATE & UPDATE), undoes them, and restores original state with audit logs', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);

    // 1. Pre-existing customer to test UPDATE undo
    const preExistingCustomer = await tenantPrisma.customer.create({
      data: {
        tenant_id: tenant.tenantId,
        type: 'PRIVATE',
        first_name: 'Original',
        last_name: 'Customer',
        email: `orig-${Date.now()}@example.com`,
        phone: '+43 1 234567',
        phone_digits: '01234567',
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
    const dryRun = await importCustomerBatch([
      [
        'EXT-EXISTING-1',
        'PRIVATE',
        'Original',
        'UpdatedName',
        preExistingCustomer.email!,
        '+43 664 999999',
        'AT',
      ],
      [
        'EXT-NEW-1',
        'PRIVATE',
        'New',
        'Customer',
        emailNew,
        '+43 1 111111',
        'AT',
      ],
    ]);

    expect(dryRun.totals.create).toBe(1);
    expect(dryRun.totals.update).toBe(1);

    // Verify DB has updated pre-existing and created new customer
    const updatedPreExisting = await tenantPrisma.customer.findFirstOrThrow({
      where: { id: preExistingCustomer.id },
    });
    expect(updatedPreExisting.last_name).toBe('UpdatedName');
    expect(updatedPreExisting.phone_digits).toBe('0664999999');

    const createdCustomer = await tenantPrisma.customer.findFirst({
      where: { email: emailNew },
    });
    expect(createdCustomer).toBeTruthy();

    // 3. Preview undo
    const previewRes = await request(app.getHttpServer())
      .post(`/imports/${dryRun.id}/undo/preview`)
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
      .post(`/imports/${dryRun.id}/undo`)
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

    // - Updated customer restored to pre-import snapshot (including phone_digits)
    const restoredCustomer = await tenantPrisma.customer.findFirstOrThrow({
      where: { id: preExistingCustomer.id },
    });
    expect(restoredCustomer.last_name).toBe('Customer');
    expect(restoredCustomer.phone_digits).toBe('01234567');

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
        entity_id: dryRun.id,
        action: AuditLogAction.UPDATE,
      },
    });
    expect(undoAudit).toBeTruthy();

    // 6. Re-import creates fresh records without duplicates
    const reImport = await importCustomerBatch([
      [
        'EXT-EXISTING-1',
        'PRIVATE',
        'Original',
        'UpdatedName',
        preExistingCustomer.email!,
        '+43 664 999999',
        'AT',
      ],
      [
        'EXT-NEW-1',
        'PRIVATE',
        'New',
        'Customer',
        emailNew,
        '+43 1 111111',
        'AT',
      ],
    ]);
    expect(reImport.totals.create).toBe(1);

    const freshCreated = await tenantPrisma.customer.findFirst({
      where: { email: emailNew },
    });
    expect(freshCreated).toBeTruthy();
  });

  it('vehicle acceptance: imports synthetic vehicles (CREATE & UPDATE), undoes them, removes external mappings and restores original state', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);

    // 1. Pre-existing vehicle for UPDATE undo
    const preExistingVehicle = await tenantPrisma.vehicle.create({
      data: {
        tenant_id: tenant.tenantId,
        vin: '1HGCR2F83HA000001',
        plate: 'W-ORIGINAL-1',
        make: 'Honda',
        model: 'Accord',
        year: 2017,
      },
    });

    const initialVehJob = await tenantPrisma.importJob.create({
      data: {
        tenant_id: tenant.tenantId,
        source_system: 'legacy-dms',
        entity_type: 'VEHICLE',
        file_name: 'initial-veh.csv',
        file_sha256: 'mock-initial-veh-sha',
        mapping_json: {},
        options_json: {},
        status: 'APPLIED',
        totals_json: { total: 1, create: 1, update: 0, skip: 0, error: 0 },
        created_by: tenant.firebaseUid,
      },
    });

    await tenantPrisma.externalIdMapping.create({
      data: {
        tenant_id: tenant.tenantId,
        source_system: 'legacy-dms',
        entity_type: 'VEHICLE',
        external_id: 'VEH-EXT-EXISTING',
        entity_id: preExistingVehicle.id,
        first_seen_import_job_id: initialVehJob.id,
      },
    });

    // 2. Import vehicles: 1 UPDATE + 1 CREATE (without owner so no initial vehicleParty is created)
    const newVin = '1HGCR2F83HA000002';
    const dryRun = await importVehicleBatch([
      [
        'VEH-EXT-EXISTING',
        '1HGCR2F83HA000001',
        'W-UPDATED-1',
        'Honda',
        'Accord',
        '2017',
        '',
      ],
      ['VEH-EXT-NEW', newVin, 'W-NEW-2', 'Honda', 'Civic', '2021', ''],
    ]);

    expect(dryRun.totals.create).toBe(1);
    expect(dryRun.totals.update).toBe(1);

    // Verify DB updated and created
    const updatedVeh = await tenantPrisma.vehicle.findFirstOrThrow({
      where: { id: preExistingVehicle.id },
    });
    expect(updatedVeh.plate).toBe('WUPDATED1');

    const createdVeh = await tenantPrisma.vehicle.findFirstOrThrow({
      where: { vin: newVin },
    });
    expect(createdVeh.plate).toBe('WNEW2');

    // 3. Preview undo
    const previewRes = await request(app.getHttpServer())
      .post(`/imports/${dryRun.id}/undo/preview`)
      .set('Authorization', adminHeader)
      .expect(200);

    expect(previewRes.body.status).toBe('ELIGIBLE');
    expect(previewRes.body.canUndo).toBe(true);
    expect(previewRes.body.counts.toDelete).toBe(1);
    expect(previewRes.body.counts.toRestore).toBe(1);

    // 4. Execute undo
    const undoRes = await request(app.getHttpServer())
      .post(`/imports/${dryRun.id}/undo`)
      .set('Authorization', adminHeader)
      .expect(200);

    expect(undoRes.body.status).toBe('UNDONE');

    // 5. Verify DB state restored
    const remainingNewVeh = await tenantPrisma.vehicle.findFirst({
      where: { vin: newVin },
    });
    expect(remainingNewVeh).toBeNull();

    const newVehMapping = await tenantPrisma.externalIdMapping.findFirst({
      where: { source_system: 'legacy-dms', external_id: 'VEH-EXT-NEW' },
    });
    expect(newVehMapping).toBeNull();

    const restoredVeh = await tenantPrisma.vehicle.findFirstOrThrow({
      where: { id: preExistingVehicle.id },
    });
    expect(restoredVeh.plate).toBe('W-ORIGINAL-1');

    const origVehMapping = await tenantPrisma.externalIdMapping.findFirst({
      where: { source_system: 'legacy-dms', external_id: 'VEH-EXT-EXISTING' },
    });
    expect(origVehMapping?.entity_id).toBe(preExistingVehicle.id);
  });

  it('downstream reference guards: blocks customer with active work order or consent, blocks vehicle with media or party', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);

    // 1. Import a customer and a vehicle
    const emailDownstream = `downstream-${Date.now()}@example.com`;
    const custJob = await importCustomerBatch([
      [
        'CUST-DS-1',
        'PRIVATE',
        'Downstream',
        'Customer',
        emailDownstream,
        '123',
        'AT',
      ],
    ]);
    const customer = await tenantPrisma.customer.findFirstOrThrow({
      where: { email: emailDownstream },
    });

    const vinDownstream = '1HGCR2F83HA000003';
    const vehJob = await importVehicleBatch([
      ['VEH-DS-1', vinDownstream, 'W-DS-1', 'Honda', 'Accord', '2019', ''],
    ]);
    const vehicle = await tenantPrisma.vehicle.findFirstOrThrow({
      where: { vin: vinDownstream },
    });

    // Case A: Link customer to active WorkshopOrder -> DOWNSTREAM_WORK_ORDER
    const workOrder = await tenantPrisma.workshopOrder.create({
      data: {
        tenant_id: tenant.tenantId,
        site_id: siteId,
        order_number: `WO-${Date.now()}`,
        customer_id: customer.id,
        vehicle_id: vehicle.id,
        status: 'IN_PROGRESS',
        odometer: 50000,
        fuel_level: 50,
      },
    });

    const custPreviewWO = await request(app.getHttpServer())
      .post(`/imports/${custJob.id}/undo/preview`)
      .set('Authorization', adminHeader)
      .expect(200);

    expect(custPreviewWO.body.status).toBe('BLOCKED');
    expect(custPreviewWO.body.counts.blocked).toBe(1);
    expect(custPreviewWO.body.blocked[0].reason).toBe(
      UNDO_BLOCKED_REASONS.DOWNSTREAM_WORK_ORDER,
    );

    // Case B: Link vehicle to active WorkshopOrder -> DOWNSTREAM_WORK_ORDER
    const vehPreviewWO = await request(app.getHttpServer())
      .post(`/imports/${vehJob.id}/undo/preview`)
      .set('Authorization', adminHeader)
      .expect(200);

    expect(vehPreviewWO.body.status).toBe('BLOCKED');
    expect(vehPreviewWO.body.counts.blocked).toBe(1);
    expect(vehPreviewWO.body.blocked[0].reason).toBe(
      UNDO_BLOCKED_REASONS.DOWNSTREAM_WORK_ORDER,
    );

    // Clean up work order
    await tenantPrisma.workshopOrder.delete({ where: { id: workOrder.id } });

    // Case C: Link vehicle to VehicleMedia -> DOWNSTREAM_VEHICLE_MEDIA
    const media = await tenantPrisma.vehicleMedia.create({
      data: {
        tenant_id: tenant.tenantId,
        vehicle_id: vehicle.id,
        site_id: siteId,
        storage_bucket: 'test-bucket',
        processed_storage_key: 'uploads/vehicle-test.jpg',
        variant_storage_keys: {},
        content_type: 'image/jpeg',
        width: 800,
        height: 600,
        content_sha256: 'a'.repeat(64),
      },
    });

    const vehPreviewMedia = await request(app.getHttpServer())
      .post(`/imports/${vehJob.id}/undo/preview`)
      .set('Authorization', adminHeader)
      .expect(200);

    expect(vehPreviewMedia.body.status).toBe('BLOCKED');
    expect(vehPreviewMedia.body.counts.blocked).toBe(1);
    expect(vehPreviewMedia.body.blocked[0].reason).toBe(
      UNDO_BLOCKED_REASONS.DOWNSTREAM_VEHICLE_MEDIA,
    );

    await tenantPrisma.vehicleMedia.delete({ where: { id: media.id } });

    // Case D: Link vehicle to VehicleParty -> DOWNSTREAM_VEHICLE_PARTY
    const party = await tenantPrisma.vehicleParty.create({
      data: {
        tenant_id: tenant.tenantId,
        vehicle_id: vehicle.id,
        customer_id: customer.id,
        role: 'OWNER',
      },
    });

    const vehPreviewParty = await request(app.getHttpServer())
      .post(`/imports/${vehJob.id}/undo/preview`)
      .set('Authorization', adminHeader)
      .expect(200);

    expect(vehPreviewParty.body.status).toBe('BLOCKED');
    expect(vehPreviewParty.body.counts.blocked).toBe(1);
    expect(vehPreviewParty.body.blocked[0].reason).toBe(
      UNDO_BLOCKED_REASONS.DOWNSTREAM_VEHICLE_PARTY,
    );

    await tenantPrisma.vehicleParty.delete({ where: { id: party.id } });

    // Case E: Link customer to CustomerConsent -> DOWNSTREAM_CUSTOMER_CONSENT
    const legalEntity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId },
    });
    const consent = await tenantPrisma.customerConsent.create({
      data: {
        tenant_id: tenant.tenantId,
        customer_id: customer.id,
        controller_legal_entity_id: legalEntity.id,
        channel: 'EMAIL',
        purpose: 'NEWSLETTER',
        status: 'GRANTED',
        source: 'PROFILE',
        sequence: 1,
        occurred_at: new Date(),
      },
    });

    const custPreviewConsent = await request(app.getHttpServer())
      .post(`/imports/${custJob.id}/undo/preview`)
      .set('Authorization', adminHeader)
      .expect(200);

    expect(custPreviewConsent.body.status).toBe('BLOCKED');
    expect(custPreviewConsent.body.counts.blocked).toBe(1);
    expect(custPreviewConsent.body.blocked[0].reason).toBe(
      UNDO_BLOCKED_REASONS.DOWNSTREAM_CUSTOMER_CONSENT,
    );

    // Attempting undo on custJob must leave customer in DB and return PARTIALLY_UNDONE
    const undoCust = await request(app.getHttpServer())
      .post(`/imports/${custJob.id}/undo`)
      .set('Authorization', adminHeader)
      .expect(200);

    expect(undoCust.body.status).toBe('PARTIALLY_UNDONE');

    const custStillExists = await tenantPrisma.customer.findFirst({
      where: { id: customer.id },
    });
    expect(custStillExists).toBeTruthy();

    await tenantPrisma.customerConsent.delete({ where: { id: consent.id } });
  });

  it('conflict guard: post-import modification requires explicit confirmation', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const emailConflict = `conflict-${Date.now()}@example.com`;

    const dryRun = await importCustomerBatch([
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

    // Preview should report conflict with stable code MODIFIED_SINCE_IMPORT
    const preview = await request(app.getHttpServer())
      .post(`/imports/${dryRun.id}/undo/preview`)
      .set('Authorization', adminHeader)
      .expect(200);

    expect(preview.body.status).toBe('CONFLICT');
    expect(preview.body.counts.conflicts).toBe(1);
    expect(preview.body.conflicts[0].reason).toBe(
      UNDO_BLOCKED_REASONS.MODIFIED_SINCE_IMPORT,
    );

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

  it('reference guard: customer linked to invoice is BLOCKED and finalized invoice is never modified', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const emailBlocked = `blocked-${Date.now()}@example.com`;

    const dryRun = await importCustomerBatch([
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

    // Preview should report customer as BLOCKED with DOWNSTREAM_INVOICE
    const preview = await request(app.getHttpServer())
      .post(`/imports/${dryRun.id}/undo/preview`)
      .set('Authorization', adminHeader)
      .expect(200);

    expect(preview.body.status).toBe('BLOCKED');
    expect(preview.body.counts.blocked).toBe(1);
    expect(preview.body.blocked[0].reason).toBe(
      UNDO_BLOCKED_REASONS.DOWNSTREAM_INVOICE,
    );

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

  it('race condition guard: rejects undo when job is currently UNDOING or APPLYING, or claimed concurrently', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);

    const raceJob = await tenantPrisma.importJob.create({
      data: {
        tenant_id: tenant.tenantId,
        source_system: 'legacy-dms',
        entity_type: 'CUSTOMER',
        file_name: 'race.csv',
        file_sha256: 'mock-race-sha',
        mapping_json: {},
        options_json: {},
        status: 'APPLIED',
        totals_json: { total: 1, create: 1, update: 0, skip: 0, error: 0 },
        created_by: tenant.firebaseUid,
      },
    });

    // Case 1: Job already in UNDOING status -> 409 Conflict
    await tenantPrisma.importJob.update({
      where: { id: raceJob.id },
      data: { status: 'UNDOING' },
    });

    await request(app.getHttpServer())
      .post(`/imports/${raceJob.id}/undo`)
      .set('Authorization', adminHeader)
      .expect(409);

    // Case 2: Job in APPLYING status -> 409 Conflict
    await tenantPrisma.importJob.update({
      where: { id: raceJob.id },
      data: { status: 'APPLYING' },
    });

    await request(app.getHttpServer())
      .post(`/imports/${raceJob.id}/undo`)
      .set('Authorization', adminHeader)
      .expect(409);

    // Reset status to APPLIED
    await tenantPrisma.importJob.update({
      where: { id: raceJob.id },
      data: { status: 'APPLIED' },
    });
  });

  it('partial undo idempotency: re-running undo on PARTIALLY_UNDONE job is idempotent, does not duplicate audits or inflate counts', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);

    // 1. Create 2 customers: 1 will be blocked by invoice, 1 will be eligible
    const emailEligible = `part-elig-${Date.now()}@example.com`;
    const emailBlocked = `part-block-${Date.now()}@example.com`;

    const job = await importCustomerBatch([
      [
        'EXT-PI-ELIG',
        'PRIVATE',
        'Eligible',
        'Cust',
        emailEligible,
        '111',
        'AT',
      ],
      ['EXT-PI-BLOCK', 'PRIVATE', 'Blocked', 'Cust', emailBlocked, '222', 'AT'],
    ]);

    const blockedCust = await tenantPrisma.customer.findFirstOrThrow({
      where: { email: emailBlocked },
    });

    // Link blocked customer to invoice
    await tenantPrisma.invoice.create({
      data: {
        tenant_id: tenant.tenantId,
        customer_id: blockedCust.id,
        status: 'ISSUED',
        date: new Date(),
        due_date: new Date(),
        total_net: 200,
        total_tax: 40,
        total_gross: 240,
      },
    });

    // First undo attempt
    const firstUndo = await request(app.getHttpServer())
      .post(`/imports/${job.id}/undo`)
      .set('Authorization', adminHeader)
      .expect(200);

    expect(firstUndo.body.status).toBe('PARTIALLY_UNDONE');

    // Eligible customer deleted
    const eligibleDeleted = await tenantPrisma.customer.findFirst({
      where: { email: emailEligible },
    });
    expect(eligibleDeleted).toBeNull();

    // Check row status: eligible row has undone_at populated
    const rowsAfterFirst = await tenantPrisma.importJobRow.findMany({
      where: { import_job_id: job.id },
    });
    const eligibleRow = rowsAfterFirst.find(
      (r) => r.external_id === 'EXT-PI-ELIG',
    );
    const blockedRow = rowsAfterFirst.find(
      (r) => r.external_id === 'EXT-PI-BLOCK',
    );
    expect(eligibleRow?.undone_at).toBeTruthy();
    expect(blockedRow?.undone_at).toBeNull();

    // Count customer audit logs for deleted eligible customer
    const auditsAfterFirst = await tenantPrisma.auditLog.count({
      where: {
        tenant_id: tenant.tenantId,
        entity_type: 'Customer',
        action: AuditLogAction.DELETE,
      },
    });
    expect(auditsAfterFirst).toBeGreaterThanOrEqual(1);

    // Second undo attempt on PARTIALLY_UNDONE job
    const secondUndo = await request(app.getHttpServer())
      .post(`/imports/${job.id}/undo`)
      .set('Authorization', adminHeader)
      .expect(200);

    expect(secondUndo.body.status).toBe('PARTIALLY_UNDONE');

    // Count audits again: MUST NOT DUPLICATE audits for the already undone row
    const auditsAfterSecond = await tenantPrisma.auditLog.count({
      where: {
        tenant_id: tenant.tenantId,
        entity_type: 'Customer',
        action: AuditLogAction.DELETE,
      },
    });
    expect(auditsAfterSecond).toBe(auditsAfterFirst);
  });

  it('large batching: processes >50 rows in committed chunks with progress and marks undone_at', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);

    // Create 60 synthetic rows (exceeds UNDO_BATCH_SIZE of 50 to test multiple committed chunks)
    const rows: string[][] = [];
    for (let i = 1; i <= 60; i++) {
      rows.push([
        `EXT-BATCH-${Date.now()}-${i}`,
        'PRIVATE',
        `BatchFirst${i}`,
        `BatchLast${i}`,
        `batch-${i}-${Date.now()}@example.com`,
        '12345',
        'AT',
      ]);
    }

    const job = await importCustomerBatch(rows);

    const initialRows = await tenantPrisma.importJobRow.findMany({
      where: { import_job_id: job.id },
    });
    expect(initialRows).toHaveLength(60);
    expect(initialRows.every((r) => r.undone_at === null)).toBe(true);

    // Execute undo
    const undoRes = await request(app.getHttpServer())
      .post(`/imports/${job.id}/undo`)
      .set('Authorization', adminHeader)
      .expect(200);

    expect(undoRes.body.status).toBe('UNDONE');

    // Verify all rows have undone_at populated
    const completedRows = await tenantPrisma.importJobRow.findMany({
      where: { import_job_id: job.id },
    });
    expect(completedRows).toHaveLength(60);
    expect(completedRows.every((r) => r.undone_at !== null)).toBe(true);
  });

  it('idempotency: calling undo twice on an already UNDONE job is a safe no-op', async () => {
    const emailIdem = `idem-${Date.now()}@example.com`;

    const dryRun = await importCustomerBatch([
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
