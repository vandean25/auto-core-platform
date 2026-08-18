import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { MechanicMediaStorage } from '../src/mechanic/mechanic-media.storage';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
  seedTestTenantMember,
} from './tenant-test-utils';
import { teardownTestApp } from './test-lifecycle';

/**
 * E2E tests for mechanic execution engine endpoints (ADR-0014 §4–7).
 *
 * Covers:
 *   - Queue & task-detail reads
 *   - Start / pause / resume / complete lifecycle
 *   - Debounced diagnostics save
 *   - Parts request
 *   - Media upload policy generation (MechanicMediaStorage mocked)
 *   - 409 conflict scenarios for start and switch
 *   - Switch flow including 409 → start fallback scenario
 *   - Tenant isolation (mechanic in wrong tenant is rejected)
 */
describe('Mechanic Execution Engine (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let basePrisma: PrismaService;
  let tenantId: string;
  let fixtureTenant: Awaited<ReturnType<typeof createTestTenant>>;
  let mechanicId: string;
  let orderId: string;
  let taskId: string;
  let taskBId: string;
  let authToken: string;
  let mechanicUserId: string;
  let otherTenantId: string | undefined;
  let otherMechanicUserId: string | undefined;

  const mockMediaStorage: Partial<MechanicMediaStorage> & {
    generateUploadPolicy: jest.Mock;
  } = {
    generateUploadPolicy: jest.fn(),
  };

  beforeAll(async () => {
    process.env.API_KEY = 'test-api-key';
    process.env.WORKSHOP_MEDIA_BUCKET = 'test-workshop-media-bucket';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MechanicMediaStorage)
      .useValue(mockMediaStorage)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();

    basePrisma = app.get<PrismaService>(PrismaService);
    const authService = app.get<AuthService>(AuthService);

    const testTenant = await createTestTenant(basePrisma, 'mech-exec');
    fixtureTenant = testTenant;
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);

    await runWithTenantContext(tenantId, async () => {
      const firebaseUid = `e2e-mech-exec-${Date.now()}`;

      const user = await basePrisma.user.create({
        data: {
          firebaseUid,
          email: `e2e-tech-${Date.now()}@workshop.local`,
        },
      });
      mechanicUserId = user.id;
      await seedTestTenantMember(basePrisma, {
        tenantId,
        userId: user.id,
        role: 'TECH',
      });

      authToken = authService.createTestToken({
        sub: firebaseUid,
        email: user.email,
        tenantId,
        role: 'TECH',
      });

      const mechanic = await basePrisma.employee.create({
        data: {
          tenant_id: tenantId,
          name: 'E2E Mechanic',
          role: 'MECHANIC',
          is_active: true,
          user_id: user.id,
        },
      });
      mechanicId = mechanic.id;

      const customer = await basePrisma.customer.create({
        data: {
          tenant_id: tenantId,
          first_name: 'E2E',
          last_name: 'MechCustomer',
          email: `e2e-mech-${Date.now()}@example.com`,
          type: 'PRIVATE',
        },
      });

      const vehicle = await basePrisma.vehicle.create({
        data: {
          tenant_id: tenantId,
          make: 'BMW',
          model: '320d',
          year: 2022,
          vin: `VIN-MECH-${Date.now()}`,
          customer_id: customer.id,
        },
      });

      const order = await basePrisma.workshopOrder.create({
        data: {
          tenant_id: tenantId,
          order_number: `WO-MECH-${Date.now()}`,
          customer_id: customer.id,
          vehicle_id: vehicle.id,
          mechanic_id: mechanicId,
          odometer: 80000,
          fuel_level: 60,
          status: 'INTAKE',
        },
      });
      orderId = order.id;

      const taskA = await basePrisma.workshopTask.create({
        data: {
          tenant_id: tenantId,
          workshop_order_id: orderId,
          title: 'Oil Change',
          sequence: 1,
          status: 'NOT_STARTED',
        },
      });
      taskId = taskA.id;

      const taskB = await basePrisma.workshopTask.create({
        data: {
          tenant_id: tenantId,
          workshop_order_id: orderId,
          title: 'Brake Inspection',
          sequence: 2,
          status: 'NOT_STARTED',
        },
      });
      taskBId = taskB.id;
    });
  });

  afterAll(async () => {
    if (otherTenantId) {
      await cleanupTestTenantGraph(basePrisma, otherTenantId);
    }
    if (tenantId) {
      await cleanupTestTenantGraph(basePrisma, tenantId);
    }
    if (otherMechanicUserId) {
      await basePrisma.user.deleteMany({ where: { id: otherMechanicUserId } });
    }
    if (mechanicUserId) {
      await basePrisma.user.deleteMany({ where: { id: mechanicUserId } });
    }
    await teardownTestApp(app, basePrisma);
  });

  // ─── Queue & Detail ───────────────────────────────────────────────────────

  it('GET /queue returns the mechanic task queue', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/mechanic/queue')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(Array.isArray(res.body.data)).toBe(true);
    const task = res.body.data.find(
      (t: { taskId: string }) => t.taskId === taskId,
    );
    expect(task).toBeDefined();
    expect(task.taskStatus).toBe('NOT_STARTED');
  });

  it('GET /tasks/:taskId returns task detail without financial info', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/mechanic/tasks/${taskId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body.taskId).toBe(taskId);
    expect(res.body.taskStatus).toBe('NOT_STARTED');
    // No financial fields
    expect(res.body).not.toHaveProperty('unitPrice');
    expect(res.body).not.toHaveProperty('lineTotal');
    expect(res.body).not.toHaveProperty('totalAmount');
  });

  it('GET /queue rejects non-TECH token with 403', async () => {
    const adminToken = createTestAuthToken(app.get(AuthService), fixtureTenant);
    await request(app.getHttpServer())
      .get('/api/mechanic/queue')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(403);
  });

  // ─── Execution: Start ─────────────────────────────────────────────────────

  it('POST /tasks/:taskId/start transitions task to IN_PROGRESS', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${taskId}/start`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body.taskStatus).toBe('IN_PROGRESS');
  });

  // ─── Diagnostics ──────────────────────────────────────────────────────────

  it('PATCH /tasks/:taskId/diagnostics saves mechanic notes', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/mechanic/tasks/${taskId}/diagnostics`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ mechanicNotes: 'Oil was very dark, filter replaced.' })
      .expect(200);

    expect(res.body.taskId).toBe(taskId);
    expect(res.body.mechanicNotes).toBe('Oil was very dark, filter replaced.');
  });

  it('PATCH /tasks/:taskId/diagnostics accepts empty payload (partial save)', async () => {
    await request(app.getHttpServer())
      .patch(`/api/mechanic/tasks/${taskId}/diagnostics`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({})
      .expect(200);
  });

  // ─── Parts Request ────────────────────────────────────────────────────────

  it('POST /tasks/:taskId/parts creates a PENDING_PICK part line item', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${taskId}/parts`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        itemNo: 'OIL-FILTER-001',
        description: 'Oil filter 2.0 TDI',
        qty: 1,
      })
      .expect(201);

    expect(res.body.itemNo).toBe('OIL-FILTER-001');
    expect(res.body.description).toBe('Oil filter 2.0 TDI');
    expect(res.body.qty).toBe(1);
    expect(res.body.partExecutionStatus).toBe('PENDING_PICK');
    // No pricing/cost in response
    expect(res.body).not.toHaveProperty('unitPrice');
    expect(res.body).not.toHaveProperty('lineTotal');
  });

  it('POST /tasks/:taskId/parts rejects missing required fields with 400', async () => {
    await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${taskId}/parts`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ description: 'Missing itemNo', qty: 1 })
      .expect(400);
  });

  // ─── Media Upload Policy ──────────────────────────────────────────────────

  it('POST /tasks/:taskId/media/uploads returns presigned POST policy', async () => {
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const storageKey = `tenants/${tenantId}/orders/${orderId}/tasks/${taskId}/abc123.jpg`;

    mockMediaStorage.generateUploadPolicy.mockResolvedValueOnce({
      uploadUrl: 'https://storage.googleapis.com/test-workshop-media-bucket',
      formFields: {
        key: storageKey,
        'x-goog-algorithm': 'GOOG4-RSA-SHA256',
        'x-goog-signature': 'mock-signature',
      },
      storageBucket: 'test-workshop-media-bucket',
      storageKey,
      expiresAt,
    });

    const res = await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${taskId}/media/uploads`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        mimeType: 'image/jpeg',
        sizeBytes: 512000,
        filename: 'photo.jpg',
      })
      .expect(201);

    expect(res.body.uploadUrl).toBe(
      'https://storage.googleapis.com/test-workshop-media-bucket',
    );
    expect(res.body.storageBucket).toBe('test-workshop-media-bucket');
    expect(res.body.storageKey).toBe(storageKey);
    expect(res.body.formFields).toBeDefined();
    expect(res.body.expiresAt).toBeDefined();
  });

  it('POST /tasks/:taskId/media/uploads rejects unsupported mimeType with 400', async () => {
    await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${taskId}/media/uploads`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ mimeType: 'application/pdf', sizeBytes: 10000 })
      .expect(400);
  });

  // ─── Execution: Pause ─────────────────────────────────────────────────────

  it('POST /tasks/:taskId/pause transitions task to WAITING_PARTS', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${taskId}/pause`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ pauseReason: 'WAITING_PARTS' })
      .expect(200);

    expect(res.body.taskStatus).toBe('WAITING_PARTS');
  });

  it('POST /tasks/:taskId/pause rejects AUTO_SHIFT_CLOSE with 400 (DTO validation)', async () => {
    // AUTO_SHIFT_CLOSE is reserved exclusively for the nightly scheduler
    // (MechanicSchedulerService) to automatically close orphaned labor entries
    // at shift-end. Mechanics must not be able to supply this value directly —
    // it would bypass the scheduler's idempotency checks and corrupt labor history.
    // This tests DTO-level validation before any business logic runs.
    await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${taskId}/pause`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ pauseReason: 'AUTO_SHIFT_CLOSE' })
      .expect(400);
  });

  // ─── Execution: Resume ────────────────────────────────────────────────────

  it('POST /tasks/:taskId/start resumes a WAITING_PARTS task', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${taskId}/start`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body.taskStatus).toBe('IN_PROGRESS');
  });

  // ─── 409: Start conflict (mechanic already has an open labor entry) ───────

  it('POST /tasks/taskBId/start returns 409 when mechanic has an open labor entry', async () => {
    // Task A is still IN_PROGRESS (mechanic has open entry).
    // Trying to start Task B should return 409.
    const res = await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${taskBId}/start`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(409);

    expect(String(res.body.message)).toMatch(/open labor entry|switch/i);
  });

  // ─── Switch flow ──────────────────────────────────────────────────────────

  it('POST /tasks/taskBId/switch atomically closes Task A and starts Task B', async () => {
    // Mechanic still has open entry on Task A — switch to Task B.
    const res = await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${taskBId}/switch`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ previousPauseReason: 'SWITCHED_TO_HIGHER_PRIORITY' })
      .expect(200);

    expect(res.body.taskId).toBe(taskBId);
    expect(res.body.taskStatus).toBe('IN_PROGRESS');

    // Verify Task A was transitioned (status no longer IN_PROGRESS)
    const taskARes = await request(app.getHttpServer())
      .get(`/api/mechanic/tasks/${taskId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(taskARes.body.taskStatus).not.toBe('IN_PROGRESS');
  });

  it('POST /tasks/taskId/switch returns 409 when mechanic has no open labor entry', async () => {
    // Complete Task B first so the mechanic has no open entry.
    await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${taskBId}/complete`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    // Now switch should return 409 (no open labor entry to switch from).
    const res = await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${taskId}/switch`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ previousPauseReason: 'SWITCHED_TO_HIGHER_PRIORITY' })
      .expect(409);

    expect(String(res.body.message)).toMatch(/no open labor entry|start/i);
  });

  // ─── Execution: Complete ──────────────────────────────────────────────────

  it('POST /tasks/:taskId/complete transitions task to DONE', async () => {
    // Resume Task A first
    await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${taskId}/start`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${taskId}/complete`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body.taskStatus).toBe('DONE');
  });

  // ─── Post-completion guards ───────────────────────────────────────────────

  it('POST /tasks/:taskId/parts rejects adding parts to a completed task with 422', async () => {
    await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${taskId}/parts`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ itemNo: 'PART-X', description: 'Should fail', qty: 1 })
      .expect(422);
  });

  it('POST /tasks/:taskId/media/uploads rejects upload policy for completed task with 422', async () => {
    await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${taskId}/media/uploads`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ mimeType: 'image/jpeg', sizeBytes: 1024 })
      .expect(422);
  });

  // ─── Tenant isolation ─────────────────────────────────────────────────────

  it('GET /tasks/:taskId returns 404 for a mechanic in a different tenant', async () => {
    const authService = app.get(AuthService);
    const otherTenant = await createTestTenant(basePrisma, 'mech-other');
    otherTenantId = otherTenant.tenantId;

    const otherFirebaseUid = `e2e-tech-other-${Date.now()}`;
    const otherUser = await basePrisma.user.create({
      data: {
        firebaseUid: otherFirebaseUid,
        email: `e2e-other-${Date.now()}@workshop.local`,
      },
    });
    otherMechanicUserId = otherUser.id;
    await seedTestTenantMember(basePrisma, {
      tenantId: otherTenantId,
      userId: otherUser.id,
      role: 'TECH',
    });

    await runWithTenantContext(otherTenantId, async () => {
      await basePrisma.employee.create({
        data: {
          tenant_id: otherTenantId!,
          name: 'Other Tenant Mechanic',
          role: 'MECHANIC',
          is_active: true,
          user_id: otherUser.id,
        },
      });
    });

    const otherToken = authService.createTestToken({
      sub: otherFirebaseUid,
      email: otherUser.email,
      tenantId: otherTenantId,
      role: 'TECH',
    });

    await request(app.getHttpServer())
      .get(`/api/mechanic/tasks/${taskId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });
});
