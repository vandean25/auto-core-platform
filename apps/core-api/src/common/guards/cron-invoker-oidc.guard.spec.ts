import { jest } from '@jest/globals';
import {
  ExecutionContext,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';

const mockVerifyIdToken = jest.fn<
  (options: { idToken: string; audience: string }) => Promise<{
    getPayload: () => {
      email?: string;
      email_verified?: boolean;
    };
  }>
>();

jest.unstable_mockModule('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

const { CronInvokerOidcGuard } = await import('./cron-invoker-oidc.guard.js');

function contextWithAuth(header?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { authorization: header },
        originalUrl: '/api/internal/cron/test-job',
        ip: '127.0.0.1',
      }),
    }),
  } as ExecutionContext;
}

describe('CronInvokerOidcGuard', () => {
  const audience = 'https://core-api-PLACEHOLDER.run.app';
  const invokerEmail = 'scheduler-invoker@PLACEHOLDER.iam.gserviceaccount.com';

  beforeEach(() => {
    mockVerifyIdToken.mockReset();
    process.env.CRON_OIDC_AUDIENCE = audience;
    process.env.CRON_INVOKER_SA_EMAIL = invokerEmail;
  });

  afterEach(() => {
    delete process.env.CRON_OIDC_AUDIENCE;
    delete process.env.CRON_INVOKER_SA_EMAIL;
  });

  it('accepts a valid token', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        email: invokerEmail,
        email_verified: true,
      }),
    });
    const guard = new CronInvokerOidcGuard();
    await expect(
      guard.canActivate(contextWithAuth('Bearer valid-token')),
    ).resolves.toBe(true);
    expect(mockVerifyIdToken).toHaveBeenCalledWith({
      idToken: 'valid-token',
      audience,
    });
  });

  it('rejects missing bearer token', async () => {
    const guard = new CronInvokerOidcGuard();
    await expect(guard.canActivate(contextWithAuth())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects wrong audience from verifyIdToken', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('audience mismatch'));
    const guard = new CronInvokerOidcGuard();
    await expect(
      guard.canActivate(contextWithAuth('Bearer bad-aud')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects wrong email', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        email: 'other@example.com',
        email_verified: true,
      }),
    });
    const guard = new CronInvokerOidcGuard();
    await expect(
      guard.canActivate(contextWithAuth('Bearer token')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects email_verified false', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        email: invokerEmail,
        email_verified: false,
      }),
    });
    const guard = new CronInvokerOidcGuard();
    await expect(
      guard.canActivate(contextWithAuth('Bearer token')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('fails closed when cron OIDC env is missing', async () => {
    delete process.env.CRON_OIDC_AUDIENCE;
    const guard = new CronInvokerOidcGuard();
    await expect(
      guard.canActivate(contextWithAuth('Bearer token')),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
