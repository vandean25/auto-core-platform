import { AuthService } from '../src/auth/auth.service';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createGlobalValidationPipe } from '../src/common';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
} from './tenant-test-utils';
import { teardownTestApp } from './test-lifecycle';

const DEFAULT_OPENING_HOURS = [
  { weekday: 1, isClosed: false, openTime: '07:30', closeTime: '17:00' },
  { weekday: 2, isClosed: false, openTime: '07:30', closeTime: '17:00' },
  { weekday: 3, isClosed: false, openTime: '07:30', closeTime: '17:00' },
  { weekday: 4, isClosed: false, openTime: '07:30', closeTime: '17:00' },
  { weekday: 5, isClosed: false, openTime: '07:30', closeTime: '17:00' },
  { weekday: 6, isClosed: false, openTime: '08:00', closeTime: '12:00' },
  { weekday: 7, isClosed: true, openTime: '07:30', closeTime: '17:00' },
] as const;

describe('Workshop settings and holidays (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    basePrisma = app.get(PrismaService);
    const testTenant = await createTestTenant(
      basePrisma,
      'workshop-settings',
    );
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    authToken = createTestAuthToken(app.get(AuthService), testTenant);
  });

  afterAll(async () => {
    if (tenantId) {
      await cleanupTestTenantGraph(basePrisma, tenantId);
    }
    await teardownTestApp(app, basePrisma);
  });

  it('GET /settings seeds seven weekday rows with documented defaults', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/workshop/settings')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.timezone).toBe('Europe/Vienna');
    expect(response.body.slotMinutes).toBe(30);
    expect(response.body.holidayCountryIso).toBe('AT');
    expect(response.body.openingHours).toHaveLength(7);
    expect(response.body.openingHours).toEqual(
      expect.arrayContaining(
        DEFAULT_OPENING_HOURS.map((hour) => expect.objectContaining(hour)),
      ),
    );
  });

  it('PUT /settings rejects invalid slotMinutes and close_time <= open_time', async () => {
    await request(app.getHttpServer())
      .put('/api/workshop/settings')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        timezone: 'Europe/Vienna',
        slotMinutes: 45,
        holidayCountryIso: 'AT',
        holidaySubdivisionCode: null,
        openingHours: DEFAULT_OPENING_HOURS,
      })
      .expect(400);

    const badHours = DEFAULT_OPENING_HOURS.map((hour) =>
      hour.weekday === 1
        ? { ...hour, isClosed: false, openTime: '17:00', closeTime: '07:30' }
        : hour,
    );

    await request(app.getHttpServer())
      .put('/api/workshop/settings')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        timezone: 'Europe/Vienna',
        slotMinutes: 30,
        holidayCountryIso: 'AT',
        holidaySubdivisionCode: null,
        openingHours: badHours,
      })
      .expect(400);
  });

  it('PUT /settings round-trips timezone and weekday hours', async () => {
    const updatedHours = DEFAULT_OPENING_HOURS.map((hour) =>
      hour.weekday === 3
        ? { ...hour, openTime: '08:00', closeTime: '16:00' }
        : hour,
    );

    const response = await request(app.getHttpServer())
      .put('/api/workshop/settings')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        timezone: 'Europe/Berlin',
        slotMinutes: 60,
        holidayCountryIso: 'DE',
        holidaySubdivisionCode: 'DE-BY',
        openingHours: updatedHours,
      })
      .expect(200);

    expect(response.body.timezone).toBe('Europe/Berlin');
    expect(response.body.slotMinutes).toBe(60);
    expect(response.body.holidayCountryIso).toBe('DE');
    expect(response.body.holidaySubdivisionCode).toBe('DE-BY');
    expect(
      response.body.openingHours.find((hour: { weekday: number }) => hour.weekday === 3),
    ).toEqual(
      expect.objectContaining({
        openTime: '08:00',
        closeTime: '16:00',
      }),
    );
  });

  it('holiday CRUD supports closed and short days', async () => {
    const closed = await request(app.getHttpServer())
      .post('/api/workshop/holidays')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Nationalfeiertag',
        observedOn: '2026-10-26',
        isClosed: true,
      })
      .expect(201);

    expect(closed.body).toEqual(
      expect.objectContaining({
        name: 'Nationalfeiertag',
        observedOn: '2026-10-26',
        isClosed: true,
        source: 'MANUAL',
      }),
    );

    const short = await request(app.getHttpServer())
      .post('/api/workshop/holidays')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Christmas Eve',
        observedOn: '2026-12-24',
        isClosed: false,
        openTime: '08:00',
        closeTime: '12:00',
      })
      .expect(201);

    expect(short.body).toEqual(
      expect.objectContaining({
        name: 'Christmas Eve',
        observedOn: '2026-12-24',
        isClosed: false,
        openTime: '08:00',
        closeTime: '12:00',
      }),
    );

    const list = await request(app.getHttpServer())
      .get('/api/workshop/holidays')
      .query({ from: '2026-01-01', to: '2026-12-31' })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(list.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: closed.body.id }),
        expect.objectContaining({ id: short.body.id }),
      ]),
    );

    await request(app.getHttpServer())
      .delete(`/api/workshop/holidays/${short.body.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(204);
  });

  it('holiday create returns 409 when dates collide', async () => {
    await request(app.getHttpServer())
      .post('/api/workshop/holidays')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Betriebsurlaub',
        observedOn: '2026-08-15',
        repeatsAnnually: true,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/workshop/holidays')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Company holiday',
        observedOn: '2027-08-15',
        repeatsAnnually: true,
      })
      .expect(409);
  });

  it('SALES can read settings but cannot write holidays', async () => {
    const salesTenant = await createTestTenant(basePrisma, 'workshop-settings-sales');
    await basePrisma.tenantMember.updateMany({
      where: {
        tenant_id: salesTenant.tenantId,
        user: { firebaseUid: salesTenant.firebaseUid },
      },
      data: { role: 'SALES' },
    });
    const salesToken = createTestAuthToken(app.get(AuthService), {
      ...salesTenant,
      role: 'SALES',
    });

    await request(app.getHttpServer())
      .get('/api/workshop/settings')
      .set('Authorization', `Bearer ${salesToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/workshop/holidays')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({
        name: 'Blocked',
        observedOn: '2026-11-01',
      })
      .expect(403);

    await cleanupTestTenantGraph(basePrisma, salesTenant.tenantId);
  });
});
