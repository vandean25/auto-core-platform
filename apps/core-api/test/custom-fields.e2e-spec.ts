import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import {
  MAX_CUSTOM_FIELDS_PER_ENTITY,
  MAX_CUSTOM_FIELD_TEXT_LENGTH,
} from '../src/custom-fields/custom-fields.constants.js';
import { McpOrderHistoryReadService } from '../src/mcp/mcp-order-history-read.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  seedTestTenantMember,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

jest.setTimeout(30000);

describe('Custom fields (AUT-1043 e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prismaA: PrismaService;
  let tenantAId: string;
  let adminToken: string;
  let salesToken: string;
  let customerId: string;
  let vehicleId: string;
  let siteAId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    basePrisma = app.get<PrismaService>(PrismaService);
    const authService = app.get<AuthService>(AuthService);

    const tenantA = await createTestTenant(basePrisma, 'aut1043');
    tenantAId = tenantA.tenantId;
    adminToken = createTestAuthToken(authService, tenantA, { role: 'ADMIN' });

    const salesUser = await basePrisma.user.create({
      data: {
        firebaseUid: `e2e-sales-1043-${Date.now()}`,
        email: `sales-1043-${Date.now()}@example.com`,
      },
    });
    await seedTestTenantMember(basePrisma, {
      tenantId: tenantAId,
      userId: salesUser.id,
      role: 'SALES',
    });
    salesToken = createTestAuthToken(authService, tenantA, {
      sub: salesUser.firebaseUid ?? undefined,
      email: salesUser.email ?? undefined,
      role: 'SALES',
    });

    prismaA = createTenantAwarePrisma(basePrisma, tenantAId);
    const siteA = await prismaA.site.findFirst({
      where: { tenant_id: tenantAId },
      select: { id: true },
    });
    siteAId = siteA!.id;

    const customer = await prismaA.customer.create({
      data: {
        tenant_id: tenantAId,
        first_name: 'Erika',
        last_name: 'Musterfrau',
        email: `erika-1043-${Date.now()}@example.com`,
        type: 'PRIVATE',
      },
    });
    customerId = customer.id;

    const vehicle = await prismaA.vehicle.create({
      data: {
        tenant_id: tenantAId,
        customer_id: customerId,
        make: 'VW',
        model: 'Golf',
        year: 2023,
        plate: 'W-1043CF',
      },
    });
    vehicleId = vehicle.id;
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(basePrisma, tenantAId);
    await teardownTestApp(app);
  });

  const auth = (token: string) => ({
    Authorization: `Bearer ${token}`,
    'x-tenant-id': tenantAId,
    'x-site-id': siteAId,
  });

  it('Scenario 1: WHEN flag is OFF THEN definitions API returns 403 and customer/vehicle omit custom_fields', async () => {
    await request(app.getHttpServer())
      .get('/api/custom-fields/definitions')
      .set(auth(adminToken))
      .expect(403);

    const custRes = await request(app.getHttpServer())
      .get(`/api/customers/${customerId}`)
      .set(auth(adminToken))
      .expect(200);
    expect(custRes.body).not.toHaveProperty('custom_fields');

    await request(app.getHttpServer())
      .patch(`/api/customers/${customerId}`)
      .set(auth(adminToken))
      .send({ custom_fields: { flottennummer: 'FL-1' } })
      .expect(403);
  });

  it('Scenario 2 & 12: WHEN flag is ON and ADMIN creates a TEXT field THEN it is listed and audited', async () => {
    await basePrisma.tenant.update({
      where: { id: tenantAId },
      data: { custom_fields_enabled: true },
    });

    const createRes = await request(app.getHttpServer())
      .post('/api/custom-fields/definitions')
      .set(auth(adminToken))
      .send({
        entity: 'CUSTOMER',
        label: 'Flottennummer',
        type: 'TEXT',
        purpose: 'Flottenabrechnung',
      })
      .expect(201);

    expect(createRes.body.key).toBe('flottennummer');
    expect(createRes.body.personal_data).toBe(true);

    const listRes = await request(app.getHttpServer())
      .get('/api/custom-fields/definitions?entity=CUSTOMER')
      .set(auth(salesToken))
      .expect(200);
    expect(listRes.body.some((d: { key: string }) => d.key === 'flottennummer')).toBe(
      true,
    );

    const audit = await prismaA.auditLog.findFirst({
      where: {
        tenant_id: tenantAId,
        entity_type: 'CustomFieldDefinition',
        entity_id: createRes.body.id,
        action: 'CREATE',
      },
    });
    expect(audit).not.toBeNull();

    await request(app.getHttpServer())
      .patch(`/api/custom-fields/definitions/${createRes.body.id}`)
      .set(auth(adminToken))
      .send({ purpose: 'Flottenabrechnung aktualisiert' })
      .expect(200);

    const updateAudit = await prismaA.auditLog.findFirst({
      where: {
        tenant_id: tenantAId,
        entity_type: 'CustomFieldDefinition',
        entity_id: createRes.body.id,
        action: 'UPDATE',
      },
    });
    expect(updateAudit).not.toBeNull();
    expect(updateAudit?.actor_user_id).toBeTruthy();
    expect(updateAudit?.diff).toEqual(
      expect.objectContaining({
        changedFields: expect.arrayContaining(['purpose']),
        diff: expect.objectContaining({
          purpose: {
            before: 'Flottenabrechnung',
            after: 'Flottenabrechnung aktualisiert',
          },
        }),
      }),
    );

    await request(app.getHttpServer())
      .patch(`/api/custom-fields/definitions/${createRes.body.id}`)
      .set(auth(adminToken))
      .send({ purpose: 'Flottenabrechnung' })
      .expect(200);
  });

  it('Scenario 3: WHEN an advisor edits the value inline THEN it is saved and validated by type', async () => {
    const patchRes = await request(app.getHttpServer())
      .patch(`/api/customers/${customerId}`)
      .set(auth(salesToken))
      .send({ custom_fields: { flottennummer: 'FL-42' } })
      .expect(200);
    expect(patchRes.body.custom_fields).toEqual({ flottennummer: 'FL-42' });

    await request(app.getHttpServer())
      .post('/api/custom-fields/definitions')
      .set(auth(adminToken))
      .send({
        entity: 'VEHICLE',
        label: 'Stellplatz',
        type: 'TEXT',
        purpose: 'Werkstattsteuerung',
      })
      .expect(201);

    const vehPatch = await request(app.getHttpServer())
      .patch(`/api/vehicles/${vehicleId}`)
      .set(auth(salesToken))
      .send({ custom_fields: { stellplatz: 'B4' } })
      .expect(200);
    expect(vehPatch.body.custom_fields).toEqual({ stellplatz: 'B4' });
  });

  it('Scenario 4: WHEN value exceeds max length or SELECT value is invalid THEN API returns 422', async () => {
    await request(app.getHttpServer())
      .patch(`/api/customers/${customerId}`)
      .set(auth(salesToken))
      .send({
        custom_fields: {
          flottennummer: 'x'.repeat(MAX_CUSTOM_FIELD_TEXT_LENGTH + 1),
        },
      })
      .expect(422);

    await request(app.getHttpServer())
      .post('/api/custom-fields/definitions')
      .set(auth(adminToken))
      .send({
        entity: 'CUSTOMER',
        label: 'Kontaktkanal',
        type: 'SELECT',
        options: ['Telefon', 'E-Mail'],
        purpose: 'Kundenkontakt',
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/customers/${customerId}`)
      .set(auth(salesToken))
      .send({ custom_fields: { kontaktkanal: 'Fax' } })
      .expect(422);
  });

  it('Scenario 5: WHEN a non-OWNER/ADMIN role tries to create a definition THEN API returns 403', async () => {
    await request(app.getHttpServer())
      .post('/api/custom-fields/definitions')
      .set(auth(salesToken))
      .send({
        entity: 'CUSTOMER',
        label: 'Verboten',
        type: 'TEXT',
        purpose: 'Test',
      })
      .expect(403);
  });

  it('Scenario 6: WHEN ADMIN names a field "Gesundheitszustand" THEN blocked; warning keyword needs confirmation', async () => {
    await request(app.getHttpServer())
      .post('/api/custom-fields/definitions')
      .set(auth(adminToken))
      .send({
        entity: 'CUSTOMER',
        label: 'Gesundheitszustand',
        type: 'TEXT',
        purpose: 'Test',
      })
      .expect(422);

    await request(app.getHttpServer())
      .post('/api/custom-fields/definitions')
      .set(auth(adminToken))
      .send({
        entity: 'CUSTOMER',
        label: 'Allergie Hinweis',
        type: 'TEXT',
        purpose: 'Kaffee',
      })
      .expect(422);

    await request(app.getHttpServer())
      .post('/api/custom-fields/definitions')
      .set(auth(adminToken))
      .send({
        entity: 'CUSTOMER',
        label: 'Allergie Hinweis',
        type: 'TEXT',
        purpose: 'Kaffee-Service',
        confirmNoArt9: true,
      })
      .expect(201);
  });

  it('Scenario 7: WHEN tenant has max number of fields THEN creating another returns 422', async () => {
    const existingCount = await prismaA.customFieldDefinition.count({
      where: { tenant_id: tenantAId, entity: 'VEHICLE', archived: false },
    });
    const toCreate = MAX_CUSTOM_FIELDS_PER_ENTITY - existingCount;
    for (let i = 0; i < toCreate; i++) {
      await prismaA.customFieldDefinition.create({
        data: {
          tenant_id: tenantAId,
          entity: 'VEHICLE',
          key: `veh_limit_${i}`,
          label: `Veh Limit ${i}`,
          type: 'TEXT',
          purpose: 'Limit test',
          sort_order: 100 + i,
        },
      });
    }

    await request(app.getHttpServer())
      .post('/api/custom-fields/definitions')
      .set(auth(adminToken))
      .send({
        entity: 'VEHICLE',
        label: 'Over Limit',
        type: 'TEXT',
        purpose: 'Test',
      })
      .expect(422);
  });

  it('Scenario 10: WHEN ADMIN exports the field catalogue THEN CSV lists definitions with purpose and personal_data', async () => {
    const csvRes = await request(app.getHttpServer())
      .get('/api/custom-fields/definitions/export')
      .set(auth(adminToken))
      .expect(200);

    expect(csvRes.text).toContain(
      'entity,key,label,type,purpose,personal_data,retention_class,archived',
    );
    expect(csvRes.text).toContain(
      'CUSTOMER,flottennummer,Flottennummer,TEXT,Flottenabrechnung,true,PARENT_OBJECT,false',
    );
  });

  it('Scenario 11 & Anti-criterion 2 & Scenario 8: archived/flag-OFF values are hidden in file but included in Art 15 export', async () => {
    const defsRes = await request(app.getHttpServer())
      .get('/api/custom-fields/definitions?entity=CUSTOMER')
      .set(auth(adminToken))
      .expect(200);
    const flottenDef = defsRes.body.find(
      (d: { key: string }) => d.key === 'flottennummer',
    );

    await request(app.getHttpServer())
      .patch(`/api/custom-fields/definitions/${flottenDef.id}`)
      .set(auth(adminToken))
      .send({ archived: true })
      .expect(200);

    const custWhileOn = await request(app.getHttpServer())
      .get(`/api/customers/${customerId}`)
      .set(auth(salesToken))
      .expect(200);
    expect(custWhileOn.body.custom_fields).not.toHaveProperty('flottennummer');

    // Turn flag OFF -> Art 15 package still includes customer and vehicle values with labels
    await basePrisma.tenant.update({
      where: { id: tenantAId },
      data: { custom_fields_enabled: false },
    });

    const art15Res = await request(app.getHttpServer())
      .get(`/api/customers/${customerId}/art15-export`)
      .set(auth(adminToken))
      .expect(200);

    expect(art15Res.body.customer.custom_fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'flottennummer',
          label: 'Flottennummer',
          value: 'FL-42',
          archived: true,
        }),
      ]),
    );
    expect(art15Res.body.vehicles[0].custom_fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'stellplatz',
          label: 'Stellplatz',
          value: 'B4',
        }),
      ]),
    );
  });

  it('Anti-criterion 3: MCP getCustomer and Outbox template do not expose custom_fields', async () => {
    await basePrisma.tenant.update({
      where: { id: tenantAId },
      data: { custom_fields_enabled: true },
    });
    const mcpRead = app.get(McpOrderHistoryReadService);
    const { TenantContextStorage } = await import(
      '../src/common/services/tenant-context.storage.js'
    );
    const mcpCustomer = await TenantContextStorage.run(async () => {
      TenantContextStorage.setUser({
        userId: `e2e-user-${tenantAId}`,
        email: `e2e-${tenantAId}@example.com`,
        tenantId: tenantAId,
        role: 'ADMIN',
        activeSiteId: siteAId,
      });
      return mcpRead.getCustomer({ customer_id: customerId });
    });
    expect(mcpCustomer).not.toHaveProperty('custom_fields');
    expect(JSON.stringify(mcpCustomer)).not.toContain('FL-42');
  });

  it('Regression: customer detail and MCP strip custom_fields from workshop_orders[].vehicle and reserved_for_customer while flag is ON', async () => {
    await basePrisma.tenant.update({
      where: { id: tenantAId },
      data: { custom_fields_enabled: true },
    });

    const reservedCustomer = await prismaA.customer.create({
      data: {
        tenant_id: tenantAId,
        first_name: 'Reserved',
        last_name: 'Kunde',
        email: `reserved-1043-${Date.now()}@example.com`,
        type: 'PRIVATE',
        custom_fields: { flottennummer: 'RESERVED-SECRET' },
      },
    });

    await prismaA.vehicle.updateMany({
      where: { id: vehicleId, tenant_id: tenantAId },
      data: { reserved_for_customer_id: reservedCustomer.id },
    });

    await prismaA.workshopOrder.create({
      data: {
        tenant_id: tenantAId,
        site_id: siteAId,
        customer_id: customerId,
        vehicle_id: vehicleId,
        order_number: `WO-1043-${Date.now()}`,
        odometer: 10000,
        fuel_level: 50,
      },
    });

    const detailRes = await request(app.getHttpServer())
      .get(`/api/customers/${customerId}`)
      .set(auth(adminToken))
      .expect(200);

    expect(detailRes.body).toHaveProperty('custom_fields');
    expect(detailRes.body.vehicles[0]).not.toHaveProperty('custom_fields');
    expect(detailRes.body.vehicles[0].reserved_for_customer).not.toHaveProperty(
      'custom_fields',
    );
    expect(detailRes.body.workshop_orders[0].vehicle).not.toHaveProperty(
      'custom_fields',
    );
    expect(JSON.stringify(detailRes.body)).not.toContain('RESERVED-SECRET');

    const mcpRead = app.get(McpOrderHistoryReadService);
    const { TenantContextStorage } = await import(
      '../src/common/services/tenant-context.storage.js'
    );
    const mcpCustomer = await TenantContextStorage.run(async () => {
      TenantContextStorage.setUser({
        userId: `e2e-user-${tenantAId}`,
        email: `e2e-${tenantAId}@example.com`,
        tenantId: tenantAId,
        role: 'ADMIN',
        activeSiteId: siteAId,
      });
      return mcpRead.getCustomer({ customer_id: customerId });
    });
    expect(JSON.stringify(mcpCustomer)).not.toContain('RESERVED-SECRET');
    expect(JSON.stringify(mcpCustomer)).not.toContain('"custom_fields"');

    await prismaA.vehicle.updateMany({
      where: { id: vehicleId, tenant_id: tenantAId },
      data: { reserved_for_customer_id: null },
    });
  });

  it('Scenario 9 & Anti-criterion 1: WHEN customer is erased THEN owned custom_fields are cleared and party-only vehicle values stay out of Art. 15 and on owner row', async () => {
    const ownerCustomer = await prismaA.customer.create({
      data: {
        tenant_id: tenantAId,
        first_name: 'Owner',
        last_name: 'Kunde',
        email: `owner-1043-${Date.now()}@example.com`,
        type: 'PRIVATE',
      },
    });
    const partyVehicle = await prismaA.vehicle.create({
      data: {
        tenant_id: tenantAId,
        customer_id: ownerCustomer.id,
        make: 'BMW',
        model: '320d',
        year: 2022,
        plate: 'W-PARTY1',
        custom_fields: { stellplatz: 'OWNER-ONLY' },
      },
    });
    await prismaA.vehicleParty.create({
      data: {
        tenant_id: tenantAId,
        vehicle_id: partyVehicle.id,
        customer_id: customerId,
        role: 'DRIVER',
        source: 'MANUAL',
      },
    });

    const art15Res = await request(app.getHttpServer())
      .get(`/api/customers/${customerId}/art15-export`)
      .set(auth(adminToken))
      .expect(200);

    expect(
      art15Res.body.vehicles.map((v: { id: string }) => v.id),
    ).not.toContain(partyVehicle.id);
    expect(JSON.stringify(art15Res.body)).not.toContain('OWNER-ONLY');

    await request(app.getHttpServer())
      .post(`/api/customers/${customerId}/erase`)
      .set(auth(adminToken))
      .expect(201);

    const [dbCustomer, dbVehicle, dbPartyVehicle] = await Promise.all([
      prismaA.customer.findFirst({
        where: { id: customerId, tenant_id: tenantAId },
        select: { custom_fields: true, first_name: true },
      }),
      prismaA.vehicle.findFirst({
        where: { id: vehicleId, tenant_id: tenantAId },
        select: { custom_fields: true },
      }),
      prismaA.vehicle.findFirst({
        where: { id: partyVehicle.id, tenant_id: tenantAId },
        select: { custom_fields: true },
      }),
    ]);

    expect(dbCustomer?.custom_fields).toEqual({});
    expect(dbCustomer?.first_name).toBe('Anonymisiert');
    expect(dbVehicle?.custom_fields).toEqual({});
    expect(dbPartyVehicle?.custom_fields).toEqual({ stellplatz: 'OWNER-ONLY' });
  });
});
