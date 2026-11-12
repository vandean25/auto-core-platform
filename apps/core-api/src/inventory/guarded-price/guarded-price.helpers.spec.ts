import { ForbiddenException } from '@nestjs/common';
import { requireGuardedPricePrincipalId } from './guarded-price.helpers.js';

describe('requireGuardedPricePrincipalId', () => {
  // Regression: discovery and fence answered 404 for a session without a principal,
  // while the price patch answered 403.
  it.each([undefined, null, {}])(
    'rejects a session without a principal (%p) with 403',
    (user) => {
      expect(() => requireGuardedPricePrincipalId(user)).toThrow(
        ForbiddenException,
      );
    },
  );

  it('returns the principal id', () => {
    expect(requireGuardedPricePrincipalId({ userId: 'user-1' })).toBe('user-1');
  });
});
