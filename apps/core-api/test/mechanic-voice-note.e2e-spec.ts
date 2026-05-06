import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SpeechNoteService } from '../src/speech-note/speech-note.service';
import {
  SpeechNoteConfigError,
  SpeechNoteInputError,
  SpeechNoteProviderError,
} from '../src/speech-note/speech-note.errors';
import { createTenantAwarePrisma, createTestTenant } from './tenant-test-utils';

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
  let taskId: string;
  let unassignedTaskId: string;
  let orderId: string;
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

    const testTenant = await createTestTenant(basePrisma, 'mech-voice');
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);

    // ── Mechanic user + employee ──────────────────────────────────────────────
    // resolveMechanic() requires: JWT sub → User.firebaseUid → Employee.user_id
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

    const mechanic = await prisma.employee.create({
      data: {
        name: 'Voice Mechanic',
        role: 'MECHANIC',
        is_active: true,
        user_id: user.id,
      },
    });
    mechanicId = mechanic.id;

    // ── Workshop order + tasks ────────────────────────────────────────────────
    const customer = await prisma.customer.create({
      data: {
        first_name: 'Voice',
        last_name: 'Customer',
        email: `voice-cust-${Date.now()}@e2e.local`,
        type: 'PRIVATE',
      },
    });

    const vehicle = await prisma.vehicle.create({
      data: {
        make: 'Toyota',
        model: 'Hilux',
        year: 2023,
        vin: `VIN-VOICE-${Date.now()}`,
        customer_id: customer.id,
      },
    });

    const order = await prisma.workshopOrder.create({
      data: {
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

    // Task assigned to the mechanic (via order-level inheritance: task.mechanic_id = null)
    const taskA = await prisma.workshopTask.create({
      data: {
        workshop_order_id: orderId,
        title: 'Engine Diagnostics',
        sequence: 1,
        status: 'IN_PROGRESS',
      },
    });
    taskId = taskA.id;

    // Task assigned to a *different* order (no mechanic access) for the unassigned test
    const otherOrder = await prisma.workshopOrder.create({
      data: {
        order_number: `WO-VOICE-OTHER-${Date.now()}`,
        customer_id: customer.id,
        vehicle_id: vehicle.id,
        odometer: 60000,
        fuel_level: 50,
        status: 'IN_PROGRESS',
      },
    });

    const taskB = await prisma.workshopTask.create({
      data: {
        workshop_order_id: otherOrder.id,
        title: 'Transmission Check',
        sequence: 1,
        status: 'IN_PROGRESS',
      },
    });
    unassignedTaskId = taskB.id;
  });

  afterAll(async () => {
    // Clean up in dependency order
    await prisma.workshopTask.deleteMany({
      where: {
        workshop_order: {
          OR: [{ id: orderId }, { mechanic_id: null, customer_id: { not: '' } }],
        },
      },
    });
    await prisma.workshopOrder.deleteMany({
      where: { mechanic_id: mechanicId },
    });
    await prisma.workshopOrder.deleteMany({
      where: { id: { in: [orderId] } },
    });
    await prisma.employee.deleteMany({ where: { id: mechanicId } });
    await basePrisma.user.deleteMany({
      where: { firebaseUid: { startsWith: 'e2e-voice-uid-' } },
    });
    await basePrisma.tenant.deleteMany({ where: { id: tenantId } });
    await app.close();
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
    const taskRow = await prisma.workshopTask.findUnique({
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

  // ─── Provider failure ─────────────────────────────────────────────────────

  it('returns 500 when the speech-note provider fails', async () => {
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
      .expect(500);
  });

  // ─── Provider not configured ──────────────────────────────────────────────

  it('returns 500 when the speech-note provider is not configured', async () => {
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
      .expect(500);
  });

  // ─── Missing audio field ──────────────────────────────────────────────────

  it('returns 422 when no audio file is attached', async () => {
    // Send a multipart request but without the "audio" field
    await request(app.getHttpServer())
      .post(`/api/mechanic/tasks/${taskId}/voice-notes`)
      .set('Authorization', `Bearer ${authToken}`)
      .set('Content-Type', 'multipart/form-data')
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
});
