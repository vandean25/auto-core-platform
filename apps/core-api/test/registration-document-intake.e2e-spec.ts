import { createE2eApp } from './helpers/e2e-suite.js';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
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
    app = await createE2eApp((builder) =>
      builder
        .overrideProvider(REGISTRATION_DOCUMENT_EXTRACTION_PROVIDER)
        .useFactory({
          factory: () =>
            createRegistrationDocumentExtractionProvider(process.env),
        })
        .overrideProvider(REGISTRATION_INTAKE_BYTE_STORAGE)
        .useValue(storage),
    );
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
    const disabledApp = await createE2eApp((builder) =>
      builder
        .overrideProvider(REGISTRATION_DOCUMENT_EXTRACTION_PROVIDER)
        .useValue({
          isAvailable: () => false,
          getMetadata: () => ({ providerId: 'disabled', modelId: 'none' }),
          extract: async () => {
            throw new Error('unavailable');
          },
        })
        .overrideProvider(REGISTRATION_INTAKE_BYTE_STORAGE)
        .useValue(storage),
    );
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
    const createdVehicle = await tenantPrisma.vehicle.findFirstOrThrow({
      where: { id: apply.body.vehicleId },
    });
    expect(createdVehicle.plate_normalized).toBe('WSYNTH1');

    const order = await request(app.getHttpServer())
      .post(`/api/workshop/registration-intakes/${create.body.id}/order`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ odometer: 12000, fuelLevel: 40, notes: 'Snap intake' })
      .expect(200);
    expect(order.body.workshopOrderId).toBeTruthy();

    const repeatOrder = await request(app.getHttpServer())
      .post(`/api/workshop/registration-intakes/${create.body.id}/order`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ odometer: 99999, fuelLevel: 10, notes: 'Should not create another order' })
      .expect(200);
    expect(repeatOrder.body.workshopOrderId).toBe(order.body.workshopOrderId);
    expect(await tenantPrisma.workshopOrder.count()).toBe(1);
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

  it('applies missing nationalcode without copying VIN into nationalcode', async () => {
    const bytes = encodeRegistrationIntakeFixtureBytes('missing-nationalcode');
    const create = await request(app.getHttpServer())
      .post('/api/workshop/registration-intakes')
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', 'missing-nc-1')
      .field('sides', 'FRONT')
      .attach('files', bytes, 'front.jpg')
      .expect(201);
    expect(create.body.matchSnapshot.cases).toContain('MISSING_NATIONALCODE');
    const applyBody = {
      vin: 'WVWZZZSYNTH000001',
      plate: 'W SYNTH 1',
      holder: { firstName: 'pilot', lastName: 'customer' },
      nationalcode: null,
      firstRegistration: '2019-03-12',
      make: 'Synthetic',
      model: 'Demo',
      year: 2019,
    };
    await request(app.getHttpServer())
      .post(`/api/workshop/registration-intakes/${create.body.id}/apply`)
      .set('Authorization', `Bearer ${authToken}`)
      .send(applyBody)
      .expect(200);
    const vehicle = await createTenantAwarePrisma(prisma, tenantId).vehicle.findFirst({
      where: { vin: 'WVWZZZSYNTH000001' },
    });
    expect(vehicle?.national_code).toBeNull();
  });

  it('cleans up row and bytes when page store fails', async () => {
    storage.failOnStorePage = 2;
    const front = encodeRegistrationIntakeFixtureBytes('front-clear');
    const back = encodeRegistrationIntakeFixtureBytes('back-clear');
    const storeFail = await request(app.getHttpServer())
      .post('/api/workshop/registration-intakes')
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', 'store-fail-1')
      .field('sides', 'FRONT')
      .field('sides', 'BACK')
      .attach('files', front, 'front.jpg')
      .attach('files', back, 'back.jpg')
      .expect(400);
    expect(storeFail.body.code).toBe('REGISTRATION_INTAKE_STORE_FAILED');
    storage.failOnStorePage = null;
    expect(storage.objects.size).toBe(0);
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
    expect(
      await tenantPrisma.registrationDocumentIntake.count({
        where: { idempotency_key: 'store-fail-1' },
      }),
    ).toBe(0);
  });

  it('returns field conflict on apply without writes when stored regulatory fields differ', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
    const customer = await tenantPrisma.customer.create({
      data: {
        tenant_id: tenantId,
        first_name: 'pilot',
        last_name: 'customer',
        type: 'PRIVATE',
      },
    });
    const vehicle = await tenantPrisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        customer_id: customer.id,
        vin: 'WVWZZZSYNTH000001',
        plate: 'W SYNTH 1',
        make: 'Synthetic',
        model: 'Demo',
        year: 2019,
        national_code: null,
      },
    });
    const front = encodeRegistrationIntakeFixtureBytes('front-clear');
    const create = await request(app.getHttpServer())
      .post('/api/workshop/registration-intakes')
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', 'field-conflict-1')
      .field('sides', 'FRONT')
      .attach('files', front, 'front.jpg')
      .expect(201);
    await tenantPrisma.vehicle.update({
      where: { id: vehicle.id },
      data: { national_code: 'OTHER-CODE' },
    });
    const applyBody = {
      vin: 'WVWZZZSYNTH000001',
      plate: 'W SYNTH 1',
      holder: { firstName: 'pilot', lastName: 'customer' },
      nationalcode: 'NC1001',
      firstRegistration: '2019-03-12',
      customerId: customer.id,
      vehicleId: vehicle.id,
    };
    const res = await request(app.getHttpServer())
      .post(`/api/workshop/registration-intakes/${create.body.id}/apply`)
      .set('Authorization', `Bearer ${authToken}`)
      .send(applyBody)
      .expect(409);
    expect(res.body.code).toBe('REGISTRATION_INTAKE_FIELD_CONFLICT');
    expect(await tenantPrisma.vehicle.count()).toBe(1);
    const vehicleAfter = await tenantPrisma.vehicle.findFirst({
      where: { vin: 'WVWZZZSYNTH000001' },
    });
    expect(vehicleAfter?.national_code).toBe('OTHER-CODE');
  });

  it('returns 409 when two intakes confirm the same new VIN in parallel', async () => {
    const front = encodeRegistrationIntakeFixtureBytes('front-clear');
    const back = encodeRegistrationIntakeFixtureBytes('back-clear');
    const createA = await request(app.getHttpServer())
      .post('/api/workshop/registration-intakes')
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', 'parallel-vin-a')
      .field('sides', 'FRONT')
      .field('sides', 'BACK')
      .attach('files', front, 'front.jpg')
      .attach('files', back, 'back.jpg')
      .expect(201);
    const createB = await request(app.getHttpServer())
      .post('/api/workshop/registration-intakes')
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', 'parallel-vin-b')
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
    const [resA, resB] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/workshop/registration-intakes/${createA.body.id}/apply`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(applyBody),
      request(app.getHttpServer())
        .post(`/api/workshop/registration-intakes/${createB.body.id}/apply`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(applyBody),
    ]);
    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect(await createTenantAwarePrisma(prisma, tenantId).vehicle.count()).toBe(1);
  });

  it('returns state changed when two applies race on one intake', async () => {
    const front = encodeRegistrationIntakeFixtureBytes('front-clear');
    const create = await request(app.getHttpServer())
      .post('/api/workshop/registration-intakes')
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', 'parallel-one-intake')
      .field('sides', 'FRONT')
      .attach('files', front, 'front.jpg')
      .expect(201);
    const applyBody = {
      vin: 'WVWZZZSYNTH000001',
      plate: 'W SYNTH 1',
      holder: { firstName: 'pilot', lastName: 'customer' },
      nationalcode: 'NC1001',
      firstRegistration: '2019-03-12',
      make: 'Synthetic',
      model: 'Demo',
      year: 2019,
    };
    const [a, b] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/workshop/registration-intakes/${create.body.id}/apply`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(applyBody),
      request(app.getHttpServer())
        .post(`/api/workshop/registration-intakes/${create.body.id}/apply`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(applyBody),
    ]);
    const statuses = [a.status, b.status];
    expect(statuses.filter((status) => status === 200).length).toBeGreaterThanOrEqual(1);
    expect(statuses.every((status) => status === 200 || status === 409)).toBe(true);
  });

  it('applies without CO2 when the document cycle is unknown', async () => {
    const front = encodeRegistrationIntakeFixtureBytes('front-clear');
    const back = encodeRegistrationIntakeFixtureBytes('back-co2-no-cycle');
    const create = await request(app.getHttpServer())
      .post('/api/workshop/registration-intakes')
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', 'co2-cycle-unknown-1')
      .field('sides', 'FRONT')
      .field('sides', 'BACK')
      .attach('files', front, 'front.jpg')
      .attach('files', back, 'back.jpg')
      .expect(201);
    expect(create.body.matchSnapshot.cases).toContain('CO2_CYCLE_UNKNOWN');

    const applyBody = {
      vin: 'WVWZZZSYNTH000001',
      plate: 'W SYNTH 1',
      holder: { firstName: 'pilot', lastName: 'customer' },
      nationalcode: 'NC1001',
      firstRegistration: '2019-03-12',
      co2: null,
      make: 'Synthetic',
      model: 'Demo',
      year: 2019,
    };
    const mismatch = await request(app.getHttpServer())
      .post(`/api/workshop/registration-intakes/${create.body.id}/apply`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ...applyBody, co2: { value: 119, cycle: 'WLTP' } })
      .expect(409);
    expect(mismatch.body.code).toBe('REGISTRATION_INTAKE_CONFIRMATION_MISMATCH');

    await request(app.getHttpServer())
      .post(`/api/workshop/registration-intakes/${create.body.id}/apply`)
      .set('Authorization', `Bearer ${authToken}`)
      .send(applyBody)
      .expect(200);
    const vehicle = await createTenantAwarePrisma(prisma, tenantId).vehicle.findFirst({
      where: { vin: 'WVWZZZSYNTH000001' },
    });
    expect(vehicle?.co2_wltp_g_km).toBeNull();
    expect(vehicle?.co2_nedc_g_km).toBeNull();
  });

  it('keeps plate_normalized in step when intake changes the plate of an existing vehicle', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
    const holder = await tenantPrisma.customer.create({
      data: {
        tenant_id: tenantId,
        first_name: 'pilot',
        last_name: 'customer',
        type: 'PRIVATE',
      },
    });
    const existing = await tenantPrisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        customer_id: holder.id,
        vin: 'WVWZZZSYNTH000001',
        plate: 'W OLD 9',
        plate_normalized: 'WOLD9',
        make: 'Synthetic',
        model: 'Demo',
        year: 2019,
      },
    });
    const front = encodeRegistrationIntakeFixtureBytes('front-clear');
    const create = await request(app.getHttpServer())
      .post('/api/workshop/registration-intakes')
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', 'plate-update-1')
      .field('sides', 'FRONT')
      .attach('files', front, 'front.jpg')
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/workshop/registration-intakes/${create.body.id}/apply`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        vin: 'WVWZZZSYNTH000001',
        plate: 'W SYNTH 1',
        holder: { firstName: 'pilot', lastName: 'customer' },
        nationalcode: 'NC1001',
        firstRegistration: '2019-03-12',
        customerId: holder.id,
        vehicleId: existing.id,
      })
      .expect(200);
    const updated = await tenantPrisma.vehicle.findFirstOrThrow({
      where: { id: existing.id },
    });
    expect(updated.plate).toBe('W SYNTH 1');
    expect(updated.plate_normalized).toBe('WSYNTH1');
  });

  it('rejects ownership correction when nextCustomerId is not the confirmed holder', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
    const previousOwner = await tenantPrisma.customer.create({
      data: {
        tenant_id: tenantId,
        first_name: 'other',
        last_name: 'owner',
        type: 'PRIVATE',
      },
    });
    const holder = await tenantPrisma.customer.create({
      data: {
        tenant_id: tenantId,
        first_name: 'pilot',
        last_name: 'customer',
        type: 'PRIVATE',
      },
    });
    const decoy = await tenantPrisma.customer.create({
      data: {
        tenant_id: tenantId,
        first_name: 'decoy',
        last_name: 'customer',
        type: 'PRIVATE',
      },
    });
    await tenantPrisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        customer_id: previousOwner.id,
        vin: 'WVWZZZSYNTH000001',
        plate: 'W SYNTH 1',
        make: 'Synthetic',
        model: 'Demo',
        year: 2019,
      },
    });
    const front = encodeRegistrationIntakeFixtureBytes('front-clear');
    const create = await request(app.getHttpServer())
      .post('/api/workshop/registration-intakes')
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', 'ownership-next-id-1')
      .field('sides', 'FRONT')
      .attach('files', front, 'front.jpg')
      .expect(201);
    expect(create.body.matchSnapshot.cases).toContain('OWNERSHIP_CONFLICT');

    const applyBody = {
      vin: 'WVWZZZSYNTH000001',
      plate: 'W SYNTH 1',
      holder: { firstName: 'pilot', lastName: 'customer' },
      nationalcode: 'NC1001',
      firstRegistration: '2019-03-12',
      customerId: holder.id,
      vehicleId: create.body.matchSnapshot.vehicles[0].id,
      ownershipCorrection: {
        expectedCustomerId: previousOwner.id,
        nextCustomerId: decoy.id,
      },
    };
    const res = await request(app.getHttpServer())
      .post(`/api/workshop/registration-intakes/${create.body.id}/apply`)
      .set('Authorization', `Bearer ${authToken}`)
      .send(applyBody)
      .expect(409);
    expect(res.body.code).toBe('REGISTRATION_INTAKE_OWNERSHIP_CONFLICT');
  });

  it('marks extract failure when provider rejects on abort signal', async () => {
    const previousTimeout = process.env.REGISTRATION_INTAKE_EXTRACT_TIMEOUT_MS;
    process.env.REGISTRATION_INTAKE_EXTRACT_TIMEOUT_MS = '50';
    let extractCalls = 0;
    const slowApp = await createE2eApp((builder) =>
      builder
        .overrideProvider(REGISTRATION_DOCUMENT_EXTRACTION_PROVIDER)
        .useValue({
          isAvailable: () => true,
          getMetadata: () => ({ providerId: 'test-timeout', modelId: 'none' }),
          extract: async ({ signal }: { signal: AbortSignal }) => {
            extractCalls += 1;
            await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => resolve(), 500);
            signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                reject(
                  signal.reason instanceof Error
                    ? signal.reason
                    : new Error('aborted'),
                );
              },
              { once: true },
            );
          });
            return {
            documentKind: 'AT_ZULASSUNGSSCHEIN',
            warnings: [],
            fields: {},
          };
          },
        })
        .overrideProvider(REGISTRATION_INTAKE_BYTE_STORAGE)
        .useValue(storage),
    );
    const token = createTestAuthToken(
      slowApp.get(AuthService),
      await createTestTenant(slowApp.get(PrismaService), 'reg-timeout'),
    );
    const bytes = encodeRegistrationIntakeFixtureBytes('front-clear');
    const res = await request(slowApp.getHttpServer())
      .post('/api/workshop/registration-intakes')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'timeout-key')
      .field('sides', 'FRONT')
      .attach('files', bytes, 'front.jpg')
      .expect(201);
    expect(res.body.state).toBe('FAILED');
    expect(extractCalls).toBe(1);
    await slowApp.close();
    if (previousTimeout === undefined) {
      delete process.env.REGISTRATION_INTAKE_EXTRACT_TIMEOUT_MS;
    } else {
      process.env.REGISTRATION_INTAKE_EXTRACT_TIMEOUT_MS = previousTimeout;
    }
  });
});
