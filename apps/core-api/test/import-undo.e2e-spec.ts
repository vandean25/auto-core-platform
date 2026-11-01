import { randomBytes } from 'node:crypto';

// Set environment variables before any module imports
process.env.API_KEY_PEPPER = Buffer.alloc(32, 1).toString('base64');
process.env.IMPORT_MAX_ROW_COUNT = '20000';

import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  AuditActorType,
  AuditLogAction,
  ImportJobStatus,
} from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SystemPrismaService } from '../src/prisma/system-prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { RequestContextService } from '../src/common/services/request-context.service.js';
import {
  IMPORT_ERROR_CODES,
  IMPORT_SOURCE,
} from '../src/import/import.constants.js';
import { createE2eApp } from './helpers/e2e-suite.js';
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
import { ImportUndoService } from '../src/import/import-undo.service.js';
import { ImportAuditWriter } from '../src/import/import-audit.writer.js';
import { deleteCreatedEntity } from '../src/import/import-undo-writer.js';
import {
  createUndoWorkerState,
  nextUndoLeaseUntil,
  readUndoWorkerState,
} from '../src/import/import-undo-worker.js';
import type { ImportJobOptionsWithUndo } from '../src/import/import-undo-worker.js';

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
      .post('/api/imports')
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
      .post(`/api/imports/${dryRun.body.id}/apply`)
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
    app = await createE2eApp(undefined, { productionErrorFilter: true });

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
      .post('/api/tenant-api-keys')
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
      .post(`/api/imports/${dummyJob.id}/undo/preview`)
      .set('Authorization', salesHeader)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/imports/${dummyJob.id}/undo`)
      .set('Authorization', salesHeader)
      .expect(403);

    // 2. TECH forbidden
    await request(app.getHttpServer())
      .post(`/api/imports/${dummyJob.id}/undo/preview`)
      .set('Authorization', techHeader)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/imports/${dummyJob.id}/undo`)
      .set('Authorization', techHeader)
      .expect(403);

    // 3. DEMO forbidden
    await request(app.getHttpServer())
      .post(`/api/imports/${dummyJob.id}/undo/preview`)
      .set('Authorization', demoHeader)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/imports/${dummyJob.id}/undo`)
      .set('Authorization', demoHeader)
      .expect(403);

    // 4. API Key forbidden
    await request(app.getHttpServer())
      .post(`/api/imports/${dummyJob.id}/undo/preview`)
      .set('Authorization', apiKeyHeader)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/imports/${dummyJob.id}/undo`)
      .set('Authorization', apiKeyHeader)
      .expect(403);

    // 5. OWNER allowed
    await request(app.getHttpServer())
      .post(`/api/imports/${dummyJob.id}/undo/preview`)
      .set('Authorization', ownerHeader)
      .expect(200);

    // 6. ADMIN allowed
    await request(app.getHttpServer())
      .post(`/api/imports/${dummyJob.id}/undo/preview`)
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
      .post(`/api/imports/${dryRun.id}/undo/preview`)
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
      .post(`/api/imports/${dryRun.id}/undo`)
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
    // The deny-by-default extension rejects a restore that carries tenant_id in its data.
    expect(restoredCustomer.tenant_id).toBe(tenant.tenantId);

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
      .post(`/api/imports/${dryRun.id}/undo/preview`)
      .set('Authorization', adminHeader)
      .expect(200);

    expect(previewRes.body.status).toBe('ELIGIBLE');
    expect(previewRes.body.canUndo).toBe(true);
    expect(previewRes.body.counts.toDelete).toBe(1);
    expect(previewRes.body.counts.toRestore).toBe(1);

    // 4. Execute undo
    const undoRes = await request(app.getHttpServer())
      .post(`/api/imports/${dryRun.id}/undo`)
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
      .post(`/api/imports/${custJob.id}/undo/preview`)
      .set('Authorization', adminHeader)
      .expect(200);

    expect(custPreviewWO.body.status).toBe('BLOCKED');
    expect(custPreviewWO.body.counts.blocked).toBe(1);
    expect(custPreviewWO.body.blocked[0].reason).toBe(
      UNDO_BLOCKED_REASONS.DOWNSTREAM_WORK_ORDER,
    );

    // Case B: Link vehicle to active WorkshopOrder -> DOWNSTREAM_WORK_ORDER
    const vehPreviewWO = await request(app.getHttpServer())
      .post(`/api/imports/${vehJob.id}/undo/preview`)
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
      .post(`/api/imports/${vehJob.id}/undo/preview`)
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
      .post(`/api/imports/${vehJob.id}/undo/preview`)
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
      .post(`/api/imports/${custJob.id}/undo/preview`)
      .set('Authorization', adminHeader)
      .expect(200);

    expect(custPreviewConsent.body.status).toBe('BLOCKED');
    expect(custPreviewConsent.body.counts.blocked).toBe(1);
    expect(custPreviewConsent.body.blocked[0].reason).toBe(
      UNDO_BLOCKED_REASONS.DOWNSTREAM_CUSTOMER_CONSENT,
    );

    // Attempting undo on custJob must leave customer in DB and return PARTIALLY_UNDONE
    const undoCust = await request(app.getHttpServer())
      .post(`/api/imports/${custJob.id}/undo`)
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
      .post(`/api/imports/${dryRun.id}/undo/preview`)
      .set('Authorization', adminHeader)
      .expect(200);

    expect(preview.body.status).toBe('CONFLICT');
    expect(preview.body.counts.conflicts).toBe(1);
    expect(preview.body.conflicts[0].reason).toBe(
      UNDO_BLOCKED_REASONS.MODIFIED_SINCE_IMPORT,
    );

    // Undo without confirmedEntityIds: conflict is skipped
    const undoWithoutConfirm = await request(app.getHttpServer())
      .post(`/api/imports/${dryRun.id}/undo`)
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
      .post(`/api/imports/${dryRun.id}/undo`)
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
      .post(`/api/imports/${dryRun.id}/undo/preview`)
      .set('Authorization', adminHeader)
      .expect(200);

    expect(preview.body.status).toBe('BLOCKED');
    expect(preview.body.counts.blocked).toBe(1);
    expect(preview.body.blocked[0].reason).toBe(
      UNDO_BLOCKED_REASONS.DOWNSTREAM_INVOICE,
    );

    // Attempting undo must NOT touch the customer or invoice
    const undoRes = await request(app.getHttpServer())
      .post(`/api/imports/${dryRun.id}/undo`)
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

  it('race condition guard: rejects undo when job is currently UNDOING or APPLYING', async () => {
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

    const undoingRes = await request(app.getHttpServer())
      .post(`/api/imports/${raceJob.id}/undo`)
      .set('Authorization', adminHeader)
      .expect(409);
    expect(undoingRes.body.code).toBe(IMPORT_ERROR_CODES.JOB_BUSY);

    // Case 2: Job in APPLYING status -> 409 Conflict
    await tenantPrisma.importJob.update({
      where: { id: raceJob.id },
      data: { status: 'APPLYING' },
    });

    const applyingRes = await request(app.getHttpServer())
      .post(`/api/imports/${raceJob.id}/undo`)
      .set('Authorization', adminHeader)
      .expect(409);
    expect(applyingRes.body.code).toBe(IMPORT_ERROR_CODES.JOB_BUSY);
  });

  it('race condition guard: two concurrent undo requests run the undo exactly once', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const email = `race-concurrent-${Date.now()}@example.com`;

    const job = await importCustomerBatch([
      ['EXT-RACE-1', 'PRIVATE', 'Race', 'Customer', email, '777', 'AT'],
    ]);

    const countJobAudits = () =>
      tenantPrisma.auditLog.count({
        where: {
          entity_type: 'ImportJob',
          entity_id: job.id,
          action: AuditLogAction.UPDATE,
        },
      });

    const auditsBefore = await countJobAudits();

    const postUndo = () =>
      request(app.getHttpServer())
        .post(`/api/imports/${job.id}/undo`)
        .set('Authorization', adminHeader);

    const responses = await Promise.all([postUndo(), postUndo()]);

    for (const res of responses) {
      expect([200, 409]).toContain(res.status);
      if (res.status === 409) {
        expect([
          IMPORT_ERROR_CODES.JOB_BUSY,
          IMPORT_ERROR_CODES.JOB_CONFLICT,
        ]).toContain(res.body.code);
      }
    }

    const finalJob = await tenantPrisma.importJob.findFirstOrThrow({
      where: { id: job.id },
    });
    expect(finalJob.status).toBe('UNDONE');

    expect(await countJobAudits()).toBe(auditsBefore + 1);

    expect(
      await tenantPrisma.customer.findFirst({ where: { email } }),
    ).toBeNull();
  });

  it('worker race: two concurrent worker attempts on one run process every row exactly once', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const stamp = Date.now();
    const emails = [1, 2, 3, 4, 5, 6].map(
      (n) => `worker-race-${n}-${stamp}@example.com`,
    );

    const job = await importCustomerBatch(
      emails.map((email, index) => [
        `EXT-WRACE-${stamp}-${index + 1}`,
        'PRIVATE',
        `Worker${index + 1}`,
        'Race',
        email,
        '45678',
        'AT',
      ]),
    );

    const entityIds = (
      await tenantPrisma.importJobRow.findMany({
        where: { import_job_id: job.id },
        select: { entity_id: true },
      })
    )
      .map((row) => row.entity_id)
      .filter((entityId): entityId is string => Boolean(entityId));
    expect(entityIds).toHaveLength(emails.length);

    const adminUser = await systemPrisma.user.findFirstOrThrow({
      where: { firebaseUid: tenant.firebaseUid },
      select: { id: true, email: true },
    });

    // The state an HTTP claim leaves behind: the lease is released, so both of the two
    // overlapping Cloud Tasks deliveries of the same task are allowed to try to take it.
    await tenantPrisma.importJob.update({
      where: { id: job.id },
      data: {
        status: ImportJobStatus.UNDOING,
        options_json: {
          undo_worker: createUndoWorkerState({
            actorUserId: adminUser.id,
            actorEmail: adminUser.email,
            actorRole: 'ADMIN',
            resumeStatus: ImportJobStatus.APPLIED,
            confirmedEntityIds: [],
            totalRows: emails.length,
          }),
        },
      },
    });

    const undoService = app.get(ImportUndoService);
    const requestContext = app.get(RequestContextService);
    const attempt = (workerId: string) =>
      requestContext.runAsWorker(
        tenant.tenantId,
        () =>
          undoService.runUndoWorkerAttempt({
            tenantId: tenant.tenantId,
            jobId: job.id,
          }),
        { workerId },
      );

    // A small batch size keeps the winner inside the loop long enough to interleave.
    process.env.IMPORT_UNDO_BATCH_SIZE = '2';
    try {
      await Promise.all([attempt('worker-a'), attempt('worker-b')]);
    } finally {
      delete process.env.IMPORT_UNDO_BATCH_SIZE;
    }

    const finalJob = await tenantPrisma.importJob.findFirstOrThrow({
      where: { id: job.id },
    });
    expect(finalJob.status).toBe(ImportJobStatus.UNDONE);
    expect(
      (finalJob.options_json as { undo?: Record<string, number> }).undo,
    ).toMatchObject({ deleted: emails.length, restored: 0, blocked: 0 });

    // The loser of the compare-and-swap writes nothing. The generic Prisma audit extension
    // adds its own entry per delete, so only the import's trail is counted here.
    const audits = await tenantPrisma.auditLog.findMany({
      where: {
        entity_id: { in: entityIds },
        action: AuditLogAction.DELETE,
        source: IMPORT_SOURCE,
      },
      select: { entity_id: true },
    });
    expect(audits).toHaveLength(emails.length);
    expect(new Set(audits.map((audit) => audit.entity_id)).size).toBe(
      emails.length,
    );

    const finalRows = await tenantPrisma.importJobRow.findMany({
      where: { import_job_id: job.id },
    });
    expect(finalRows.every((row) => row.undone_at !== null)).toBe(true);
    expect(
      await tenantPrisma.customer.findMany({
        where: { email: { in: emails } },
      }),
    ).toEqual([]);
  });

  /** True once some backend waits for a row lock, so the claim is queued behind the holder. */
  async function waitForBlockedRowLock(): Promise<void> {
    for (let poll = 0; poll < 400; poll += 1) {
      const waiting = await prisma.$queryRaw<Array<{ waiting: number }>>`
        SELECT count(*)::int AS waiting
        FROM pg_locks blocked
        JOIN pg_stat_activity backend ON backend.pid = blocked.pid
        WHERE NOT blocked.granted AND backend.datname = current_database()`;
      if (waiting[0].waiting > 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('the claim never waited on the holder row lock');
  }

  it('worker lease: a claim from a stale read loses when the holder commits one more batch', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const stamp = Date.now();
    const emails = [1, 2, 3, 4].map(
      (n) => `lease-stale-${n}-${stamp}@example.com`,
    );

    const job = await importCustomerBatch(
      emails.map((email, index) => [
        `EXT-LSTALE-${stamp}-${index + 1}`,
        'PRIVATE',
        `Stale${index + 1}`,
        'Claim',
        email,
        '34567',
        'AT',
      ]),
    );

    const rows = await tenantPrisma.importJobRow.findMany({
      where: { import_job_id: job.id },
      orderBy: { row_no: 'asc' },
    });
    const entityIds = rows
      .map((row) => row.entity_id)
      .filter((entityId): entityId is string => Boolean(entityId));
    expect(entityIds).toHaveLength(emails.length);

    const adminUser = await systemPrisma.user.findFirstOrThrow({
      where: { firebaseUid: tenant.firebaseUid },
      select: { id: true, email: true },
    });

    // Holder A: its lease has just expired while it is still running, so a second delivery of
    // the same task is allowed to read the job and try to take the claim over.
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    await tenantPrisma.importJob.update({
      where: { id: job.id },
      data: {
        status: ImportJobStatus.UNDOING,
        options_json: {
          undo_worker: {
            ...createUndoWorkerState({
              actorUserId: adminUser.id,
              actorEmail: adminUser.email,
              actorRole: 'ADMIN',
              resumeStatus: ImportJobStatus.APPLIED,
              confirmedEntityIds: [],
              totalRows: emails.length,
            }),
            lease_token: 'lease-a',
            lease_until: expiredAt,
            started_at: expiredAt,
            heartbeat_at: expiredAt,
          },
        },
      },
    });

    const undoService = app.get(ImportUndoService);
    const requestContext = app.get(RequestContextService);
    const attempt = (workerId: string) =>
      requestContext.runAsWorker(
        tenant.tenantId,
        () =>
          undoService.runUndoWorkerAttempt({
            tenantId: tenant.tenantId,
            jobId: job.id,
          }),
        { workerId },
      );

    // A's one remaining batch, held open before its commit. Like a real batch it locks the job
    // row first, so B reads the state from before the batch and then queues behind that lock to
    // claim. A claim built on that stale read must match no row, or it would roll A's counters
    // and cursor back and lose the batch A is committing right now.
    const holderAudit = new ImportAuditWriter({
      getAuthenticatedUser: () => ({
        userId: adminUser.id,
        email: adminUser.email,
        role: 'ADMIN',
      }),
    } as never);
    let releaseBatch!: () => void;
    const batchGate = new Promise<void>((resolve) => {
      releaseBatch = resolve;
    });
    let rowLocked!: () => void;
    const rowLock = new Promise<void>((resolve) => {
      rowLocked = resolve;
    });
    const holderBatch = tenantPrisma.$transaction(
      async (tx) => {
        const held = await tx.importJob.findFirstOrThrow({
          where: { tenant_id: tenant.tenantId, id: job.id },
        });
        const worker = readUndoWorkerState(
          held.options_json as ImportJobOptionsWithUndo,
        );
        if (!worker) {
          throw new Error('holder state missing');
        }
        const leaseWhere = {
          tenant_id: tenant.tenantId,
          id: job.id,
          status: ImportJobStatus.UNDOING,
          options_json: {
            path: ['undo_worker', 'lease_token'],
            equals: 'lease-a',
          },
        };
        const locked = await tx.importJob.updateMany({
          where: leaseWhere,
          data: {
            options_json: {
              undo_worker: {
                ...worker,
                heartbeat_at: new Date().toISOString(),
                lease_until: nextUndoLeaseUntil(Date.now()),
              },
            },
          },
        });
        if (locked.count !== 1) {
          throw new Error('holder lost its lease before the batch');
        }
        rowLocked();
        await deleteCreatedEntity(
          tx,
          tenant.tenantId,
          'CUSTOMER',
          entityIds[0],
          job.id,
        );
        await holderAudit.writeEntityAudit(
          tx,
          tenant.tenantId,
          adminUser.id,
          job.id,
          'CUSTOMER',
          entityIds[0],
          AuditLogAction.DELETE,
          rows[0].normalized_json,
          null,
        );
        await tx.importJobRow.update({
          where: {
            tenant_id_import_job_id_row_no: {
              tenant_id: tenant.tenantId,
              import_job_id: job.id,
              row_no: rows[0].row_no,
            },
          },
          data: { undone_at: new Date() },
        });
        const progress = await tx.importJob.updateMany({
          where: leaseWhere,
          data: {
            options_json: {
              undo_worker: {
                ...worker,
                cursor: String(rows[0].row_no),
                processed_rows: 1,
                deleted_rows: 1,
                heartbeat_at: new Date().toISOString(),
                lease_until: nextUndoLeaseUntil(Date.now()),
              },
            },
          },
        });
        if (progress.count !== 1) {
          throw new Error('holder lost its lease during the batch');
        }
        await batchGate;
      },
      { timeout: 60_000, maxWait: 10_000 },
    );

    await rowLock;
    const staleClaim = attempt('worker-b');
    await waitForBlockedRowLock();
    releaseBatch();
    await Promise.all([holderBatch, staleClaim]);

    const afterRace = await tenantPrisma.importJob.findFirstOrThrow({
      where: { id: job.id },
    });
    expect(afterRace.status).toBe(ImportJobStatus.UNDOING);
    expect(
      readUndoWorkerState(afterRace.options_json as ImportJobOptionsWithUndo),
    ).toMatchObject({
      lease_token: 'lease-a',
      cursor: String(rows[0].row_no),
      processed_rows: 1,
      deleted_rows: 1,
      restored_rows: 0,
    });

    // A dies right after its commit, so its lease lapses and the next attempt takes over from
    // the counters A actually reached.
    const survivor = readUndoWorkerState(
      afterRace.options_json as ImportJobOptionsWithUndo,
    );
    await tenantPrisma.importJob.update({
      where: { id: job.id },
      data: {
        options_json: {
          undo_worker: {
            ...survivor,
            lease_until: expiredAt,
            heartbeat_at: expiredAt,
          },
        },
      },
    });

    const jobAuditsBefore = await tenantPrisma.auditLog.count({
      where: {
        entity_type: 'ImportJob',
        entity_id: job.id,
        action: AuditLogAction.UPDATE,
      },
    });
    await attempt('worker-c');

    const finalJob = await tenantPrisma.importJob.findFirstOrThrow({
      where: { id: job.id },
    });
    expect(finalJob.status).toBe(ImportJobStatus.UNDONE);
    expect(
      (finalJob.options_json as { undo?: Record<string, number> }).undo,
    ).toMatchObject({
      deleted: emails.length,
      restored: 0,
      blocked: 0,
    });

    const finalRows = await tenantPrisma.importJobRow.findMany({
      where: { import_job_id: job.id },
    });
    expect(finalRows.every((row) => row.undone_at !== null)).toBe(true);
    expect(
      await tenantPrisma.customer.findMany({
        where: { email: { in: emails } },
      }),
    ).toEqual([]);

    // One import DELETE audit per reverted row: A's batch wrote the first, the takeover the rest.
    const deleteAudits = await tenantPrisma.auditLog.findMany({
      where: {
        entity_id: { in: entityIds },
        action: AuditLogAction.DELETE,
        source: IMPORT_SOURCE,
      },
      select: { entity_id: true },
    });
    expect(deleteAudits).toHaveLength(emails.length);
    expect(new Set(deleteAudits.map((audit) => audit.entity_id)).size).toBe(
      emails.length,
    );
    expect(
      await tenantPrisma.auditLog.count({
        where: {
          entity_type: 'ImportJob',
          entity_id: job.id,
          action: AuditLogAction.UPDATE,
        },
      }),
    ).toBe(jobAuditsBefore + 1);
  }, 120_000);

  it('purge gate: undo reports IMPORT_JOB_PURGED when staged rows were purged', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);

    const job = await tenantPrisma.importJob.create({
      data: {
        tenant_id: tenant.tenantId,
        source_system: 'legacy-dms',
        entity_type: 'CUSTOMER',
        file_name: 'purged.csv',
        file_sha256: 'mock-purged-sha',
        mapping_json: {},
        options_json: { rows_purged: true },
        status: 'APPLIED',
        totals_json: { total: 2, create: 2, update: 0, skip: 0, error: 0 },
        created_by: tenant.firebaseUid,
      },
    });

    const previewRes = await request(app.getHttpServer())
      .post(`/api/imports/${job.id}/undo/preview`)
      .set('Authorization', adminHeader)
      .expect(200);
    expect(previewRes.body.status).toBe('BLOCKED');
    expect(previewRes.body.canUndo).toBe(false);
    expect(previewRes.body.blocked[0].reason).toBe(
      UNDO_BLOCKED_REASONS.ROWS_PURGED,
    );

    const undoRes = await request(app.getHttpServer())
      .post(`/api/imports/${job.id}/undo`)
      .set('Authorization', adminHeader)
      .expect(409);
    expect(undoRes.body.code).toBe(IMPORT_ERROR_CODES.JOB_PURGED);

    const untouched = await tenantPrisma.importJob.findFirstOrThrow({
      where: { id: job.id },
    });
    expect(untouched.status).toBe('APPLIED');
  });

  it('expiry gate: undo reports IMPORT_JOB_EXPIRED when the job was cancelled as expired', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);

    const job = await tenantPrisma.importJob.create({
      data: {
        tenant_id: tenant.tenantId,
        source_system: 'legacy-dms',
        entity_type: 'CUSTOMER',
        file_name: 'expired.csv',
        file_sha256: 'mock-expired-sha',
        mapping_json: {},
        options_json: { cancel_reason: 'expired' },
        status: 'APPLIED',
        totals_json: { total: 1, create: 1, update: 0, skip: 0, error: 0 },
        created_by: tenant.firebaseUid,
      },
    });

    const undoRes = await request(app.getHttpServer())
      .post(`/api/imports/${job.id}/undo`)
      .set('Authorization', adminHeader)
      .expect(409);
    expect(undoRes.body.code).toBe(IMPORT_ERROR_CODES.JOB_EXPIRED);

    const untouched = await tenantPrisma.importJob.findFirstOrThrow({
      where: { id: job.id },
    });
    expect(untouched.status).toBe('APPLIED');
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
      .post(`/api/imports/${job.id}/undo`)
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
      .post(`/api/imports/${job.id}/undo`)
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

  it('large batching: commits 60 rows in several chunks and marks every row undone', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);

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

    // A small batch size exercises the chunked commit path without importing hundreds of rows.
    process.env.IMPORT_UNDO_BATCH_SIZE = '20';
    try {
      const undoRes = await request(app.getHttpServer())
        .post(`/api/imports/${job.id}/undo`)
        .set('Authorization', adminHeader)
        .expect(200);

      expect(undoRes.body.status).toBe('UNDONE');
      expect(undoRes.body.options.undo).toMatchObject({
        deleted: 60,
        blocked: 0,
      });
    } finally {
      delete process.env.IMPORT_UNDO_BATCH_SIZE;
    }

    // Verify all rows have undone_at populated
    const completedRows = await tenantPrisma.importJobRow.findMany({
      where: { import_job_id: job.id },
    });
    expect(completedRows).toHaveLength(60);
    expect(completedRows.every((r) => r.undone_at !== null)).toBe(true);
  });

  // Row count of the scaled run. PR CI uses the small default; the 20k run at the supported
  // maximum (IMPORT_MAX_ROW_COUNT) is `npm --workspace=core-api run test:e2e:import-undo-20k`.
  const scaledRowCount = Number(process.env.IMPORT_UNDO_E2E_ROWS ?? 120);

  it(`scaled run: previews and undoes ${scaledRowCount} imported customers on a real database`, async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const stamp = Date.now();
    const emailPrefix = `undo-scale-${stamp}-`;

    const job = await importCustomerBatch(
      Array.from({ length: scaledRowCount }, (_, index) => [
        `EXT-SCALE-${stamp}-${index + 1}`,
        'PRIVATE',
        `Scale${index + 1}`,
        'Customer',
        `${emailPrefix}${index + 1}@example.com`,
        '98765',
        'AT',
      ]),
    );
    expect(job.totals.create).toBe(scaledRowCount);

    const entityIds = (
      await tenantPrisma.importJobRow.findMany({
        where: { import_job_id: job.id },
        select: { entity_id: true },
      })
    )
      .map((row) => row.entity_id)
      .filter((entityId): entityId is string => Boolean(entityId));
    expect(entityIds).toHaveLength(scaledRowCount);

    const previewStartedAt = Date.now();
    const preview = await request(app.getHttpServer())
      .post(`/api/imports/${job.id}/undo/preview`)
      .set('Authorization', adminHeader)
      .expect(200);
    const previewMs = Date.now() - previewStartedAt;

    expect(preview.body.canUndo).toBe(true);
    expect(preview.body.counts).toMatchObject({
      total: scaledRowCount,
      toDelete: scaledRowCount,
      toRestore: 0,
      conflicts: 0,
      blocked: 0,
    });
    // One request walks every page with batched guard queries (2000 rows measured 0.3 ms per
    // row), so the bound is per row plus the request overhead: a per-row query shows up at any
    // size, and a loaded runner still passes.
    expect(previewMs).toBeLessThan(5_000 + scaledRowCount * 2);

    const undoStartedAt = Date.now();
    const jobAuditsBeforeUndo = await tenantPrisma.auditLog.count({
      where: {
        entity_type: 'ImportJob',
        entity_id: job.id,
        action: AuditLogAction.UPDATE,
      },
    });
    const undoRes = await request(app.getHttpServer())
      .post(`/api/imports/${job.id}/undo`)
      .set('Authorization', adminHeader)
      .expect(200);
    const undoMs = Date.now() - undoStartedAt;

    console.info(
      `import-undo scaled e2e: rows=${scaledRowCount} preview_ms=${previewMs} undo_ms=${undoMs}`,
    );

    // One unit is budgeted at 25 s and hands off, so the bound is per row: it catches an
    // N+1 regression without failing on a loaded runner (20k measured 13 ms/row).
    expect(undoMs).toBeLessThan(scaledRowCount * 100);

    expect(undoRes.body.status).toBe('UNDONE');
    expect(undoRes.body.options.undo).toMatchObject({
      deleted: scaledRowCount,
      restored: 0,
      blocked: 0,
    });

    expect(
      await tenantPrisma.importJobRow.count({
        where: { import_job_id: job.id, undone_at: { not: null } },
      }),
    ).toBe(scaledRowCount);

    expect(
      await tenantPrisma.customer.count({
        where: { email: { startsWith: emailPrefix } },
      }),
    ).toBe(0);

    // One import DELETE audit per reverted row (the generic audit extension writes its own
    // entry per delete), and one finalize audit for the whole run.
    let deleteAudits = 0;
    for (let start = 0; start < entityIds.length; start += 1000) {
      deleteAudits += await tenantPrisma.auditLog.count({
        where: {
          action: AuditLogAction.DELETE,
          source: IMPORT_SOURCE,
          entity_id: { in: entityIds.slice(start, start + 1000) },
        },
      });
    }
    expect(deleteAudits).toBe(scaledRowCount);
    expect(
      await tenantPrisma.auditLog.count({
        where: {
          entity_type: 'ImportJob',
          entity_id: job.id,
          action: AuditLogAction.UPDATE,
        },
      }),
    ).toBe(jobAuditsBeforeUndo + 1);
  }, 1_800_000);

  it('resume: a killed undo run is reclaimed and finishes the remaining rows exactly once', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const stamp = Date.now();
    const emails = [1, 2, 3].map((n) => `resume-${n}-${stamp}@example.com`);

    const job = await importCustomerBatch(
      emails.map((email, index) => [
        `EXT-RESUME-${stamp}-${index + 1}`,
        'PRIVATE',
        `Resume${index + 1}`,
        'Customer',
        email,
        '12345',
        'AT',
      ]),
    );

    const rows = await tenantPrisma.importJobRow.findMany({
      where: { import_job_id: job.id },
      orderBy: { row_no: 'asc' },
    });
    expect(rows).toHaveLength(3);

    // Replay the one batch the dead worker committed before it was killed.
    const doneRow = rows[0];
    const doneEntityId = doneRow.entity_id ?? '';
    await tenantPrisma.externalIdMapping.deleteMany({
      where: { entity_id: doneEntityId },
    });
    await tenantPrisma.customer.deleteMany({ where: { id: doneEntityId } });
    await tenantPrisma.importJobRow.updateMany({
      where: { import_job_id: job.id, row_no: doneRow.row_no },
      data: { undone_at: new Date() },
    });

    const adminUser = await systemPrisma.user.findFirstOrThrow({
      where: { firebaseUid: tenant.firebaseUid },
      select: { id: true, email: true },
    });
    const deadAt = new Date(Date.now() - 10 * 60_000).toISOString();
    await tenantPrisma.importJob.update({
      where: { id: job.id },
      data: {
        status: ImportJobStatus.UNDOING,
        options_json: {
          undo_worker: {
            lease_token: 'dead-worker',
            lease_until: deadAt,
            started_at: deadAt,
            heartbeat_at: deadAt,
            actor_user_id: adminUser.id,
            actor_email: adminUser.email,
            actor_role: 'ADMIN',
            resume_status: ImportJobStatus.APPLIED,
            confirmed_entity_ids: [],
            cursor: String(doneRow.row_no),
            processed_rows: 1,
            total_rows: 3,
            deleted_rows: 1,
            restored_rows: 0,
            blocked_reasons: {},
          },
        },
      },
    });

    const countJobAudits = () =>
      tenantPrisma.auditLog.count({
        where: {
          entity_type: 'ImportJob',
          entity_id: job.id,
          action: AuditLogAction.UPDATE,
        },
      });
    const auditsBefore = await countJobAudits();

    const resumeRes = await request(app.getHttpServer())
      .post(`/api/imports/${job.id}/undo`)
      .set('Authorization', adminHeader)
      .expect(200);

    expect(resumeRes.body.status).toBe('UNDONE');
    // The killed run's deletion stays in the total instead of being overwritten.
    expect(resumeRes.body.options.undo).toMatchObject({
      deleted: 3,
      restored: 0,
      blocked: 0,
    });
    expect(resumeRes.body.options.undo_worker).toBeUndefined();

    expect(
      await tenantPrisma.customer.findMany({
        where: { email: { in: emails } },
      }),
    ).toEqual([]);

    const finalRows = await tenantPrisma.importJobRow.findMany({
      where: { import_job_id: job.id },
    });
    expect(finalRows).toHaveLength(3);
    expect(finalRows.every((row) => row.undone_at !== null)).toBe(true);

    expect(await countJobAudits()).toBe(auditsBefore + 1);
  });

  it('undoes a FAILED job whose apply already wrote rows', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const email = `failed-apply-${Date.now()}@example.com`;

    const job = await importCustomerBatch([
      ['EXT-FAILED-1', 'PRIVATE', 'Failed', 'Apply', email, '321', 'AT'],
    ]);

    // A failed apply keeps the rows it already wrote; undo must still revert them.
    await tenantPrisma.importJob.update({
      where: { id: job.id },
      data: { status: ImportJobStatus.FAILED },
    });

    const undoRes = await request(app.getHttpServer())
      .post(`/api/imports/${job.id}/undo`)
      .set('Authorization', adminHeader)
      .expect(200);

    expect(undoRes.body.status).toBe('UNDONE');
    expect(undoRes.body.options.undo).toMatchObject({
      deleted: 1,
      blocked: 0,
    });
    expect(await tenantPrisma.customer.findFirst({ where: { email } })).toBeNull();
  });

  it('already undone: preview reports IMPORT_JOB_ALREADY_UNDONE and a second undo is a no-op', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const emailIdem = `idem-${Date.now()}@example.com`;

    const dryRun = await importCustomerBatch([
      ['EXT-IDEM-1', 'PRIVATE', 'Idem', 'Test', emailIdem, '555', 'AT'],
    ]);

    const countJobAudits = () =>
      tenantPrisma.auditLog.count({
        where: {
          entity_type: 'ImportJob',
          entity_id: dryRun.id,
          action: AuditLogAction.UPDATE,
        },
      });

    const firstUndo = await request(app.getHttpServer())
      .post(`/api/imports/${dryRun.id}/undo`)
      .set('Authorization', adminHeader)
      .expect(200);

    expect(firstUndo.body.status).toBe('UNDONE');
    const auditsAfterFirst = await countJobAudits();

    const previewRes = await request(app.getHttpServer())
      .post(`/api/imports/${dryRun.id}/undo/preview`)
      .set('Authorization', adminHeader)
      .expect(400);
    expect(previewRes.body.code).toBe(IMPORT_ERROR_CODES.JOB_ALREADY_UNDONE);

    const secondUndo = await request(app.getHttpServer())
      .post(`/api/imports/${dryRun.id}/undo`)
      .set('Authorization', adminHeader)
      .expect(200);

    expect(secondUndo.body.status).toBe('UNDONE');
    expect(await countJobAudits()).toBe(auditsAfterFirst);
  });

  it('cron recovery: a stale undo claim is resumed by the scheduler and finishes the remaining rows once', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const stamp = Date.now();
    const emails = [1, 2, 3].map(
      (n) => `cron-resume-${n}-${stamp}@example.com`,
    );

    const job = await importCustomerBatch(
      emails.map((email, index) => [
        `EXT-CRON-${stamp}-${index + 1}`,
        'PRIVATE',
        `Cron${index + 1}`,
        'Resume',
        email,
        '24680',
        'AT',
      ]),
    );

    const rows = await tenantPrisma.importJobRow.findMany({
      where: { import_job_id: job.id },
      orderBy: { row_no: 'asc' },
    });
    expect(rows).toHaveLength(3);

    // Replay the one batch the dead worker committed before it was killed.
    const doneRow = rows[0];
    const doneEntityId = doneRow.entity_id ?? '';
    await tenantPrisma.externalIdMapping.deleteMany({
      where: { entity_id: doneEntityId },
    });
    await tenantPrisma.customer.deleteMany({ where: { id: doneEntityId } });
    await tenantPrisma.importJobRow.updateMany({
      where: { import_job_id: job.id, row_no: doneRow.row_no },
      data: { undone_at: new Date() },
    });

    const adminUser = await systemPrisma.user.findFirstOrThrow({
      where: { firebaseUid: tenant.firebaseUid },
      select: { id: true, email: true },
    });
    const diedAtMs = Date.now() - 10 * 60_000;
    await tenantPrisma.importJob.update({
      where: { id: job.id },
      data: {
        status: ImportJobStatus.UNDOING,
        options_json: {
          undo_worker: {
            ...createUndoWorkerState({
              actorUserId: adminUser.id,
              actorEmail: adminUser.email,
              actorRole: 'ADMIN',
              resumeStatus: ImportJobStatus.APPLIED,
              confirmedEntityIds: [],
              totalRows: 3,
              previous: {
                status: 'PARTIALLY_UNDONE',
                undone_at: new Date(diedAtMs).toISOString(),
                deleted: 1,
                restored: 0,
                blocked: 0,
                blocked_reasons: {},
              },
              nowMs: diedAtMs,
            }),
            cursor: String(doneRow.row_no),
            processed_rows: 1,
          },
        },
      },
    });

    const countJobAudits = () =>
      tenantPrisma.auditLog.count({
        where: {
          entity_type: 'ImportJob',
          entity_id: job.id,
          action: AuditLogAction.UPDATE,
        },
      });
    const auditsBefore = await countJobAudits();

    const resumed = await app
      .get(RequestContextService)
      .runAsWorker(
        tenant.tenantId,
        () =>
          app
            .get(ImportUndoService)
            .resumeStaleUndoJob(tenant.tenantId, job.id),
        { workerId: 'import-job-undo-recovery' },
      );
    expect(resumed).toBe(true);

    const finalJob = await tenantPrisma.importJob.findFirstOrThrow({
      where: { id: job.id },
    });
    expect(finalJob.status).toBe(ImportJobStatus.UNDONE);
    expect(finalJob.worker_recovery_seq).toBe(1);
    const options = finalJob.options_json as {
      undo?: Record<string, number>;
      undo_worker?: unknown;
    };
    // The killed run's deletion stays in the total instead of being overwritten.
    expect(options.undo).toMatchObject({ deleted: 3, restored: 0, blocked: 0 });
    expect(options.undo_worker).toBeUndefined();

    expect(
      await tenantPrisma.customer.findMany({
        where: { email: { in: emails } },
      }),
    ).toEqual([]);
    const finalRows = await tenantPrisma.importJobRow.findMany({
      where: { import_job_id: job.id },
    });
    expect(finalRows).toHaveLength(3);
    expect(finalRows.every((row) => row.undone_at !== null)).toBe(true);

    expect(await countJobAudits()).toBe(auditsBefore + 1);
  });

  it('apply race: apply is refused while a job is being undone and after it was undone', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const stamp = Date.now();
    const email = `apply-race-${stamp}@example.com`;

    const job = await importCustomerBatch([
      [
        `EXT-APPLY-RACE-${stamp}`,
        'PRIVATE',
        'Apply',
        'Race',
        email,
        '86420',
        'AT',
      ],
    ]);

    // An undo in flight owns the job, so apply must not write over it.
    await tenantPrisma.importJob.update({
      where: { id: job.id },
      data: { status: ImportJobStatus.UNDOING },
    });
    const whileUndoing = await request(app.getHttpServer())
      .post(`/api/imports/${job.id}/apply`)
      .set('Authorization', adminHeader)
      .expect(409);
    expect(whileUndoing.body.code).toBe(IMPORT_ERROR_CODES.JOB_STALE);

    await tenantPrisma.importJob.update({
      where: { id: job.id },
      data: { status: ImportJobStatus.APPLIED },
    });
    await request(app.getHttpServer())
      .post(`/api/imports/${job.id}/undo`)
      .set('Authorization', adminHeader)
      .expect(200);

    // The reverted import must not come back through a late apply delivery.
    const afterUndo = await request(app.getHttpServer())
      .post(`/api/imports/${job.id}/apply`)
      .set('Authorization', adminHeader)
      .expect(409);
    expect(afterUndo.body.code).toBe(IMPORT_ERROR_CODES.JOB_STALE);
    expect(
      await tenantPrisma.customer.findFirst({ where: { email } }),
    ).toBeNull();
  });

  describe('AUT-846 Undo Eligibility', () => {
    function seedTestImportJob(
      tenantPrisma: any,
      attrs: {
        status: ImportJobStatus;
        totals?: { total: number; create: number; update: number; skip: number; error: number };
        options?: Record<string, unknown>;
      },
    ) {
      const stamp = Date.now();
      return tenantPrisma.importJob.create({
        data: {
          tenant_id: tenant.tenantId,
          source_system: 'legacy-dms',
          entity_type: 'CUSTOMER',
          file_name: `test-${stamp}.csv`,
          file_sha256: `sha-${stamp}`,
          mapping_json: {},
          options_json: attrs.options ?? {},
          status: attrs.status,
          totals_json: attrs.totals ?? { total: 1, create: 1, update: 0, skip: 0, error: 0 },
          created_by: tenant.firebaseUid,
        },
      });
    }

    it('eligibility: FAILED dry-run job with planned totals and no entity_ids gives 409 IMPORT_JOB_NOT_UNDOABLE on preview and on undo, status unchanged', async () => {
      const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
      const failedDryRun = await seedTestImportJob(tenantPrisma, {
        status: ImportJobStatus.FAILED,
        totals: { total: 10, create: 10, update: 0, skip: 0, error: 0 },
      });

      const previewRes = await request(app.getHttpServer())
        .post(`/api/imports/${failedDryRun.id}/undo/preview`)
        .set('Authorization', adminHeader)
        .expect(409);
      expect(previewRes.body.code).toBe(IMPORT_ERROR_CODES.JOB_NOT_UNDOABLE);

      const undoRes = await request(app.getHttpServer())
        .post(`/api/imports/${failedDryRun.id}/undo`)
        .set('Authorization', adminHeader)
        .expect(409);
      expect(undoRes.body.code).toBe(IMPORT_ERROR_CODES.JOB_NOT_UNDOABLE);

      const checkJob = await tenantPrisma.importJob.findFirstOrThrow({
        where: { id: failedDryRun.id },
      });
      expect(checkJob.status).toBe(ImportJobStatus.FAILED);
    });

    it('eligibility: FAILED job with at least one applied row stays undoable (preview 200, undo 202/200)', async () => {
      const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
      const stamp = Date.now();
      const email = `failed-partial-${stamp}@example.com`;

      const job = await importCustomerBatch([
        [`EXT-FP-${stamp}`, 'PRIVATE', 'Partial', 'Apply', email, '123', 'AT'],
      ]);

      await tenantPrisma.importJob.update({
        where: { id: job.id },
        data: { status: ImportJobStatus.FAILED },
      });

      const previewRes = await request(app.getHttpServer())
        .post(`/api/imports/${job.id}/undo/preview`)
        .set('Authorization', adminHeader)
        .expect(200);
      expect(previewRes.body.canUndo).toBe(true);
      expect(previewRes.body.counts.toDelete).toBe(1);

      const undoRes = await request(app.getHttpServer())
        .post(`/api/imports/${job.id}/undo`)
        .set('Authorization', adminHeader);
      expect([200, 202]).toContain(undoRes.status);
    });

    it('eligibility: GET /api/imports returns correct undoable per job and evaluates page in batched query', async () => {
      const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
      const stamp = Date.now();

      // 1. APPLIED with entity_id
      const jobApplied = await importCustomerBatch([
        [`EXT-APP-${stamp}`, 'PRIVATE', 'Applied', 'Cust', `app-${stamp}@example.com`, '111', 'AT'],
      ]);

      // 2. Legacy APPLIED without entity_id
      const jobLegacy = await importCustomerBatch([
        [`EXT-LEG-${stamp}`, 'PRIVATE', 'Legacy', 'Cust', `leg-${stamp}@example.com`, '222', 'AT'],
      ]);
      await tenantPrisma.importJobRow.updateMany({
        where: { import_job_id: jobLegacy.id },
        data: { entity_id: null },
      });

      // 3. FAILED dry run (no rows with entity_id)
      const jobFailedDryRun = await seedTestImportJob(tenantPrisma, {
        status: ImportJobStatus.FAILED,
        totals: { total: 5, create: 5, update: 0, skip: 0, error: 0 },
      });

      // 4. FAILED partial apply (has row with entity_id)
      const jobFailedPartial = await importCustomerBatch([
        [`EXT-FP2-${stamp}`, 'PRIVATE', 'Partial2', 'Cust', `fp2-${stamp}@example.com`, '333', 'AT'],
      ]);
      await tenantPrisma.importJob.update({
        where: { id: jobFailedPartial.id },
        data: { status: ImportJobStatus.FAILED },
      });

      // 5. UNDONE
      const jobUndone = await importCustomerBatch([
        [`EXT-UND-${stamp}`, 'PRIVATE', 'Undone', 'Cust', `und-${stamp}@example.com`, '444', 'AT'],
      ]);
      await request(app.getHttpServer())
        .post(`/api/imports/${jobUndone.id}/undo`)
        .set('Authorization', adminHeader)
        .expect(200);

      // 6. DRY_RUN_DONE
      const jobDryRunDone = await seedTestImportJob(tenantPrisma, {
        status: ImportJobStatus.DRY_RUN_DONE,
        totals: { total: 3, create: 3, update: 0, skip: 0, error: 0 },
      });

      const listRes = await request(app.getHttpServer())
        .get('/api/imports?limit=50')
        .set('Authorization', adminHeader)
        .expect(200);

      const jobsMap = new Map<string, { undoable?: boolean }>(
        listRes.body.data.map((j: { id: string; undoable?: boolean }) => [j.id, j]),
      );

      expect(jobsMap.get(jobApplied.id)?.undoable).toBe(true);
      expect(jobsMap.get(jobLegacy.id)?.undoable).toBe(false);
      expect(jobsMap.get(jobFailedDryRun.id)?.undoable).toBe(false);
      expect(jobsMap.get(jobFailedPartial.id)?.undoable).toBe(true);
      expect(jobsMap.get(jobUndone.id)?.undoable).toBe(false);
      expect(jobsMap.get(jobDryRunDone.id)?.undoable).toBe(false);
    });
  });
});
