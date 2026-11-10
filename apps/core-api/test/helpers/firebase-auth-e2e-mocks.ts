import { jest } from '@jest/globals';
import type { UserRecord } from 'firebase-admin/auth';
import { getFirebaseAdminAuth } from '../../src/auth/firebase-admin.js';

/** Minimal Firebase Admin auth stubs for e2e specs that touch custom claims. */
export function stubFirebaseAdminAuthForCustomClaimsE2e(): void {
  const firebaseAuth = getFirebaseAdminAuth();
  jest
    .spyOn(firebaseAuth, 'getUser')
    .mockResolvedValue({ customClaims: {} } as UserRecord);
  jest.spyOn(firebaseAuth, 'setCustomUserClaims').mockResolvedValue(undefined);
  jest.spyOn(firebaseAuth, 'revokeRefreshTokens').mockResolvedValue(undefined);
}
