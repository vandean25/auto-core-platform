import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SpeechNoteService } from '../src/speech-note/speech-note.service';
import { WorkshopTaskStatus } from '@prisma/client';
import {
  SpeechNoteConfigError,
  SpeechNoteInputError,
  SpeechNoteProviderError,
} from '../src/speech-note/speech-note.errors';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestTenant,
  runWithTenantContext,
} from './tenant-test-utils';
import { teardownTestApp } from './test-lifecycle';

/**
 * E2E tests for the mechanic voice-note upload endpoint (AUT-101).
 *
 * `SpeechNoteService` is mocked to avoid a real OpenAI API key requirement.
 *
 * Covers ADR-0014 §5.3 acceptance criteria:
 *   - Happy path: valid audio → 201 with translated draft
 *   - Wrong tenant: mechanic not found in caller's tenant → 404
 *   - Unassigned task: task not assigned to mechanic → 403
 *   - Invalid MIME type → 422
 *   - File too large → 422
 *   - Empty/silent audio → 422
 *   - Provider failure → 500
 *   - No automatic note persistence: task mechanic_notes must not be updated
 */
describe('Mechanic Voice Note Upload (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let basePrisma: PrismaService;
  let tenantId: string;
  let mechanicId: string;
  let customerId: string;
  let vehicleId: string;
  let taskId: string;
  let unassignedTaskId: string;
  let orderId: string;
  let otherOrderId: string;
  let authToken: string;

  /**
   * A minimal valid audio buffer (> MIN_VOICE_NOTE_BYTES = 100 bytes).
   * We use a 2-KiB buffer; the mock SpeechNoteService never reads it.
   */
  const VALID_AUDIO_BUFFER = Buffer.alloc(2048, 0xaa);

  const mockSpeechNote: Partial<SpeechNoteService> & {
    transcribeNote: jest.Mock;
  } = {
    transcribeNote: jest.fn(),
  };

  beforeAll(async () => {
    try {
      process.env.API_KEY = 'test-api-key';

      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(SpeechNoteService)
        .useValue(mockSpeechNote)
        .compile();

      app = moduleFixture.createNestApplication();
      app.setGlobalPrefix('api');
      app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
      await app.init();

      basePrisma = app.get<PrismaService>(PrismaService);
      const authService = app.get<AuthService>(AuthService);

      // Create global Tenant - bypasses isolation
      const testTenant = await createTestTenant(basePrisma, 'mech-voice');
      tenantId = testTenant.tenantId;
      prisma = createTenantAwarePrisma(basePrisma, tenantId);

      await runWithTenantContext(tenantId, async () => {
        // ── Mechanic user + employee ──────────────────────────────────────────────
        const firebaseUid = `e2e-voice-uid-${Date.now()}`;

        const user = await basePrisma.user.create({
          data: {
            firebaseUid,
            email: `voice-mechanic-${Date.now()}@e2e.local`,
          },
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
            name: 'Voice Mechanic',
            role: 'MECHANIC',
            is_active: true,
            user_id: user.id,
          },
        });
        mechanicId = mechanic.id;

        // ── Workshop order + tasks ────────────────────────────────────────────────
        const customer = await basePrisma.customer.create({
          data: {
            tenant_id: tenantId,
            first_name: 'Voice',
            last_name: 'Customer',
            email: `voice-cust-${Date.now()}@e2e.local`,
            type: 'PRIVATE',
          },
        });

        customerId = customer.id;

        const vehicle = await basePrisma.vehicle.create({
          data: {
            tenant_id: tenantId,
            make: 'Toyota',
            model: 'Hilux',
            year: 2023,
            vin: `VIN-VOICE-${Date.now()}`,
            customer_id: customerId,
          },
        });
        vehicleId = vehicle.id;

        const order = await basePrisma.workshopOrder.create({
          data: {
            tenant_id: tenantId,
            order_number: `WO-VOICE-${Date.now()}`,
            customer_id: customer.id,
            vehicle_id: vehicle.id,
            mechanic_id: mechanicId,
            odometer: 50000,
            fuel_level: 75,
            status: 'IN_PROGRESS',
          },
        });
        orderId = order.id;

        const taskA = await basePrisma.workshopTask.create({
          data: {
            tenant_id: tenantId,
            workshop_order_id: orderId,
            title: 'Engine Diagnostics',
            sequence: 1,
            status: 'IN_PROGRESS',
          },
        });
        taskId = taskA.id;

        const otherOrder = await basePrisma.workshopOrder.create({
          data: {
            tenant_id: tenantId,
            order_number: `WO-VOICE-OTHER-${Date.now()}`,
            customer_id: customer.id,
            vehicle_id: vehicle.id,
            odometer: 60000,
            fuel_level: 50,
            status: 'IN_PROGRESS',
          },
        });
        otherOrderId = otherOrder.id;

        const taskB = await basePrisma.workshopTask.create({
          data: {
            tenant_id: tenantId,
            workshop_order_id: otherOrderId,
            title: 'Transmission Check',
            sequence: 1,
            status: 'IN_PROGRESS',
          },
        });
        unassignedTaskId = taskB.id;
      });
    } catch (error) {
      console.error('FAILED E2E SETUP:', error);
      throw error;
    }
  }, 30000);

  afterAll(async () => {
    try {
      if (!prisma || !tenantId) return;

      await cleanupTestTenantGraph(basePrisma, tenantId);

      if (authToken) {
        await basePrisma.user.deleteMany({
          where: { firebaseUid: { startsWith: 'e2e-voice-uid-' } },
        });
      }
    } catch (cleanupError) {
      console.error('Cleanup failed:', cleanupError);
    } finally {
      if (app) {
        await teardownTestApp(app, basePrisma);
      }
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── Happy path ───────────────────────────────────────────────────────────

  it('returns 201 with a translated draft for a valid audio upload', async () => {
    mockSpeechNote.transcribeNote.mockResolvedValueOnce({
      text: 'Engine mounts are worn. Recommend replacement.',
      detectedLanguage: 'en',
      provider: 'openai',
      model: 'whisper-1',
      durationSeconds: 12.5,
    });

    const res = await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${taskId}/voice-notes`)
      .set('Authorization', `Bearer ${authToken}`)
      .attach('audio', VALID_AUDIO_BUFFER, {
        filename: 'note.webm',
        contentType: 'audio/webm',
      })
      .expect(201);

    expect(res.body.text).toBe(
      'Engine mounts are worn. Recommend replacement.',
    );
    expect(res.body.detectedLanguage).toBe('en');
    expect(res.body.provider).toBe('openai');
    expect(res.body.model).toBe('whisper-1');
    expect(res.body.durationSeconds).toBe(12.5);
  });

  // ─── No automatic persistence ─────────────────────────────────────────────

  it('does NOT update mechanic_notes on the task after a successful upload', async () => {
    mockSpeechNote.transcribeNote.mockResolvedValueOnce({
      text: 'Brake pads at 20% — replace soon.',
      detectedLanguage: 'en',
      provider: 'openai',
      model: 'whisper-1',
      durationSeconds: 8.0,
    });

    await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${taskId}/voice-notes`)
      .set('Authorization', `Bearer ${authToken}`)
      .attach('audio', VALID_AUDIO_BUFFER, {
        filename: 'brake-note.webm',
        contentType: 'audio/webm',
      })
      .expect(201);

    // The task mechanic_notes must remain unchanged (null/empty).
    const taskRow = await prisma.workshopTask.findFirst({
      where: { id: taskId },
      select: { mechanic_notes: true },
    });
    expect(taskRow?.mechanic_notes).toBeNull();
  });

  // ─── Wrong tenant ─────────────────────────────────────────────────────────

  it('returns 404 when the task does not belong to the caller\'s tenant', async () => {
    // Create a second tenant with its own order and task
    const otherTenant = await createTestTenant(basePrisma, 'voice-other');
    const otherPrisma = createTenantAwarePrisma(basePrisma, otherTenant.tenantId);

    const otherCust = await otherPrisma.customer.create({
      data: {
        first_name: 'Other',
        last_name: 'Cust',
        email: `other-cust-${Date.now()}@e2e.local`,
        type: 'PRIVATE',
      },
    });
    const otherVehicle = await otherPrisma.vehicle.create({
      data: {
        make: 'Honda',
        model: 'Civic',
        year: 2021,
        vin: `VIN-OTHER-${Date.now()}`,
        customer_id: otherCust.id,
      },
    });
    const otherOrder = await otherPrisma.workshopOrder.create({
      data: {
        order_number: `WO-OTHER-${Date.now()}`,
        customer_id: otherCust.id,
        vehicle_id: otherVehicle.id,
        odometer: 30000,
        fuel_level: 60,
        status: 'IN_PROGRESS',
      },
    });
    const otherTask = await otherPrisma.workshopTask.create({
      data: {
        workshop_order_id: otherOrder.id,
        title: 'Oil Service',
        sequence: 1,
        status: 'IN_PROGRESS',
      },
    });

    // Our mechanic (tenant 1) tries to access a task in tenant 2
    await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${otherTask.id}/voice-notes`)
      .set('Authorization', `Bearer ${authToken}`)
      .attach('audio', VALID_AUDIO_BUFFER, {
        filename: 'note.webm',
        contentType: 'audio/webm',
      })
      .expect(404);

    // Cleanup
    await otherPrisma.workshopTask.deleteMany({
      where: { workshop_order_id: otherOrder.id },
    });
    await otherPrisma.workshopOrder.deleteMany({ where: { id: otherOrder.id } });
    await otherPrisma.vehicle.deleteMany({ where: { id: otherVehicle.id } });
    await otherPrisma.customer.deleteMany({ where: { id: otherCust.id } });

    await basePrisma.tenant.deleteMany({
      where: { id: otherTenant.tenantId },
    });
  });

  // ─── Unassigned task ──────────────────────────────────────────────────────

  it('returns 403 when the task is not assigned to the authenticated mechanic', async () => {
    await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${unassignedTaskId}/voice-notes`)
      .set('Authorization', `Bearer ${authToken}`)
      .attach('audio', VALID_AUDIO_BUFFER, {
        filename: 'note.webm',
        contentType: 'audio/webm',
      })
      .expect(403);
  });

  // ─── Unsupported MIME type ────────────────────────────────────────────────

  it('returns 422 for a disallowed MIME type', async () => {
    await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${taskId}/voice-notes`)
      .set('Authorization', `Bearer ${authToken}`)
      .attach('audio', VALID_AUDIO_BUFFER, {
        filename: 'note.pdf',
        contentType: 'application/pdf',
      })
      .expect(422);
  });

  // ─── Empty audio ──────────────────────────────────────────────────────────

  it('returns 422 for an empty audio buffer', async () => {
    await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${taskId}/voice-notes`)
      .set('Authorization', `Bearer ${authToken}`)
      .attach('audio', Buffer.alloc(0), {
        filename: 'empty.webm',
        contentType: 'audio/webm',
      })
      .expect(422);
  });

  // ─── Silent audio (too small to be real) ─────────────────────────────────

  it('returns 422 when the audio buffer is too small (proxy for silence)', async () => {
    await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${taskId}/voice-notes`)
      .set('Authorization', `Bearer ${authToken}`)
      .attach('audio', Buffer.alloc(50, 0), {
        filename: 'silent.webm',
        contentType: 'audio/webm',
      })
      .expect(422);
  });

  // ─── Completed task ───────────────────────────────────────────────────────

  it('returns 403 when the task is completed (DONE status)', async () => {
    // Mark the task as DONE
    await prisma.workshopTask.updateMany({
      where: { id: taskId },
      data: { status: WorkshopTaskStatus.DONE },
    });

    try {
      await request(app.getHttpServer())
        .post(`/api/mechanic/tasks/${taskId}/voice-notes`)
        .set('Authorization', `Bearer ${authToken}`)
        .attach('audio', VALID_AUDIO_BUFFER, {
          filename: 'note.webm',
          contentType: 'audio/webm',
        })
        .expect(403);
    } finally {
      // Revert status for other tests if necessary (thoughtaskId is used in many)
      await prisma.workshopTask.updateMany({
        where: { id: taskId },
        data: { status: WorkshopTaskStatus.IN_PROGRESS },
      });
    }
  });

  // ─── Transcription returns empty text (silent recording) ─────────────────

  it('returns 422 when transcription returns empty text (silent audio)', async () => {
    mockSpeechNote.transcribeNote.mockResolvedValueOnce({
      text: '',
      detectedLanguage: undefined,
      provider: 'openai',
      model: 'whisper-1',
      durationSeconds: 3.0,
    });

    await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${taskId}/voice-notes`)
      .set('Authorization', `Bearer ${authToken}`)
      .attach('audio', VALID_AUDIO_BUFFER, {
        filename: 'silent.webm',
        contentType: 'audio/webm',
      })
      .expect(422);
  });

  // ─── Duration exceeds limit ───────────────────────────────────────────────

  it('returns 422 when transcription reports duration exceeding the limit', async () => {
    mockSpeechNote.transcribeNote.mockResolvedValueOnce({
      text: 'Very long recording content…',
      detectedLanguage: 'en',
      provider: 'openai',
      model: 'whisper-1',
      durationSeconds: 301, // exceeds 300s limit
    });

    await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${taskId}/voice-notes`)
      .set('Authorization', `Bearer ${authToken}`)
      .attach('audio', VALID_AUDIO_BUFFER, {
        filename: 'long.webm',
        contentType: 'audio/webm',
      })
      .expect(422);
  });

  // ─── Multer size limit (25 MiB) ──────────────────────────────────────────

  it('returns 413 or 422 when the audio file exceeds Multer limits (25 MiB)', async () => {
    // 25 MiB + 1 byte
    const oversizedBuffer = Buffer.alloc(25 * 1024 * 1024 + 1);

    await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${taskId}/voice-notes`)
      .set('Authorization', `Bearer ${authToken}`)
      .attach('audio', oversizedBuffer, {
        filename: 'huge.webm',
        contentType: 'audio/webm',
      })
      // NestJS FileInterceptor with limits throws Payload Too Large (413) 
      // or UnprocessableEntity (422) depending on internal mapping.
      // Usually 413 for Multer size limit.
      .expect((res) => {
        if (res.status !== 413 && res.status !== 422) {
          throw new Error(`Expected 413 or 422, got ${res.status}`);
        }
      });
  });

  // ─── Provider failure ─────────────────────────────────────────────────────

  it('returns 502 (Bad Gateway) when the speech-note provider fails', async () => {
    mockSpeechNote.transcribeNote.mockRejectedValueOnce(
      new SpeechNoteProviderError(
        'Audio processing failed (provider: openai, status: 503).',
        503,
      ),
    );

    await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${taskId}/voice-notes`)
      .set('Authorization', `Bearer ${authToken}`)
      .attach('audio', VALID_AUDIO_BUFFER, {
        filename: 'note.webm',
        contentType: 'audio/webm',
      })
      .expect(502);
  });

  // ─── Provider not configured ──────────────────────────────────────────────

  it('returns 503 (Service Unavailable) when the speech-note provider is not configured', async () => {
    mockSpeechNote.transcribeNote.mockRejectedValueOnce(
      new SpeechNoteConfigError('OPENAI_API_KEY environment variable is required.'),
    );

    await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${taskId}/voice-notes`)
      .set('Authorization', `Bearer ${authToken}`)
      .attach('audio', VALID_AUDIO_BUFFER, {
        filename: 'note.webm',
        contentType: 'audio/webm',
      })
      .expect(503);
  });

  // ─── Missing audio field ──────────────────────────────────────────────────

  it('returns 422 when no audio file is attached', async () => {
    // Send a valid multipart request but without the "audio" field
    await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${taskId}/voice-notes`)
      .set('Authorization', `Bearer ${authToken}`)
      .field('dummy', 'value')
      .expect(422);
  });

  // ─── Non-TECH token rejected ──────────────────────────────────────────────

  it('returns 403 when called with a non-TECH (ADMIN) token', async () => {
    const adminToken = app.get(AuthService).createTestToken({
      sub: 'admin-user',
      email: 'admin@e2e.local',
      tenantId,
      role: 'ADMIN',
    });

    await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${taskId}/voice-notes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('audio', VALID_AUDIO_BUFFER, {
        filename: 'note.webm',
        contentType: 'audio/webm',
      })
      .expect(403);
  });

  // ─── SpeechNoteInputError maps to 422 ────────────────────────────────────

  it('returns 422 when the provider rejects the audio as invalid', async () => {
    mockSpeechNote.transcribeNote.mockRejectedValueOnce(
      new SpeechNoteInputError(
        'Unsupported audio format "audio/webm". Use a supported format.',
      ),
    );

    await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${taskId}/voice-notes`)
      .set('Authorization', `Bearer ${authToken}`)
      .attach('audio', VALID_AUDIO_BUFFER, {
        filename: 'note.webm',
        contentType: 'audio/webm',
      })
      .expect(422);
  });

  // ─── Response body audit — no API key or sensitive credentials ───────────

  it('response body does not contain API keys or sensitive credential fields', async () => {
    mockSpeechNote.transcribeNote.mockResolvedValueOnce({
      text: 'Oil filter replaced.',
      detectedLanguage: 'en',
      provider: 'openai',
      model: 'whisper-1',
      durationSeconds: 5.0,
    });

    const res = await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${taskId}/voice-notes`)
      .set('Authorization', `Bearer ${authToken}`)
      .attach('audio', VALID_AUDIO_BUFFER, {
        filename: 'note.webm',
        contentType: 'audio/webm',
      })
      .expect(201);

    // The response must only contain the known-safe fields.
    const allowedKeys = new Set([
      'text',
      'detectedLanguage',
      'provider',
      'model',
      'durationSeconds',
    ]);
    const responseKeys = Object.keys(res.body);
    const unexpectedKeys = responseKeys.filter((k) => !allowedKeys.has(k));
    expect(unexpectedKeys).toHaveLength(0);

    // Explicitly verify that no credential-like fields are present.
    expect(res.body).not.toHaveProperty('apiKey');
    expect(res.body).not.toHaveProperty('api_key');
    expect(res.body).not.toHaveProperty('openai_api_key');
    expect(res.body).not.toHaveProperty('OPENAI_API_KEY');
    expect(res.body).not.toHaveProperty('token');
    expect(res.body).not.toHaveProperty('secret');
    expect(res.body).not.toHaveProperty('credential');
  });

  // ─── Rate limiting (per mechanic, sliding window) ─────────────────────────

  it('returns 429 after exceeding the per-mechanic rate limit', async () => {
    // Override the rate limit to 2 per window to make the test deterministic.
    const originalMax = process.env.VOICE_NOTE_RATE_LIMIT_MAX;
    const originalTtl = process.env.VOICE_NOTE_RATE_LIMIT_TTL_SECONDS;
    process.env.VOICE_NOTE_RATE_LIMIT_MAX = '2';
    process.env.VOICE_NOTE_RATE_LIMIT_TTL_SECONDS = '60';

    try {
      // Re-create a separate test mechanic user so the rate limit map starts
      // from 0 (earlier tests use a different mechanicId key).
      let limitToken: string;
      let rlTaskId: string;
      let limitUserId: string;
      let limitEmployeeId: string;
      let rlOrderId: string;

      await runWithTenantContext(tenantId, async () => {
        const limitFirebaseUid = `e2e-ratelimit-uid-${Date.now()}`;
        const limitUser = await basePrisma.user.create({
          data: {
            firebaseUid: limitFirebaseUid,
            email: `ratelimit-mechanic-${Date.now()}@e2e.local`,
          },
        });
        limitUserId = limitUser.id;

        limitToken = app.get(AuthService).createTestToken({
          sub: limitFirebaseUid,
          email: limitUser.email,
          tenantId,
          role: 'TECH',
        });

        const limitEmployee = await basePrisma.employee.create({
          data: {
            tenant_id: tenantId,
            name: 'Rate Limit Mechanic',
            role: 'MECHANIC',
            is_active: true,
            user_id: limitUser.id,
          },
        });
        limitEmployeeId = limitEmployee.id;

        const rlOrder = await basePrisma.workshopOrder.create({
          data: {
            tenant_id: tenantId,
            order_number: `WO-RL-${Date.now()}`,
            customer_id: customerId,
            vehicle_id: vehicleId,
            mechanic_id: limitEmployeeId,
            odometer: 70000,
            fuel_level: 80,
            status: 'IN_PROGRESS',
          },
        });
        rlOrderId = rlOrder.id;

        const rlTask = await basePrisma.workshopTask.create({
          data: {
            tenant_id: tenantId,
            workshop_order_id: rlOrder.id,
            title: 'Rate Limit Task',
            sequence: 1,
            status: 'IN_PROGRESS',
          },
        });
        rlTaskId = rlTask.id;
      });

      // Requests 1 and 2 should succeed (within the limit of 2).
      for (let i = 0; i < 2; i++) {
        mockSpeechNote.transcribeNote.mockResolvedValueOnce({
          text: `Note ${i + 1}`,
          detectedLanguage: 'en',
          provider: 'openai',
          model: 'whisper-1',
          durationSeconds: 3.0,
        });

        await request(app.getHttpServer())
          .post(`/api/mechanic/tasks/${rlTaskId!}/voice-notes`)
          .set('Authorization', `Bearer ${limitToken!}`)
          .attach('audio', VALID_AUDIO_BUFFER, {
            filename: 'note.webm',
            contentType: 'audio/webm',
          })
          .expect(201);
      }

      // Request 3 must be throttled with a stable 429 response.
      const throttleRes = await request(app.getHttpServer())
        .post(`/api/mechanic/tasks/${rlTaskId!}/voice-notes`)
        .set('Authorization', `Bearer ${limitToken!}`)
        .attach('audio', VALID_AUDIO_BUFFER, {
          filename: 'note.webm',
          contentType: 'audio/webm',
        })
        .expect(429);

      // The 429 response must contain the stable, documented message prefix.
      // Per runbook: "Voice note rate limit exceeded. Maximum N uploads per Ts window."
      expect(throttleRes.body.message).toMatch(
        /^Voice note rate limit exceeded\. Maximum 2 uploads per 60s window\. Retry after \d+s\./,
      );

      // Cleanup
      await basePrisma.workshopTask.deleteMany({
        where: { workshop_order_id: rlOrderId! },
      });
      await basePrisma.workshopOrder.deleteMany({ where: { id: rlOrderId! } });
      await basePrisma.employee.deleteMany({ where: { id: limitEmployeeId! } });
      await basePrisma.user.deleteMany({ where: { id: limitUserId! } });
    } finally {
      // Restore original env values regardless of test outcome.
      if (originalMax === undefined) {
        delete process.env.VOICE_NOTE_RATE_LIMIT_MAX;
      } else {
        process.env.VOICE_NOTE_RATE_LIMIT_MAX = originalMax;
      }
      if (originalTtl === undefined) {
        delete process.env.VOICE_NOTE_RATE_LIMIT_TTL_SECONDS;
      } else {
        process.env.VOICE_NOTE_RATE_LIMIT_TTL_SECONDS = originalTtl;
      }
    }
  });
});
