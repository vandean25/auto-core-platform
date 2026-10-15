import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  REGISTRATION_DOCUMENT_EXTRACTION_PROVIDER,
} from '../src/registration-intake/registration-document-extraction-provider.js';
import { createRegistrationDocumentExtractionProvider } from '../src/registration-intake/registration-document-extraction-provider.factory.js';
import {
  REGISTRATION_INTAKE_BYTE_STORAGE,
} from '../src/registration-intake/registration-intake-byte-storage.js';
import { InMemoryRegistrationIntakeByteStorage } from './support/in-memory-registration-intake-storage.js';
import { encodeRegistrationIntakeFixtureBytes } from '../src/registration-intake/registration-intake-fixture-bytes.js';
import { REGISTRATION_INTAKE_MAX_BYTES_PER_FILE } from '../src/registration-intake/registration-intake-limits.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('Registration document intake (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;
  let tenantId: string;
  const storage = new InMemoryRegistrationIntakeByteStorage();

  beforeAll(async () => {
    process.env.REGISTRATION_DOCUMENT_EXTRACTION_PROVIDER = 'fake';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(REGISTRATION_DOCUMENT_EXTRACTION_PROVIDER)
      .useFactory({
        factory: () => createRegistrationDocumentExtractionProvider(process.env),
      })
      .overrideProvider(REGISTRATION_INTAKE_BYTE_STORAGE)
      .useValue(storage)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    storage.objects.clear();
    const tenant = await createTestTenant(prisma, 'reg-intake');
    tenantId = tenant.tenantId;
    authToken = createTestAuthToken(app.get(AuthService), tenant);
  });

  afterEach(async () => {
    if (tenantId) {
      const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
      await tenantPrisma.registrationIntakeBytePurge.deleteMany({
        where: { tenant_id: tenantId },
      });
      await tenantPrisma.registrationDocumentIntake.deleteMany({
        where: { tenant_id: tenantId },
      });
      await cleanupTestTenantGraph(prisma, tenantId);
    }
  });

  afterAll(async () => {
    await teardownTestApp(app);
  });

  it('creates from front-clear and back-clear with merged evidence', async () => {
    const front = encodeRegistrationIntakeFixtureBytes('front-clear');
    const back = encodeRegistrationIntakeFixtureBytes('back-clear');
    const response = await request(app.getHttpServer())
      .post('/api/workshop/registration-intakes')
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', 'reg-intake-front-back-1')
      .field('sides', 'FRONT')
      .field('sides', 'BACK')
      .attach('files', front, 'front.jpg')
      .attach('files', back, 'back.jpg')
      .expect(201);

    expect(response.body.state).toBe('AWAITING_REVIEW');
    expect(response.body.evidence.fields.make.normalized).toBe('Synthetic');
    expect(response.body.evidence.fields.co2.normalized).toBe(119);
    expect(storage.objects.size).toBe(2);
  });

  it('returns 503 when provider is disabled and no row exists', async () => {
    const disabled = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(REGISTRATION_DOCUMENT_EXTRACTION_PROVIDER)
      .useValue({
        isAvailable: () => false,
        getMetadata: () => ({ providerId: 'disabled', modelId: 'none' }),
        extract: async () => {
          throw new Error('unavailable');
        },
      })
      .overrideProvider(REGISTRATION_INTAKE_BYTE_STORAGE)
      .useValue(storage)
      .compile();
    const disabledApp = disabled.createNestApplication();
    disabledApp.setGlobalPrefix('api');
    disabledApp.useGlobalPipes(createGlobalValidationPipe());
    await disabledApp.init();
    const token = createTestAuthToken(
      disabledApp.get(AuthService),
      await createTestTenant(disabledApp.get(PrismaService), 'reg-disabled'),
    );
    const bytes = encodeRegistrationIntakeFixtureBytes('front-clear');
    const res = await request(disabledApp.getHttpServer())
      .post('/api/workshop/registration-intakes')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'disabled-key')
      .field('sides', 'FRONT')
      .attach('files', bytes, 'front.jpg')
      .expect(503);
    expect(res.body.code).toBe('REGISTRATION_EXTRACTION_UNAVAILABLE');
    await disabledApp.close();
  });

  it('rejects low-confidence apply without writes', async () => {
    const bytes = encodeRegistrationIntakeFixtureBytes('low-confidence');
    const create = await request(app.getHttpServer())
      .post('/api/workshop/registration-intakes')
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', 'low-confidence-1')
      .field('sides', 'FRONT')
      .attach('files', bytes, 'front.jpg')
      .expect(201);
    const apply = await request(app.getHttpServer())
      .post(`/api/workshop/registration-intakes/${create.body.id}/apply`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        vin: 'WVWZZZSYNTH000001',
        plate: 'W SYNTH 1',
        holder: { firstName: 'pilot', lastName: 'customer' },
        nationalcode: 'NC1001',
      })
      .expect(422);
    expect(apply.body.code).toBe('REGISTRATION_INTAKE_LOW_CONFIDENCE');
    const vehicles = await createTenantAwarePrisma(prisma, tenantId).vehicle.count();
    expect(vehicles).toBe(0);
  });

  it('confirms pilot customer and vehicle then creates workshop order', async () => {
    const front = encodeRegistrationIntakeFixtureBytes('front-clear');
    const back = encodeRegistrationIntakeFixtureBytes('back-clear');
    const create = await request(app.getHttpServer())
      .post('/api/workshop/registration-intakes')
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', 'happy-path-1')
      .field('sides', 'FRONT')
      .field('sides', 'BACK')
      .attach('files', front, 'front.jpg')
      .attach('files', back, 'back.jpg')
      .expect(201);

    const applyBody = {
      vin: 'WVWZZZSYNTH000001',
      plate: 'W SYNTH 1',
      holder: { firstName: 'pilot', lastName: 'customer' },
      nationalcode: 'NC1001',
      firstRegistration: '2019-03-12',
      co2: { value: 119, cycle: 'WLTP' as const },
      make: 'Synthetic',
      model: 'Demo',
      year: 2019,
    };
    const apply = await request(app.getHttpServer())
      .post(`/api/workshop/registration-intakes/${create.body.id}/apply`)
      .set('Authorization', `Bearer ${authToken}`)
      .send(applyBody)
      .expect(200);
    expect(apply.body.state).toBe('APPLIED');
    expect(apply.body.createdCustomer).toBe(true);
    expect(apply.body.createdVehicle).toBe(true);

    const repeatApply = await request(app.getHttpServer())
      .post(`/api/workshop/registration-intakes/${create.body.id}/apply`)
      .set('Authorization', `Bearer ${authToken}`)
      .send(applyBody)
      .expect(200);
    expect(repeatApply.body.vehicleId).toBe(apply.body.vehicleId);

    const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
    expect(await tenantPrisma.vehicle.count()).toBe(1);
    expect(await tenantPrisma.customer.count()).toBe(1);

    const order = await request(app.getHttpServer())
      .post(`/api/workshop/registration-intakes/${create.body.id}/order`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ odometer: 12000, fuelLevel: 40, notes: 'Snap intake' })
      .expect(200);
    expect(order.body.workshopOrderId).toBeTruthy();
  });

  it('rejects unsupported file type before storing bytes', async () => {
    const bad = Buffer.from('not-a-real-image');
    const res = await request(app.getHttpServer())
      .post('/api/workshop/registration-intakes')
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', 'bad-mime-1')
      .field('sides', 'FRONT')
      .attach('files', bad, 'notes.txt')
      .expect(400);
    expect(res.body.code).toBe('REGISTRATION_INTAKE_UNSUPPORTED_FILE');
    expect(storage.objects.size).toBe(0);
  });

  it('rejects files over 10 MiB', async () => {
    const huge = Buffer.alloc(REGISTRATION_INTAKE_MAX_BYTES_PER_FILE + 1, 0xff);
    huge[0] = 0xff;
    huge[1] = 0xd8;
    huge[2] = 0xff;
    const res = await request(app.getHttpServer())
      .post('/api/workshop/registration-intakes')
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', 'too-large-1')
      .field('sides', 'FRONT')
      .attach('files', huge, 'huge.jpg')
      .expect(413);
    expect(res.body.code).toBe('REGISTRATION_INTAKE_FILE_TOO_LARGE');
  });

  it('aborts awaiting review and removes stored bytes', async () => {
    const front = encodeRegistrationIntakeFixtureBytes('front-clear');
    const create = await request(app.getHttpServer())
      .post('/api/workshop/registration-intakes')
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', 'abort-1')
      .field('sides', 'FRONT')
      .attach('files', front, 'front.jpg')
      .expect(201);
    expect(storage.objects.size).toBeGreaterThan(0);
    await request(app.getHttpServer())
      .post(`/api/workshop/registration-intakes/${create.body.id}/abort`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(storage.objects.size).toBe(0);
  });

  it('treats illegible PDF as reviewable failure without apply writes', async () => {
    const illegible = encodeRegistrationIntakeFixtureBytes('illegible', 'application/pdf');
    const create = await request(app.getHttpServer())
      .post('/api/workshop/registration-intakes')
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', 'illegible-pdf-1')
      .field('sides', 'FRONT')
      .attach('files', illegible, 'scan.pdf')
      .expect(201);
    expect(create.body.state).toBe('AWAITING_REVIEW');
    await request(app.getHttpServer())
      .post(`/api/workshop/registration-intakes/${create.body.id}/apply`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        vin: null,
        plate: 'W SYNTH 1',
        holder: { firstName: 'pilot', lastName: 'customer' },
        nationalcode: null,
      })
      .expect(422);
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
    expect(await tenantPrisma.vehicle.count()).toBe(0);
  });
});
