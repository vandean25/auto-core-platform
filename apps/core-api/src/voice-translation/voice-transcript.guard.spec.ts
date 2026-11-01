import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { VoiceTranscriptGuard } from './voice-transcript.guard.js';

function mockContext(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('VoiceTranscriptGuard', () => {
  const guard = new VoiceTranscriptGuard();

  it.each(['OWNER', 'ADMIN', 'SALES'])(
    'allows %s before processing the upload stream',
    (role) => {
      const context = mockContext({
        userId: 'u1',
        email: 'user@example.com',
        tenantId: 't1',
        role,
      });
      expect(guard.canActivate(context)).toBe(true);
    },
  );

  it.each(['TECH', 'MECHANIC', 'SERVICE_ADVISOR', 'DEMO'])(
    'forbids %s before accepting the audio upload',
    (role) => {
      const context = mockContext({
        userId: 'u1',
        email: 'user@example.com',
        tenantId: 't1',
        role,
      });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    },
  );

  it('forbids API key principals before accepting the audio upload', () => {
    const context = mockContext({
      tenantId: 't1',
      role: 'API_KEY',
      apiKeyId: 'key-1',
    });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('forbids requests without an authenticated user', () => {
    const context = mockContext(undefined);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
