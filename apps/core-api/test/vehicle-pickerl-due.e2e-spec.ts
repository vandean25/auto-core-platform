import { createE2eApp } from './helpers/e2e-suite.js';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
  seedTestTenantMember,
} from './tenant-test-utils.js';
import {
  dueSoonWithinWindow,
  pickerlDueFixturesForToday,
} from '../src/vehicle/pickerl/pickerl-due-window-fixtures.js';
import { teardownTestApp } from './test-lifecycle.js';

const FIXTURE_FIRST_REGISTRATION = new Date('2019-06-01T00:00:00.000Z');

function expectedPickerlWindowPlates(window: 30 | 60 | 90): string[] {
  const today = new Date();
  const fixtures = pickerlDueFixturesForToday(today);
  const plates = ['W-OVERDUE'];
  if (dueSoonWithinWindow(fixtures.due30, today, window)) {
    plates.push('W-DUE30');
  }
  if (dueSoonWithinWindow(fixtures.due60, today, window)) {
    plates.push('W-DUE60');
  }
  if (dueSoonWithinWindow(fixtures.due90, today, window)) {
    plates.push('W-DUE90');
  }
  return plates.sort();
}

describe('Pickerl Due (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let tenantId: string;
  let otherTenantId: string;
  let adminFirebaseUid: string;
  let adminEmail: string;
  let adminToken: string;
  let otherTenantToken: string;
  let techToken: string;

  beforeAll(async () => {
    app = await createE2eApp();

    basePrisma = app.get(PrismaService);
    const testTenant = await createTestTenant(basePrisma, 'aut-380-fix');
    tenantId = testTenant.tenantId;
    adminFirebaseUid = testTenant.firebaseUid;
    adminEmail = testTenant.email;

    const authService = app.get(AuthService);
    adminToken = createTestAuthToken(authService, testTenant);

    await runWithTenantContext(tenantId, async () => {
      const techFirebaseUid = `e2e-tech-pickerl-due-${Date.now()}`;
      const techUser = await basePrisma.user.create({
        data: {
          firebaseUid: techFirebaseUid,
          email: `e2e-tech-pickerl-due-${Date.now()}@test.local`,
        },
      });
      await seedTestTenantMember(basePrisma, {
        tenantId,
        userId: techUser.id,
        role: 'TECH',
      });
      techToken = authService.createTestToken({
        sub: techFirebaseUid,
        email: techUser.email,
        tenantId,
        role: 'TECH',
      });
    });

    // Seed AUT-380 fixtures
    await runWithTenantContext(tenantId, async () => {
      const customer = await basePrisma.customer.create({
        data: {
          tenant_id: tenantId,
          type: 'PRIVATE',
          first_name: 'John',
          last_name: 'Doe',
          phone: '+4312345678',
          email: '=injection@test.com',
        },
      });

      const today = new Date();
      const todayYear = today.getUTCFullYear();
      const pickerlWindows = pickerlDueFixturesForToday(today);

      // 1. OVERDUE
      const v1 = await basePrisma.vehicle.create({
        data: {
          tenant_id: tenantId, customer_id: customer.id,
          make: 'VW', model: 'Overdue', year: 2020, plate: 'W-OVERDUE', inventory_role: 'CUSTOMER',
          first_registration_date: FIXTURE_FIRST_REGISTRATION,
        },
      });
      await basePrisma.vehicleInspectionRecord.create({
        data: {
          tenant_id: tenantId, vehicle_id: v1.id, inspection_type: 'PICKERL_57A', inspected_on: new Date('2020-01-01'),
          plaketten_valid_until_year: todayYear - 1, plaketten_valid_until_month: 1,
        },
      });

      // 2. DUE_SOON inside the 30-day window (month-end rule)
      const future30 = pickerlWindows.due30;
      const v2 = await basePrisma.vehicle.create({
        data: {
          tenant_id: tenantId, customer_id: customer.id,
          make: 'VW', model: 'Due30', year: 2020, plate: 'W-DUE30', inventory_role: 'CUSTOMER',
          first_registration_date: FIXTURE_FIRST_REGISTRATION,
        },
      });
      await basePrisma.vehicleInspectionRecord.create({
        data: {
          tenant_id: tenantId, vehicle_id: v2.id, inspection_type: 'PICKERL_57A', inspected_on: new Date('2020-01-01'),
          plaketten_valid_until_year: future30.year,
          plaketten_valid_until_month: future30.month,
        },
      });

      // 3. due inside 60d but outside 30d
      const future60 = pickerlWindows.due60;
      const v3 = await basePrisma.vehicle.create({
        data: {
          tenant_id: tenantId, customer_id: customer.id,
          make: 'VW', model: 'Due60', year: 2020, plate: 'W-DUE60', inventory_role: 'CUSTOMER',
          first_registration_date: FIXTURE_FIRST_REGISTRATION,
        },
      });
      await basePrisma.vehicleInspectionRecord.create({
        data: {
          tenant_id: tenantId, vehicle_id: v3.id, inspection_type: 'PICKERL_57A', inspected_on: new Date('2020-01-01'),
          plaketten_valid_until_year: future60.year,
          plaketten_valid_until_month: future60.month,
        },
      });

      // 4. due inside 90d but outside 60d
      const future90 = pickerlWindows.due90;
      const v4 = await basePrisma.vehicle.create({
        data: {
          tenant_id: tenantId, customer_id: customer.id,
          make: 'VW', model: 'Due90', year: 2020, plate: 'W-DUE90', inventory_role: 'CUSTOMER',
          first_registration_date: FIXTURE_FIRST_REGISTRATION,
        },
      });
      await basePrisma.vehicleInspectionRecord.create({
        data: {
          tenant_id: tenantId, vehicle_id: v4.id, inspection_type: 'PICKERL_57A', inspected_on: new Date('2020-01-01'),
          plaketten_valid_until_year: future90.year,
          plaketten_valid_until_month: future90.month,
        },
      });

      // 5. beyond 90 (OK)
      const future120 = pickerlWindows.ok;
      const v5 = await basePrisma.vehicle.create({
        data: {
          tenant_id: tenantId, customer_id: customer.id,
          make: 'VW', model: 'OK', year: 2020, plate: 'W-OK', inventory_role: 'CUSTOMER',
          first_registration_date: FIXTURE_FIRST_REGISTRATION,
        },
      });
      await basePrisma.vehicleInspectionRecord.create({
        data: {
          tenant_id: tenantId, vehicle_id: v5.id, inspection_type: 'PICKERL_57A', inspected_on: new Date('2020-01-01'),
          plaketten_valid_until_year: future120.year,
          plaketten_valid_until_month: future120.month,
        },
      });

      // 6. UNKNOWN (no inspection)
      await basePrisma.vehicle.create({
        data: {
          tenant_id: tenantId, customer_id: customer.id,
          make: 'VW', model: 'Unknown', year: 2020, plate: 'W-UNKNOWN', inventory_role: 'CUSTOMER',
          first_registration_date: FIXTURE_FIRST_REGISTRATION,
        },
      });

      // 7. USED stock vehicle (should be ignored)
      await basePrisma.vehicle.create({
        data: {
          tenant_id: tenantId,
          make: 'VW', model: 'Stock', year: 2020, plate: 'W-STOCK', inventory_role: 'USED',
          first_registration_date: FIXTURE_FIRST_REGISTRATION,
        },
      });
    });

    const otherTenant = await createTestTenant(basePrisma, 'pickerl-due-other');
    otherTenantId = otherTenant.tenantId;
    otherTenantToken = createTestAuthToken(authService, otherTenant);
    const today = new Date();
    const todayYear = today.getUTCFullYear();
    await runWithTenantContext(otherTenantId, async () => {
      const v8 = await basePrisma.vehicle.create({
        data: {
          tenant_id: otherTenantId,
          make: 'VW',
          model: 'Other',
          year: 2020,
          plate: 'W-OTHER',
          inventory_role: 'CUSTOMER',
          first_registration_date: FIXTURE_FIRST_REGISTRATION,
        },
      });
      await basePrisma.vehicleInspectionRecord.create({
        data: {
          tenant_id: otherTenantId,
          vehicle_id: v8.id,
          inspection_type: 'PICKERL_57A',
          inspected_on: new Date('2020-01-01'),
          plaketten_valid_until_year: todayYear - 1,
          plaketten_valid_until_month: 1,
        },
      });
    });
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(basePrisma, tenantId);
    await cleanupTestTenantGraph(basePrisma, otherTenantId);
    await teardownTestApp(app);
  });

  it('GET /vehicles/pickerl-due returns paginated list with pageCount', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/vehicles/pickerl-due')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.meta.pageCount).toBeDefined();
    expect(res.body.meta.totalPages).toBeUndefined();

    const plates = res.body.data.map((v: { plate: string }) => v.plate);
    expect(plates).toContain('W-OVERDUE');
    expect(plates).toContain('W-DUE30');
    expect(plates).toContain('W-DUE60');
    expect(plates).toContain('W-DUE90');
    expect(plates).toContain('W-OK');
    expect(plates).toContain('W-UNKNOWN');
    expect(plates).not.toContain('W-STOCK');
    expect(plates).not.toContain('W-OTHER');
  });

  it('GET /vehicles/pickerl-due filters by window 30 with exact plate set', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/vehicles/pickerl-due?window=30')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const plates = res.body.data.map((v: { plate: string }) => v.plate);
    expect([...plates].sort()).toEqual(expectedPickerlWindowPlates(30));
  });

  it('GET /vehicles/pickerl-due filters by window 60 with exact plate set', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/vehicles/pickerl-due?window=60')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const plates = res.body.data.map((v: { plate: string }) => v.plate);
    expect([...plates].sort()).toEqual(expectedPickerlWindowPlates(60));
  });

  it('GET /vehicles/pickerl-due filters by window 90 with exact plate set', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/vehicles/pickerl-due?window=90')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const plates = res.body.data.map((v: { plate: string }) => v.plate);
    expect([...plates].sort()).toEqual(expectedPickerlWindowPlates(90));
  });

  it('GET /vehicles/pickerl-due?status=UNKNOWN returns only unknown vehicles', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/vehicles/pickerl-due?status=UNKNOWN')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const plates = res.body.data.map((v: { plate: string }) => v.plate);
    expect(plates).toEqual(['W-UNKNOWN']);
  });

  it('GET /vehicles/pickerl-due returns 401 without a token', async () => {
    await request(app.getHttpServer())
      .get('/api/vehicles/pickerl-due')
      .expect(401);
  });

  const someVehicleId = '00000000-0000-4000-8000-000000000001';
  it.each([
    ['post', '/api/vehicles/nova/calculate'],
    ['get', '/api/vehicles/pickerl-due'],
    ['get', '/api/vehicles/pickerl-due/export'],
    ['get', `/api/vehicles/${someVehicleId}/pickerl-open-order`],
    ['get', '/api/vehicles'],
    ['post', '/api/vehicles'],
    ['post', `/api/vehicles/${someVehicleId}/resolve-identity`],
    ['get', `/api/vehicles/${someVehicleId}/valuations`],
    ['post', `/api/vehicles/${someVehicleId}/valuations`],
    ['get', `/api/vehicles/${someVehicleId}`],
    ['patch', `/api/vehicles/${someVehicleId}`],
  ] as const)('%s %s returns 403 for TECH role', async (method, path) => {
    await request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${techToken}`)
      .expect(403);
  });

  it('GET /vehicles/pickerl-due/export returns CSV without formulas', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/vehicles/pickerl-due/export')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('plate,vehicle,customer');
    expect(res.text).toContain('W-OVERDUE');
    expect(res.text).toContain('2020-01-01'); // last_inspected_on
    expect(res.text).toContain('+4312345678'); // phone
    expect(res.text).toContain(`'=injection@test.com`); // Neutralized CSV injection
  });

  it('POST /vehicles/:id/pickerl-contacts returns 403 for TECH role', async () => {
    await request(app.getHttpServer())
      .post(`/api/vehicles/${someVehicleId}/pickerl-contacts`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ channel: 'PHONE', no_consent_reason: 'CUSTOMER_CALLED' })
      .expect(403);
  });

  describe('Pickerl contact log & phone consent gate (AUT-1041)', () => {
    let contactVehicleId: string;
    let uncontactedVehicleId: string;
    let consentedCustomerId: string;
    let emailOnlyCustomerId: string;
    let emailOnlyVehicleId: string;
    let controllerLegalEntityId: string;

    beforeAll(async () => {
      await basePrisma.user.update({
        where: { firebaseUid: adminFirebaseUid },
        data: { firstName: 'Max', lastName: 'Berater' },
      });

      await runWithTenantContext(tenantId, async () => {
        const le = await basePrisma.legalEntity.findFirstOrThrow({
          where: { tenant_id: tenantId, is_active: true },
        });
        controllerLegalEntityId = le.id;

        const c1 = await basePrisma.customer.create({
          data: {
            tenant_id: tenantId,
            type: 'PRIVATE',
            first_name: 'Anna',
            last_name: 'Telefon',
            phone: '+43660111222',
          },
        });
        consentedCustomerId = c1.id;
        await basePrisma.customerConsent.create({
          data: {
            tenant_id: tenantId,
            controller_legal_entity_id: controllerLegalEntityId,
            customer_id: consentedCustomerId,
            channel: 'PHONE',
            purpose: 'PICKERL_REMINDER',
            status: 'GRANTED',
            basis: 'CONSENT',
            sequence: 1,
            occurred_at: new Date(),
            source: 'PROFILE',
            text_version: 'v1',
            text_snapshot: 'Telefonische Erinnerung an §57a-Überprüfung',
          },
        });

        const c2 = await basePrisma.customer.create({
          data: {
            tenant_id: tenantId,
            type: 'PRIVATE',
            first_name: 'Bernd',
            last_name: 'NurEmail',
            phone: '+43660333444',
            email: 'bernd@test.local',
          },
        });
        emailOnlyCustomerId = c2.id;
        await basePrisma.customerConsent.create({
          data: {
            tenant_id: tenantId,
            controller_legal_entity_id: controllerLegalEntityId,
            customer_id: emailOnlyCustomerId,
            channel: 'EMAIL',
            purpose: 'PICKERL_REMINDER',
            status: 'GRANTED',
            basis: 'CONSENT',
            sequence: 1,
            occurred_at: new Date(),
            source: 'PROFILE',
            text_version: 'v1',
            text_snapshot: 'E-Mail-Erinnerung an §57a-Überprüfung',
          },
        });

        const todayYear = new Date().getUTCFullYear();
        const vContact = await basePrisma.vehicle.create({
          data: {
            tenant_id: tenantId,
            customer_id: consentedCustomerId,
            make: 'Audi',
            model: 'A3',
            year: 2020,
            plate: 'W-CONTACT-1',
            inventory_role: 'CUSTOMER',
            first_registration_date: FIXTURE_FIRST_REGISTRATION,
          },
        });
        contactVehicleId = vContact.id;
        await basePrisma.vehicleInspectionRecord.create({
          data: {
            tenant_id: tenantId,
            vehicle_id: contactVehicleId,
            inspection_type: 'PICKERL_57A',
            inspected_on: new Date('2024-03-01T00:00:00.000Z'),
            plaketten_valid_until_year: todayYear - 1,
            plaketten_valid_until_month: 3,
          },
        });

        const vUncontacted = await basePrisma.vehicle.create({
          data: {
            tenant_id: tenantId,
            customer_id: consentedCustomerId,
            make: 'Audi',
            model: 'A4',
            year: 2020,
            plate: 'W-UNCONTACTED-1',
            inventory_role: 'CUSTOMER',
            first_registration_date: FIXTURE_FIRST_REGISTRATION,
          },
        });
        uncontactedVehicleId = vUncontacted.id;
        await basePrisma.vehicleInspectionRecord.create({
          data: {
            tenant_id: tenantId,
            vehicle_id: uncontactedVehicleId,
            inspection_type: 'PICKERL_57A',
            inspected_on: new Date('2024-04-01T00:00:00.000Z'),
            plaketten_valid_until_year: todayYear - 1,
            plaketten_valid_until_month: 4,
          },
        });

        const vEmailOnly = await basePrisma.vehicle.create({
          data: {
            tenant_id: tenantId,
            customer_id: emailOnlyCustomerId,
            make: 'VW',
            model: 'Passat',
            year: 2020,
            plate: 'W-EMAILONLY-1',
            inventory_role: 'CUSTOMER',
            first_registration_date: FIXTURE_FIRST_REGISTRATION,
          },
        });
        emailOnlyVehicleId = vEmailOnly.id;
        await basePrisma.vehicleInspectionRecord.create({
          data: {
            tenant_id: tenantId,
            vehicle_id: emailOnlyVehicleId,
            inspection_type: 'PICKERL_57A',
            inspected_on: new Date('2024-05-01T00:00:00.000Z'),
            plaketten_valid_until_year: todayYear - 1,
            plaketten_valid_until_month: 5,
          },
        });
      });
    });

    it('records a phone contact and shows today, PHONE, and member display name on the list (Scenario 1)', async () => {
      const contactAt = new Date().toISOString();
      await request(app.getHttpServer())
        .post(`/api/vehicles/${contactVehicleId}/pickerl-contacts`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          channel: 'PHONE',
          outcome: 'NO_ANSWER',
          contacted_at: contactAt,
        })
        .expect(201);

      const listRes = await request(app.getHttpServer())
        .get('/api/vehicles/pickerl-due?pageSize=50')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const row = listRes.body.data.find(
        (v: { id: string }) => v.id === contactVehicleId,
      );
      expect(row).toMatchObject({
        last_contact_channel: 'PHONE',
        last_contact_by: 'Max Berater',
        last_contact_outcome: 'NO_ANSWER',
        phone_consent_allowed: true,
      });
      expect(new Date(row.last_contacted_at).toISOString()).toBe(contactAt);
    });

    it('shows the latest contact when two contacts exist for the same due month (Scenario 2)', async () => {
      const laterAt = new Date(Date.now() + 1_000).toISOString();
      await request(app.getHttpServer())
        .post(`/api/vehicles/${contactVehicleId}/pickerl-contacts`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          channel: 'PHONE',
          outcome: 'REACHED',
          contacted_at: laterAt,
        })
        .expect(201);

      const listRes = await request(app.getHttpServer())
        .get('/api/vehicles/pickerl-due?pageSize=50')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const row = listRes.body.data.find(
        (v: { id: string }) => v.id === contactVehicleId,
      );
      expect(row).toMatchObject({
        last_contact_channel: 'PHONE',
        last_contact_by: 'Max Berater',
        last_contact_outcome: 'REACHED',
      });
      expect(new Date(row.last_contacted_at).toISOString()).toBe(laterAt);
    });

    it('writes an audit log entry with actor Firebase uid, email, and occurred_at (Scenario 7)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/vehicles/${contactVehicleId}/pickerl-contacts`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          channel: 'PHONE',
          outcome: 'REACHED',
        })
        .expect(201);

      const auditEntry = await runWithTenantContext(tenantId, () =>
        basePrisma.auditLog.findFirst({
          where: {
            tenant_id: tenantId,
            entity_type: 'PickerlContactLog',
            entity_id: res.body.id,
          },
        }),
      );
      expect(auditEntry).toBeTruthy();
      expect(auditEntry?.occurred_at).toBeTruthy();
      expect(auditEntry?.actor_user_id).toBe(adminFirebaseUid);
      expect(auditEntry?.actor_email).toBe(adminEmail);
    });

    it('creates no NotificationOutbox row when recording a contact (Anti-criterion 4)', async () => {
      const outboxBefore = await runWithTenantContext(tenantId, () =>
        basePrisma.notificationOutbox.count({
          where: { tenant_id: tenantId },
        }),
      );

      await request(app.getHttpServer())
        .post(`/api/vehicles/${contactVehicleId}/pickerl-contacts`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          channel: 'PHONE',
          outcome: 'REACHED',
        })
        .expect(201);

      const outboxAfter = await runWithTenantContext(tenantId, () =>
        basePrisma.notificationOutbox.count({
          where: { tenant_id: tenantId },
        }),
      );
      expect(outboxAfter).toBe(outboxBefore);
    });

    it('filters contacted=no and contacted=yes (Scenario 3)', async () => {
      const noRes = await request(app.getHttpServer())
        .get('/api/vehicles/pickerl-due?contacted=no&pageSize=50')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const noIds = noRes.body.data.map((v: { id: string }) => v.id);
      expect(noIds).toContain(uncontactedVehicleId);
      expect(noIds).not.toContain(contactVehicleId);

      const yesRes = await request(app.getHttpServer())
        .get('/api/vehicles/pickerl-due?contacted=yes&pageSize=50')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const yesIds = yesRes.body.data.map((v: { id: string }) => v.id);
      expect(yesIds).toContain(contactVehicleId);
      expect(yesIds).not.toContain(uncontactedVehicleId);
    });

    it('does not count earlier contacts when due date advances (Scenario 4)', async () => {
      const nextYear = new Date().getUTCFullYear() + 1;
      await runWithTenantContext(tenantId, async () => {
        await basePrisma.vehicleInspectionRecord.create({
          data: {
            tenant_id: tenantId,
            vehicle_id: contactVehicleId,
            inspection_type: 'PICKERL_57A',
            inspected_on: new Date(),
            plaketten_valid_until_year: nextYear,
            plaketten_valid_until_month: 3,
          },
        });
      });

      const listRes = await request(app.getHttpServer())
        .get('/api/vehicles/pickerl-due?pageSize=50')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const row = listRes.body.data.find(
        (v: { id: string }) => v.id === contactVehicleId,
      );
      expect(row).toBeTruthy();
      expect(row.last_contacted_at).toBeNull();
    });

    it('includes vehicle in contacted=no when due date moves to a new due month (Anti-criterion 1)', async () => {
      const noRes = await request(app.getHttpServer())
        .get('/api/vehicles/pickerl-due?contacted=no&pageSize=50')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const row = noRes.body.data.find(
        (v: { id: string }) => v.id === contactVehicleId,
      );
      expect(row).toBeTruthy();
      expect(row.last_contacted_at).toBeNull();
    });

    it('marks customer without PHONE consent as phone_consent_allowed=false (Scenario 6)', async () => {
      const listRes = await request(app.getHttpServer())
        .get('/api/vehicles/pickerl-due?pageSize=50')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const emailOnlyRow = listRes.body.data.find(
        (v: { id: string }) => v.id === emailOnlyVehicleId,
      );
      expect(emailOnlyRow.phone_consent_allowed).toBe(false);
    });

    it('requires no_consent_reason without PHONE consent and writes admin audit for MARKETING_CALL_WITHOUT_CONSENT (Scenario 6a)', async () => {
      await request(app.getHttpServer())
        .post(`/api/vehicles/${emailOnlyVehicleId}/pickerl-contacts`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ channel: 'PHONE', outcome: 'REACHED' })
        .expect(400);

      const res = await request(app.getHttpServer())
        .post(`/api/vehicles/${emailOnlyVehicleId}/pickerl-contacts`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          channel: 'PHONE',
          outcome: 'REACHED',
          no_consent_reason: 'MARKETING_CALL_WITHOUT_CONSENT',
        })
        .expect(201);

      const auditEntry = await runWithTenantContext(tenantId, () =>
        basePrisma.auditLog.findFirst({
          where: {
            tenant_id: tenantId,
            entity_type: 'PickerlContactLog',
            entity_id: res.body.id,
          },
        }),
      );
      expect(auditEntry?.source).toBe('PICKERL_MARKETING_CALL_WITHOUT_CONSENT');
      expect(auditEntry?.actor_user_id).toBe(adminFirebaseUid);
      expect(auditEntry?.actor_email).toBe(adminEmail);
    });

    it('treats EMAIL-only consent as phone_consent_allowed=false (Scenario 6c & Anti-criterion 3)', async () => {
      const listRes = await request(app.getHttpServer())
        .get('/api/vehicles/pickerl-due?pageSize=50')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const emailOnlyRow = listRes.body.data.find(
        (v: { id: string }) => v.id === emailOnlyVehicleId,
      );
      expect(emailOnlyRow.phone_consent_allowed).toBe(false);
    });

    it('immediately deactivates PHONE consent when revoke_phone_consent=true (Scenario 6b)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/vehicles/${uncontactedVehicleId}/pickerl-contacts`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          channel: 'PHONE',
          outcome: 'DECLINED',
          revoke_phone_consent: true,
        })
        .expect(201);
      expect(res.body.phone_consent_allowed).toBe(false);

      const listRes = await request(app.getHttpServer())
        .get('/api/vehicles/pickerl-due?pageSize=50')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const row = listRes.body.data.find(
        (v: { id: string }) => v.id === uncontactedVehicleId,
      );
      expect(row.phone_consent_allowed).toBe(false);

      const revokeAudit = await runWithTenantContext(tenantId, () =>
        basePrisma.auditLog.findFirst({
          where: {
            tenant_id: tenantId,
            entity_type: 'CustomerConsent',
            source: 'pickerl-contact-dialog.revoke',
          },
        }),
      );
      expect(revokeAudit?.actor_user_id).toBe(adminFirebaseUid);
      expect(revokeAudit?.actor_email).toBe(adminEmail);
    });

    it('returns 404 when another tenant posts a contact for this vehicle (Scenario 8)', async () => {
      await request(app.getHttpServer())
        .post(`/api/vehicles/${contactVehicleId}/pickerl-contacts`)
        .set('Authorization', `Bearer ${otherTenantToken}`)
        .send({ channel: 'PHONE', no_consent_reason: 'CUSTOMER_CALLED' })
        .expect(404);
    });

    it('does not expose tenant A vehicles or contact logs in tenant B due list (Anti-criterion 2)', async () => {
      const otherListRes = await request(app.getHttpServer())
        .get('/api/vehicles/pickerl-due?pageSize=50')
        .set('Authorization', `Bearer ${otherTenantToken}`)
        .expect(200);

      const otherIds = otherListRes.body.data.map((v: { id: string }) => v.id);
      expect(otherIds).not.toContain(contactVehicleId);
      expect(otherIds).not.toContain(uncontactedVehicleId);
      expect(otherIds).not.toContain(emailOnlyVehicleId);
      for (const row of otherListRes.body.data as Array<{
        plate: string;
        last_contacted_at: string | null;
        last_contact_by: string | null;
      }>) {
        expect(row.plate).toBe('W-OTHER');
        expect(row.last_contacted_at).toBeNull();
        expect(row.last_contact_by).toBeNull();
      }
    });
  });
});
