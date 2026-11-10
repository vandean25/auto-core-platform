import { jest } from '@jest/globals';
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

const verifyIdToken = jest.fn<() => Promise<unknown>>();

const getFirebaseAdminAuth = jest.fn(() => ({ verifyIdToken }));

jest.unstable_mockModule('../firebase-admin.js', () => ({
  getFirebaseAdminAuth: () => getFirebaseAdminAuth(),
}));

const { FirebaseScopeContextIdpAdapter } = await import(
  './scope-context-idp.port.js'
);

describe('FirebaseScopeContextIdpAdapter (AUT-937)', () => {
  beforeEach(() => {
    verifyIdToken.mockReset();
    getFirebaseAdminAuth.mockClear();
  });

  it('maps revoked tokens to 401 without provider details', async () => {
    verifyIdToken.mockRejectedValue({ code: 'auth/id-token-revoked' });
    const adapter = new FirebaseScopeContextIdpAdapter();
    await expect(adapter.verifyIdTokenWithRevocation('token')).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(
      adapter.verifyIdTokenWithRevocation('token'),
    ).rejects.toMatchObject({
      response: { message: 'Invalid or revoked token.' },
    });
  });

  it('rejects tokens without auth_time', async () => {
    verifyIdToken.mockResolvedValue({
      uid: 'firebase-uid',
      auth_time: undefined,
    });
    const adapter = new FirebaseScopeContextIdpAdapter();
    await expect(adapter.verifyIdTokenWithRevocation('token')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('maps transport failures to 503 without provider details', async () => {
    verifyIdToken.mockRejectedValue(new Error('ETIMEDOUT'));
    const adapter = new FirebaseScopeContextIdpAdapter();
    await expect(adapter.verifyIdTokenWithRevocation('token')).rejects.toThrow(
      ServiceUnavailableException,
    );
    await expect(
      adapter.verifyIdTokenWithRevocation('token'),
    ).rejects.toMatchObject({
      response: { message: 'Identity provider is unavailable.' },
    });
  });
});
