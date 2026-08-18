import {
  BadRequestException,
  BadGatewayException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { WorkshopTaskStatus } from '@prisma/client';
import { MechanicVoiceNoteService } from './mechanic-voice-note.service';
import {
  MECHANIC_ID,
  ORDER_ID,
  TASK_ID,
  TENANT_ID,
  mockPrisma,
  mockTenantContext,
  mockVoiceTranslationService,
} from './mechanic.spec.support';

describe('MechanicVoiceNoteService', () => {
  let service: MechanicVoiceNoteService;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.WORKSHOP_MEDIA_BUCKET = 'workshop-media-bucket';
    service = new MechanicVoiceNoteService(
      mockPrisma,
      mockTenantContext,
      mockVoiceTranslationService,
    );
    (mockTenantContext.getAuthenticatedUser as jest.Mock).mockReturnValue({
      userId: 'user-1',
      email: 'tech@workshop.at',
      tenantId: TENANT_ID,
      role: 'TECH',
    });
    (mockTenantContext.getTenantId as jest.Mock).mockResolvedValue(TENANT_ID);
    (
      mockVoiceTranslationService.getTargetLanguageCode as jest.Mock
    ).mockResolvedValue('de');
    (
      mockVoiceTranslationService.translateVoiceNote as jest.Mock
    ).mockResolvedValue({
      originalText: 'Original text',
      translatedText: 'Translated text',
      sourceLanguageCode: 'pl-PL',
      targetLanguageCode: 'de',
      detectedLanguageCode: 'pl-PL',
      provider: 'google-cloud',
      model: 'chirp_2',
      durationSeconds: 5.2,
    });
    (mockPrisma.workshopVoiceNoteDraft.create as jest.Mock).mockResolvedValue({
      id: 'draft-1',
    });
  });

  // ─── uploadVoiceNote ────────────────────────────────────────────────────────

  describe('uploadVoiceNote()', () => {
    /** Minimal task stub accepted by assertTaskAssignedToMechanic. */
    const makeTask = (overrides = {}) => ({
      id: TASK_ID,
      status: WorkshopTaskStatus.IN_PROGRESS,
      mechanic_id: MECHANIC_ID,
      bay_id: null,
      workshop_order_id: ORDER_ID,
      workshop_order: { mechanic_id: MECHANIC_ID, bay_id: null },
      ...overrides,
    });

    /** A valid audio file stub (>= 100 bytes, accepted MIME). */
    const makeFile = (
      overrides: Partial<Express.Multer.File> = {},
    ): Express.Multer.File =>
      ({
        fieldname: 'audio',
        originalname: 'note.webm',
        mimetype: 'audio/webm',
        buffer: Buffer.alloc(2048, 0xaa),
        size: 2048,
        ...overrides,
      }) as Express.Multer.File;

    const createEbmlElement = (id: number[], data: Buffer): Buffer =>
      Buffer.concat([Buffer.from(id), Buffer.from([0x80 | data.length]), data]);

    const createUnknownSizeEbmlElement = (id: number[], data: Buffer): Buffer =>
      Buffer.concat([
        Buffer.from(id),
        Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
        data,
      ]);

    const createWebmDurationFixture = (durationSeconds: number): Buffer => {
      const duration = Buffer.alloc(8);
      duration.writeDoubleBE(durationSeconds * 1000, 0);

      const info = createEbmlElement(
        [0x15, 0x49, 0xa9, 0x66],
        Buffer.concat([
          createEbmlElement(
            [0x2a, 0xd7, 0xb1],
            Buffer.from([0x0f, 0x42, 0x40]),
          ),
          createEbmlElement([0x44, 0x89], duration),
        ]),
      );

      return Buffer.concat([
        createUnknownSizeEbmlElement([0x18, 0x53, 0x80, 0x67], info),
        Buffer.alloc(128),
      ]);
    };

    it('throws NotFoundException when task does not exist', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.uploadVoiceNote(MECHANIC_ID, TASK_ID, makeFile()),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when task is not assigned to the mechanic', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeTask({
          mechanic_id: 'other-mechanic',
          workshop_order: { mechanic_id: 'other-mechanic', bay_id: null },
        }),
      );

      await expect(
        service.uploadVoiceNote(MECHANIC_ID, TASK_ID, makeFile()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws UnprocessableEntityException for an empty buffer', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeTask(),
      );

      await expect(
        service.uploadVoiceNote(
          MECHANIC_ID,
          TASK_ID,
          makeFile({ buffer: Buffer.alloc(0) }),
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws UnprocessableEntityException when buffer is below minimum bytes (silent)', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeTask(),
      );

      await expect(
        service.uploadVoiceNote(
          MECHANIC_ID,
          TASK_ID,
          makeFile({ buffer: Buffer.alloc(50) }),
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws UnprocessableEntityException for a disallowed MIME type', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeTask(),
      );

      await expect(
        service.uploadVoiceNote(
          MECHANIC_ID,
          TASK_ID,
          makeFile({ mimetype: 'application/pdf' }),
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws UnprocessableEntityException before transcription when parseable duration exceeds the limit', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeTask(),
      );
      (
        mockVoiceTranslationService.translateVoiceNote as jest.Mock
      ).mockResolvedValue({
        originalText: 'Long recording content',
        translatedText: 'Long recording content',
        sourceLanguageCode: 'en',
        targetLanguageCode: 'de',
        provider: 'google-cloud',
        model: 'latest_long',
        durationSeconds: 301,
      });
      const longRecording = createWebmDurationFixture(301);

      await expect(
        service.uploadVoiceNote(
          MECHANIC_ID,
          TASK_ID,
          makeFile({ buffer: longRecording, size: longRecording.length }),
        ),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(
        mockVoiceTranslationService.translateVoiceNote,
      ).not.toHaveBeenCalled();
    });

    it('throws UnprocessableEntityException when transcription text is empty (silent audio)', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeTask(),
      );
      (
        mockVoiceTranslationService.translateVoiceNote as jest.Mock
      ).mockResolvedValue({
        originalText: '',
        translatedText: '',
        sourceLanguageCode: 'en',
        targetLanguageCode: 'de',
        provider: 'google-cloud',
        model: 'latest_long',
        durationSeconds: 3.0,
      });

      await expect(
        service.uploadVoiceNote(MECHANIC_ID, TASK_ID, makeFile()),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('maps BadRequestException to UnprocessableEntityException', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeTask(),
      );
      (
        mockVoiceTranslationService.translateVoiceNote as jest.Mock
      ).mockRejectedValue(
        new BadRequestException('Audio buffer must not be empty.'),
      );

      await expect(
        service.uploadVoiceNote(MECHANIC_ID, TASK_ID, makeFile()),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('maps Error to BadGatewayException', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeTask(),
      );
      (
        mockVoiceTranslationService.translateVoiceNote as jest.Mock
      ).mockRejectedValue(new Error('Audio processing failed.'));

      await expect(
        service.uploadVoiceNote(MECHANIC_ID, TASK_ID, makeFile()),
      ).rejects.toThrow(BadGatewayException);
    });

    it('maps ServiceUnavailableException to ServiceUnavailableException', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeTask(),
      );
      (
        mockVoiceTranslationService.translateVoiceNote as jest.Mock
      ).mockRejectedValue(
        new ServiceUnavailableException(
          'Google voice translation is not configured.',
        ),
      );

      await expect(
        service.uploadVoiceNote(MECHANIC_ID, TASK_ID, makeFile()),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('preserves non-mapped HttpException subclasses', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeTask(),
      );
      (
        mockVoiceTranslationService.translateVoiceNote as jest.Mock
      ).mockRejectedValue(
        new InternalServerErrorException('Missing SECRET_ENCRYPTION_KEY'),
      );

      await expect(
        service.uploadVoiceNote(MECHANIC_ID, TASK_ID, makeFile()),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('throws UnprocessableEntityException when buffer exceeds maximum bytes (25 MiB)', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeTask(),
      );
      const largeBuffer = Buffer.alloc(25 * 1024 * 1024 + 1);

      await expect(
        service.uploadVoiceNote(
          MECHANIC_ID,
          TASK_ID,
          makeFile({ buffer: largeBuffer }),
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('returns a VoiceNoteDraftResponseDto for valid audio and successful transcription', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeTask(),
      );
      (
        mockVoiceTranslationService.translateVoiceNote as jest.Mock
      ).mockResolvedValue({
        originalText: 'Clutch bearing worn.',
        translatedText: 'Clutch bearing worn — replace.',
        sourceLanguageCode: 'en',
        targetLanguageCode: 'de',
        detectedLanguageCode: 'en',
        provider: 'google-cloud',
        model: 'latest_long',
        durationSeconds: 9.3,
      });

      const result = await service.uploadVoiceNote(
        MECHANIC_ID,
        TASK_ID,
        makeFile(),
      );

      expect(result.text).toBe('Clutch bearing worn — replace.');
      expect(result.detectedLanguage).toBe('en');
      expect(result.provider).toBe('google-cloud');
      expect(result.model).toBe('latest_long');
      expect(result.durationSeconds).toBe(9.3);
    });

    it('persists translated draft rows without mutating workshop task notes', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeTask(),
      );
      (
        mockVoiceTranslationService.translateVoiceNote as jest.Mock
      ).mockResolvedValue({
        originalText: 'No oil pressure detected.',
        translatedText: 'No oil pressure detected.',
        sourceLanguageCode: 'en',
        targetLanguageCode: 'de',
        provider: 'google-cloud',
        model: 'latest_long',
        durationSeconds: 5.0,
      });

      await service.uploadVoiceNote(MECHANIC_ID, TASK_ID, makeFile());

      expect(mockPrisma.workshopVoiceNoteDraft.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.workshopTask.updateMany).not.toHaveBeenCalled();
    });

    it('passes tenant_id to the task lookup query', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeTask(),
      );
      (
        mockVoiceTranslationService.translateVoiceNote as jest.Mock
      ).mockResolvedValue({
        originalText: 'Test note.',
        translatedText: 'Test note.',
        sourceLanguageCode: 'en',
        targetLanguageCode: 'de',
        provider: 'google-cloud',
        model: 'latest_long',
      });

      await service.uploadVoiceNote(MECHANIC_ID, TASK_ID, makeFile());

      expect(mockPrisma.workshopTask.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenant_id: TENANT_ID }),
        }),
      );
    });

    it('zeros out the audio buffer after successful transcription', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeTask(),
      );
      (
        mockVoiceTranslationService.translateVoiceNote as jest.Mock
      ).mockResolvedValue({
        originalText: 'Some diagnostic note.',
        translatedText: 'Some diagnostic note.',
        sourceLanguageCode: 'en',
        targetLanguageCode: 'de',
        provider: 'google-cloud',
        model: 'latest_long',
        durationSeconds: 4.0,
      });

      const file = makeFile();
      await service.uploadVoiceNote(MECHANIC_ID, TASK_ID, file);

      // Buffer must be zeroed out after transcription — audio data must not linger in memory.
      expect(file.buffer.every((byte: number) => byte === 0)).toBe(true);
    });

    it('zeros out the audio buffer even when transcription throws', async () => {
      (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
        makeTask(),
      );
      (
        mockVoiceTranslationService.translateVoiceNote as jest.Mock
      ).mockRejectedValue(new Error('Provider failure.'));

      const file = makeFile();
      await expect(
        service.uploadVoiceNote(MECHANIC_ID, TASK_ID, file),
      ).rejects.toThrow(BadGatewayException);

      // Buffer must be zeroed out on failure too — no audio data retained.
      expect(file.buffer.every((byte: number) => byte === 0)).toBe(true);
    });

    it('throws 429 (HttpException) when the per-mechanic rate limit is exceeded', async () => {
      // Set a tight limit for the test.
      const originalMax = process.env.VOICE_NOTE_RATE_LIMIT_MAX;
      const originalTtl = process.env.VOICE_NOTE_RATE_LIMIT_TTL_SECONDS;
      process.env.VOICE_NOTE_RATE_LIMIT_MAX = '2';
      process.env.VOICE_NOTE_RATE_LIMIT_TTL_SECONDS = '60';

      try {
        // A fresh service instance starts with an empty rate-limit map.
        const freshService = new MechanicVoiceNoteService(
          mockPrisma,
          mockTenantContext,
          mockVoiceTranslationService,
        );

        (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
          makeTask(),
        );
        (
          mockVoiceTranslationService.translateVoiceNote as jest.Mock
        ).mockResolvedValue({
          originalText: 'Note.',
          translatedText: 'Note.',
          sourceLanguageCode: 'en',
          targetLanguageCode: 'de',
          provider: 'google-cloud',
          model: 'latest_long',
          durationSeconds: 2.0,
        });

        // Consume 2 allowed slots.
        await freshService.uploadVoiceNote(MECHANIC_ID, TASK_ID, makeFile());
        await freshService.uploadVoiceNote(MECHANIC_ID, TASK_ID, makeFile());

        // Third call must be rejected with HTTP 429.
        await expect(
          freshService.uploadVoiceNote(MECHANIC_ID, TASK_ID, makeFile()),
        ).rejects.toThrow(expect.objectContaining({ status: 429 }));
      } finally {
        if (originalMax === undefined)
          delete process.env.VOICE_NOTE_RATE_LIMIT_MAX;
        else process.env.VOICE_NOTE_RATE_LIMIT_MAX = originalMax;
        if (originalTtl === undefined)
          delete process.env.VOICE_NOTE_RATE_LIMIT_TTL_SECONDS;
        else process.env.VOICE_NOTE_RATE_LIMIT_TTL_SECONDS = originalTtl;
      }
    });

    it('resets the rate-limit window after TTL expires', async () => {
      const originalMax = process.env.VOICE_NOTE_RATE_LIMIT_MAX;
      const originalTtl = process.env.VOICE_NOTE_RATE_LIMIT_TTL_SECONDS;
      // Use a very short TTL so we can simulate expiry without real delays.
      process.env.VOICE_NOTE_RATE_LIMIT_MAX = '1';
      process.env.VOICE_NOTE_RATE_LIMIT_TTL_SECONDS = '1';

      try {
        const freshService = new MechanicVoiceNoteService(
          mockPrisma,
          mockTenantContext,
          mockVoiceTranslationService,
        );

        (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(
          makeTask(),
        );
        (
          mockVoiceTranslationService.translateVoiceNote as jest.Mock
        ).mockResolvedValue({
          originalText: 'Note.',
          translatedText: 'Note.',
          sourceLanguageCode: 'en',
          targetLanguageCode: 'de',
          provider: 'google-cloud',
          model: 'latest_long',
          durationSeconds: 2.0,
        });

        // First call consumes the only slot in the window.
        await freshService.uploadVoiceNote(MECHANIC_ID, TASK_ID, makeFile());

        // Simulate window expiry by back-dating the internal map entry.
        // Access the private map via bracket notation (unit-test only).
        const rateLimitMap = (
          freshService as unknown as {
            voiceNoteRateLimitMap: Map<
              string,
              { count: number; windowStart: number }
            >;
          }
        ).voiceNoteRateLimitMap;
        const key = `${TENANT_ID}:${MECHANIC_ID}`;
        const entry = rateLimitMap.get(key)!;
        entry.windowStart = Date.now() - 2000; // 2 seconds ago, past 1s TTL

        // After the window resets, the call should succeed again.
        await expect(
          freshService.uploadVoiceNote(MECHANIC_ID, TASK_ID, makeFile()),
        ).resolves.toBeDefined();
      } finally {
        if (originalMax === undefined)
          delete process.env.VOICE_NOTE_RATE_LIMIT_MAX;
        else process.env.VOICE_NOTE_RATE_LIMIT_MAX = originalMax;
        if (originalTtl === undefined)
          delete process.env.VOICE_NOTE_RATE_LIMIT_TTL_SECONDS;
        else process.env.VOICE_NOTE_RATE_LIMIT_TTL_SECONDS = originalTtl;
      }
    });
  });
});
